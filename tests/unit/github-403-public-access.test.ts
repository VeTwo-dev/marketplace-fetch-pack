import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { GitHubRepositoryTransport } from "../../src/transport/github-repository.js";
import { SingleFlight } from "../../src/registry/single-flight.js";
import type {
  ContentTransport,
  ContentTransportResponse,
} from "../../src/transport/types.js";

function jsonBody(data: unknown): string {
  return JSON.stringify(data);
}

function makeServer(
  handler: (req: { url: string; headers: Record<string, string> }) => {
    status: number;
    headers?: Record<string, string>;
    body: string;
  },
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const reqHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") reqHeaders[k] = v;
      }
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const result = handler({ url: req.url ?? "/", headers: reqHeaders });
        for (const [k, v] of Object.entries(result.headers ?? {})) {
          res.setHeader(k, v);
        }
        res.writeHead(result.status);
        res.end(result.body);
      });
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function makeTransport(): ContentTransport {
  return {
    async fetch(request: {
      url: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      timeout?: { totalMs?: number };
      ifNoneMatch?: string;
      ifModifiedSince?: string;
    }): Promise<ContentTransportResponse> {
      const resp = await fetch(request.url, {
        method: "GET",
        headers: request.headers ?? {},
        signal: request.signal,
      });
      const text = await resp.text();
      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
      const bytes = new TextEncoder().encode(text);
      return {
        status: resp.status,
        headers: responseHeaders,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          },
        }),
        contentLength:
          resp.headers.get("content-length") !== null
            ? Number(resp.headers.get("content-length"))
            : null,
        contentType: resp.headers.get("content-type"),
        etag: resp.headers.get("etag"),
        lastModified: resp.headers.get("last-modified"),
        ok: resp.ok,
      };
    },
    async head() {
      return {
        exists: false,
        contentLength: null,
        etag: null,
        lastModified: null,
        contentType: null,
        acceptRange: false,
      };
    },
  };
}

function createRepos(
  port: number,
  options?: { token?: string; timeout?: number },
): GitHubRepositoryTransport {
  const repos = new GitHubRepositoryTransport(
    {
      repository: "https://github.com/o/r",
      branch: "main",
      timeout: options?.timeout ?? 5000,
      token: options?.token,
    },
    makeTransport(),
    new SingleFlight(),
  );
  // Override to point at our local test server
  repos.getRawUrl = async (filePath: string) =>
    `http://localhost:${port}/${filePath}`;
  return repos;
}

