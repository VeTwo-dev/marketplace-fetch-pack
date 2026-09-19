import { describe, it, expect } from "vitest";
import { ResolutionCache } from "../../src/dependencies/resolution-cache.js";
import type { ResolverResult } from "../../src/dependencies/advanced-resolver.js";

function makeResult(overrides?: Partial<ResolverResult>): ResolverResult {
  return {
    graph: {
      root: "test",
      nodes: new Map(),
      edges: [],
      reverseEdges: new Map(),
      flat: ["test"],
      circular: [],
      conflicts: [],
      peerRequirements: [],
      optionalResults: [],
      totalSize: 1,
      constructionMs: 10,
    },
    resolvedVersions: new Map([["test", "1.0.0"]]),
    installationOrder: ["test"],
    conflicts: [],
    peerRequirements: [],
    optionalResults: [],
    isDeterministic: true,
    resolutionMs: 10,
    ...overrides,
  };
}

describe("ResolutionCache", () => {
  it("stores and retrieves results", () => {
    const cache = new ResolutionCache({ ttlMs: 60_000 });
    const result = makeResult();

    cache.set("key1", result);
    expect(cache.get("key1")).toBe(result);
  });

  it("returns null for cache miss", () => {
    const cache = new ResolutionCache();
    expect(cache.get("missing")).toBeNull();
  });

  it("expires entries after TTL", async () => {
    const cache = new ResolutionCache({ ttlMs: 1 });
    cache.set("key1", makeResult());

    await new Promise((r) => setTimeout(r, 10));

    expect(cache.get("key1")).toBeNull();
  });

  it("reports stats", () => {
    const cache = new ResolutionCache();
    expect(cache.size).toBe(0);

    cache.set("key1", makeResult());
    expect(cache.size).toBe(1);
  });

  it("evicts oldest when at capacity", () => {
    const cache = new ResolutionCache({ maxSize: 2 });
    cache.set("key1", makeResult());
    cache.set("key2", makeResult());
    cache.set("key3", makeResult());

    expect(cache.size).toBe(2);
    expect(cache.get("key1")).toBeNull();
  });

  it("invalidates by key", () => {
    const cache = new ResolutionCache();
    cache.set("key1", makeResult());
    cache.set("key2", makeResult());

    cache.invalidate("key1");
    expect(cache.get("key1")).toBeNull();
    expect(cache.get("key2")).toBeDefined();
  });

  it("invalidates all when no key", () => {
    const cache = new ResolutionCache();
    cache.set("key1", makeResult());
    cache.set("key2", makeResult());

    cache.invalidate();
    expect(cache.size).toBe(0);
  });

  it("invalidates by prefix", () => {
    const cache = new ResolutionCache();
    cache.set("resolution:a|1.0.0", makeResult());
    cache.set("resolution:b|1.0.0", makeResult());
    cache.set("other:key", makeResult());

    const count = cache.invalidateByPrefix("resolution:");
    expect(count).toBe(2);
    expect(cache.get("other:key")).toBeDefined();
  });

  it("has() checks existence", () => {
    const cache = new ResolutionCache();
    cache.set("key1", makeResult());

    expect(cache.has("key1")).toBe(true);
    expect(cache.has("key2")).toBe(false);
  });

  it("has() returns false for expired entries", async () => {
    const cache = new ResolutionCache({ ttlMs: 1 });
    cache.set("key1", makeResult());

    await new Promise((r) => setTimeout(r, 10));

    expect(cache.has("key1")).toBe(false);
  });

  it("clear() removes all entries", () => {
    const cache = new ResolutionCache();
    cache.set("key1", makeResult());
    cache.set("key2", makeResult());

    cache.clear();
    expect(cache.size).toBe(0);
  });

  describe("buildKey()", () => {
    it("builds deterministic key", () => {
      const cache = new ResolutionCache();
      const installed = new Map([["dep", "1.0.0"]]);

      const key1 = cache.buildKey("resource", "rev1", installed, "22.0.0", "linux", ["react"], false);
      const key2 = cache.buildKey("resource", "rev1", installed, "22.0.0", "linux", ["react"], false);

      expect(key1).toBe(key2);
    });

    it("different inputs produce different keys", () => {
      const cache = new ResolutionCache();
      const installed = new Map();

      const key1 = cache.buildKey("resource", "rev1", installed, "22.0.0", "linux", [], false);
      const key2 = cache.buildKey("resource", "rev2", installed, "22.0.0", "linux", [], false);

      expect(key1).not.toBe(key2);
    });

    it("key includes all parameters", () => {
      const cache = new ResolutionCache();
      const installed = new Map([["dep", "1.0.0"]]);
      const key = cache.buildKey("res", "rev", installed, "22", "linux", ["react"], true);

      expect(key).toContain("res");
      expect(key).toContain("rev");
      expect(key).toContain("22");
      expect(key).toContain("linux");
      expect(key).toContain("react");
      expect(key).toContain("skip");
    });
  });
});
