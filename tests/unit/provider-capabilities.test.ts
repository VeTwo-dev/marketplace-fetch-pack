import { describe, it, expect } from "vitest";
import { detectCapabilities, createConditionalHeaders } from "../../src/registry/provider-capabilities.js";
import type { RegistryProvider } from "../../src/types/providers.js";

function makeProvider(type: "github" | "http" | "local"): RegistryProvider {
  return {
    type,
    name: type,
    async connect() {},
    async readFile() { return ""; },
    async readJson() { return {}; },
    async getTree() { return []; },
    async getRawUrl() { return ""; },
    invalidate() {},
  };
}

describe("detectCapabilities", () => {
  it("detects GitHub capabilities", () => {
    const caps = detectCapabilities(makeProvider("github"));
    expect(caps.supportsTree).toBe(true);
    expect(caps.supportsRawUrl).toBe(true);
    expect(caps.supportsConditionalRequests).toBe(true);
    expect(caps.supportsRevision).toBe(true);
    expect(caps.supportsBulkFetch).toBe(true);
    expect(caps.supportsAuthentication).toBe(true);
    expect(caps.supportsTreeListing).toBe(true);
    expect(caps.supportsPagination).toBe(true);
    expect(caps.rateLimitAware).toBe(true);
    expect(caps.maxConcurrentRequests).toBe(10);
  });

  it("detects HTTP capabilities", () => {
    const caps = detectCapabilities(makeProvider("http"));
    expect(caps.supportsTree).toBe(true);
    expect(caps.supportsConditionalRequests).toBe(false);
    expect(caps.supportsRevision).toBe(false);
    expect(caps.rateLimitAware).toBe(false);
    expect(caps.maxConcurrentRequests).toBe(5);
  });

  it("detects local capabilities", () => {
    const caps = detectCapabilities(makeProvider("local"));
    expect(caps.supportsTree).toBe(true);
    expect(caps.supportsSearch).toBe(true);
    expect(caps.supportsConditionalRequests).toBe(false);
    expect(caps.maxConcurrentRequests).toBe(50);
  });

  it("handles unknown provider type", () => {
    const caps = detectCapabilities(makeProvider("github"));
    expect(caps.supportsTree).toBe(true);
  });
});

describe("createConditionalHeaders", () => {
  it("creates If-None-Match header from ETag", () => {
    const headers = createConditionalHeaders({ etag: '"abc123"' });
    expect(headers["If-None-Match"]).toBe('"abc123"');
  });

  it("creates If-Modified-Since header from lastModified", () => {
    const headers = createConditionalHeaders({ lastModified: "Mon, 01 Jan 2024 00:00:00 GMT" });
    expect(headers["If-Modified-Since"]).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  it("creates both headers", () => {
    const headers = createConditionalHeaders({
      etag: '"abc"',
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(headers["If-None-Match"]).toBe('"abc"');
    expect(headers["If-Modified-Since"]).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  it("returns empty headers when no revision info", () => {
    const headers = createConditionalHeaders({});
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it("returns empty headers when undefined", () => {
    const headers = createConditionalHeaders(undefined);
    expect(Object.keys(headers)).toHaveLength(0);
  });
});
