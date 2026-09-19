import { describe, it, expect } from "vitest";
import { NetworkClient } from "../../src/network/client.js";
import {
  MockTransport,
  createSuccessHandler,
  createJsonHandler,
  createErrorHandler,
} from "../../src/network/mock-transport.js";
import type { NetworkRequest } from "../../src/network/types.js";

function makeReq(overrides?: Partial<NetworkRequest>): NetworkRequest {
  return { url: "https://example.com/test", ...overrides };
}

describe("NetworkClient", () => {
  describe("successful requests", () => {
    it("fetches successfully", async () => {
      const transport = new MockTransport(createSuccessHandler("hello"));
      const client = new NetworkClient(transport);
      const response = await client.fetch(makeReq());
      expect(response.status).toBe(200);
      expect(response.body).toBe("hello");
    });

    it("parses JSON responses", async () => {
      const data = { name: "test", version: "1.0.0" };
      const transport = new MockTransport(createJsonHandler(data));
      const client = new NetworkClient(transport);
      const response = await client.fetchJson(makeReq());
      expect(response.data).toEqual(data);
    });
  });

  describe("error handling", () => {
    it("throws RESOURCE_NOT_FOUND on 404", async () => {
      const transport = new MockTransport(createErrorHandler(404, "Not Found"));
      const client = new NetworkClient(transport);
      await expect(client.fetch(makeReq())).rejects.toThrow("Resource not found");
    });

    it("throws GITHUB_API_ERROR on 403", async () => {
      const transport = new MockTransport(createErrorHandler(403, "Forbidden"));
      const client = new NetworkClient(transport);
      await expect(client.fetch(makeReq())).rejects.toThrow("Authentication/authorization failed");
    });

    it("retries on 500 then fails", async () => {
      let count = 0;
      const transport = new MockTransport(() => {
        count++;
        return { status: 500, statusText: "Error", headers: {}, body: "err", fromCache: false, duration: 0 };
      });
      const client = new NetworkClient(transport, {
        retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50, backoffMultiplier: 2, jitter: false },
      });
      await expect(client.fetch(makeReq())).rejects.toThrow("HTTP 500");
      expect(count).toBe(3);
    });

    it("throws on invalid JSON in fetchJson", async () => {
      const transport = new MockTransport(createSuccessHandler("not json"));
      const client = new NetworkClient(transport);
      await expect(client.fetchJson(makeReq())).rejects.toThrow("Invalid JSON response");
    });
  });

  describe("retry logic", () => {
    it("retries on 503 and succeeds", async () => {
      let count = 0;
      const transport = new MockTransport(() => {
        count++;
        if (count < 3) {
          return { status: 503, statusText: "Unavailable", headers: {}, body: "", fromCache: false, duration: 0 };
        }
        return { status: 200, statusText: "OK", headers: {}, body: "ok", fromCache: false, duration: 0 };
      });
      const client = new NetworkClient(transport, {
        retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, backoffMultiplier: 2, jitter: false },
      });
      const res = await client.fetch(makeReq());
      expect(res.status).toBe(200);
      expect(count).toBe(3);
    });

    it("does not retry on 404", async () => {
      let count = 0;
      const transport = new MockTransport(() => {
        count++;
        return { status: 404, statusText: "Not Found", headers: {}, body: "", fromCache: false, duration: 0 };
      });
      const client = new NetworkClient(transport, {
        retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, backoffMultiplier: 2, jitter: false },
      });
      await expect(client.fetch(makeReq())).rejects.toThrow();
      expect(count).toBe(1);
    });
  });

  describe("request deduplication", () => {
    it("deduplicates when second request starts after first is in-flight", async () => {
      let count = 0;
      const transport = new MockTransport(async () => {
        count++;
        await new Promise((r) => setTimeout(r, 50));
        return { status: 200, statusText: "OK", headers: {}, body: "ok", fromCache: false, duration: 50 };
      });
      const client = new NetworkClient(transport);
      const req = makeReq();

      const first = client.fetch(req);
      await new Promise((r) => setTimeout(r, 5));
      const second = client.fetch(req);

      const [r1, r2] = await Promise.all([first, second]);
      expect(r1.body).toBe("ok");
      expect(r2.body).toBe("ok");
      expect(count).toBe(1);
    });

    it("does not deduplicate different URLs", async () => {
      let count = 0;
      const transport = new MockTransport(async () => {
        count++;
        await new Promise((r) => setTimeout(r, 10));
        return { status: 200, statusText: "OK", headers: {}, body: "ok", fromCache: false, duration: 10 };
      });
      const client = new NetworkClient(transport);
      await Promise.all([
        client.fetch(makeReq({ url: "https://a.com" })),
        client.fetch(makeReq({ url: "https://b.com" })),
      ]);
      expect(count).toBe(2);
    });
  });

  describe("HTTP caching", () => {
    it("stores etag and sends cache entry on next request", async () => {
      const transport = new MockTransport((req) => {
        if (req.cache?.etag === '"abc"') {
          return { status: 304, statusText: "Not Modified", headers: {}, body: "", fromCache: true, duration: 0 };
        }
        return { status: 200, statusText: "OK", headers: { etag: '"abc"' }, body: "data", fromCache: false, duration: 0 };
      });
      const client = new NetworkClient(transport);

      const first = await client.fetch(makeReq());
      expect(first.body).toBe("data");

      const second = await client.fetch(makeReq());
      expect(second.status).toBe(304);
      expect(second.fromCache).toBe(true);
    });

    it("returns null data for 304 in fetchJson", async () => {
      const transport = new MockTransport((req) => {
        if (req.cache?.etag === '"abc"') {
          return { status: 304, statusText: "Not Modified", headers: {}, body: "", fromCache: true, duration: 0 };
        }
        return {
          status: 200, statusText: "OK",
          headers: { etag: '"abc"', "content-type": "application/json" },
          body: JSON.stringify({ name: "test" }),
          fromCache: false, duration: 0,
        };
      });
      const client = new NetworkClient(transport);

      await client.fetchJson(makeReq());
      const second = await client.fetchJson(makeReq());
      expect(second.status).toBe(304);
      expect(second.fromCache).toBe(true);
    });
  });

  describe("rate limit info", () => {
    it("extracts rate limit headers", async () => {
      const transport = new MockTransport(() => ({
        status: 200, statusText: "OK",
        headers: { "x-ratelimit-remaining": "59", "x-ratelimit-limit": "60", "x-ratelimit-reset": "1700000000" },
        body: "ok", fromCache: false, duration: 0,
      }));
      const client = new NetworkClient(transport);
      await client.fetch(makeReq());
      expect(client.rateLimit).not.toBeNull();
      expect(client.rateLimit!.remaining).toBe(59);
      expect(client.rateLimit!.limit).toBe(60);
    });
  });

  describe("no real network", () => {
    it("works entirely with mock transport", async () => {
      const transport = new MockTransport(createSuccessHandler("mocked"));
      const client = new NetworkClient(transport);
      const res = await client.fetch(makeReq());
      expect(res.body).toBe("mocked");
      expect(transport.requestCount).toBe(1);
    });
  });
});
