import { describe, it, expect, vi, beforeEach } from "vitest";
import { NodeFetchTransport } from "../../src/transport/node-fetch-transport.js";

describe("NodeFetchTransport", () => {
  let transport: NodeFetchTransport;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    transport = new NodeFetchTransport();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("makes a successful GET request", async () => {
    const mockResponse = {
      status: 200,
      ok: true,
      headers: new Map([
        ["content-type", "application/json"],
        ["content-length", "100"],
        ["etag", '"abc123"'],
        ["last-modified", "Mon, 01 Jan 2024 00:00:00 GMT"],
      ]),
      body: null,
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as Response);

    const result = await transport.fetch({ url: "https://example.com/data.json" });
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe("application/json");
    expect(result.contentLength).toBe(100);
    expect(result.etag).toBe('"abc123"');
  });

  it("makes HEAD request", async () => {
    const mockResponse = {
      status: 200,
      ok: true,
      headers: new Map([
        ["content-length", "1024"],
        ["accept-ranges", "bytes"],
        ["etag", '"def456"'],
      ]),
      body: null,
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as Response);

    const result = await transport.head("https://example.com/file.bin");
    expect(result.exists).toBe(true);
    expect(result.contentLength).toBe(1024);
    expect(result.acceptRange).toBe(true);
  });

  it("handles non-ok responses", async () => {
    const mockResponse = {
      status: 404,
      ok: false,
      headers: new Map(),
      body: null,
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as Response);

    const result = await transport.fetch({ url: "https://example.com/missing" });
    expect(result.status).toBe(404);
    expect(result.ok).toBe(false);
  });

  it("propagates abort signals", async () => {
    const controller = new AbortController();
    vi.mocked(globalThis.fetch).mockImplementation(() => {
      return new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const promise = transport.fetch({
      url: "https://example.com/slow",
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow();
  });
});