describe(
  "GitHubRepositoryTransport 403 + public registry access",
  { timeout: 30000 },
  () => {
    let server: Server;
    let port: number;

    afterEach(async () => {
      if (server !== undefined) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("invalid token + public repo → succeeds without authentication", async () => {
      const receivedAuth: string[] = [];
      ({ server, port } = await makeServer((req) => {
        receivedAuth.push(req.headers["authorization"] ?? "(none)");
        if (req.headers["authorization"] !== undefined) {
          return {
            status: 403,
            body: jsonBody({ message: "Bad credentials" }),
          };
        }
        return {
          status: 200,
          body: jsonBody({ resources: [], categories: [], version: "1.0.0" }),
        };
      }));

      const repos = createRepos(port, { token: "invalid-token" });
      const content = await repos.readText("registry.json");
      const parsed = JSON.parse(content);
      expect(parsed.resources).toEqual([]);
      expect(receivedAuth).toEqual(["Bearer invalid-token", "(none)"]);
    });

    it("no token + public repo → succeeds", async () => {
      ({ server, port } = await makeServer(() => ({
        status: 200,
        body: jsonBody({
          resources: [{ id: "test" }],
          categories: [],
          version: "1.0.0",
        }),
      })));

      const repos = createRepos(port);
      const content = await repos.readText("registry.json");
      const parsed = JSON.parse(content);
      expect(parsed.resources).toHaveLength(1);
    });

    it("rate limit (429) is classified as GITHUB_RATE_LIMIT", async () => {
      ({ server, port } = await makeServer(() => ({
        status: 429,
        headers: { "retry-after": "1", "x-ratelimit-remaining": "0" },
        body: jsonBody({ message: "API rate limit exceeded" }),
      })));

      const repos = createRepos(port);
      await expect(repos.readText("registry.json")).rejects.toThrow(
        expect.objectContaining({ code: "GITHUB_RATE_LIMIT" }),
      );
    });

    it("far-off rate limit fails fast without burning retries", async () => {
      let requestCount = 0;
      ({ server, port } = await makeServer(() => {
        requestCount++;
        return {
          status: 429,
          headers: { "retry-after": "3600", "x-ratelimit-remaining": "0" },
          body: jsonBody({ message: "API rate limit exceeded" }),
        };
      }));

      const repos = createRepos(port);
      const t0 = Date.now();
      await expect(repos.readText("registry.json")).rejects.toThrow(
        expect.objectContaining({ code: "GITHUB_RATE_LIMIT" }),
      );
      // One attempt only, no multi-second backoff loop.
      expect(requestCount).toBe(1);
      expect(Date.now() - t0).toBeLessThan(5000);
    });

    it("private resource (403 both auth and unauth) → authorization error", async () => {
      ({ server, port } = await makeServer(() => ({
        status: 403,
        body: jsonBody({ message: "Not Found" }),
      })));

      const repos = createRepos(port, { token: "some-token" });
      await expect(repos.readText("private-data.json")).rejects.toThrow(
        expect.objectContaining({
          code: "GITHUB_API_ERROR",
          message: expect.stringContaining("authorization"),
        }),
      );
    });

    it("authenticated request rejected → retries without auth → succeeds", async () => {
      let requestCount = 0;
      ({ server, port } = await makeServer((req) => {
        requestCount++;
        if (req.headers["authorization"] !== undefined) {
          return {
            status: 403,
            body: jsonBody({ message: "Bad credentials" }),
          };
        }
        return {
          status: 200,
          body: jsonBody({ content: "public-data" }),
        };
      }));

      const repos = createRepos(port, { token: "expired-token" });
      const content = await repos.readText("data.json");
      expect(content).toContain("public-data");
      expect(requestCount).toBe(2);
    });

    it("404 is classified as REGISTRY_NOT_FOUND", async () => {
      ({ server, port } = await makeServer(() => ({
        status: 404,
        body: jsonBody({ message: "Not Found" }),
      })));

      const repos = createRepos(port);
      await expect(repos.readText("nonexistent.json")).rejects.toThrow(
        expect.objectContaining({ code: "REGISTRY_NOT_FOUND" }),
      );
    });

    it("403 without token but with rate-limit headers → GITHUB_RATE_LIMIT", async () => {
      ({ server, port } = await makeServer(() => ({
        status: 403,
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
        },
        body: jsonBody({ message: "API rate limit exceeded" }),
      })));

      const repos = createRepos(port);
      const error = await repos
        .readText("registry.json")
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "GITHUB_RATE_LIMIT" });
      expect((error as Error).message).toMatch(/rate limit/i);
    });

    it("plain 403 without token is not mislabeled as auth failure", async () => {
      ({ server, port } = await makeServer(() => ({
        status: 403,
        body: jsonBody({ message: "Forbidden" }),
      })));

      const repos = createRepos(port);
      const error = await repos
        .readText("registry.json")
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "GITHUB_API_ERROR" });
      expect((error as Error).message).not.toMatch(
        /Authentication\/authorization failed/,
      );
    });

    it("ETag conditional: 304 returns cached body", async () => {
      let requestCount = 0;
      ({ server, port } = await makeServer((req) => {
        requestCount++;
        if (req.headers["if-none-match"] === '"v1"') {
          return { status: 304, body: "" };
        }
        return {
          status: 200,
          headers: { etag: '"v1"' },
          body: jsonBody({ data: "fresh" }),
        };
      }));

      const repos = createRepos(port);
      const first = await repos.readText("data.json");
      expect(first).toContain("fresh");
      const second = await repos.readText("data.json");
      expect(second).toContain("fresh");
      expect(requestCount).toBe(2);
    });
  },
);
