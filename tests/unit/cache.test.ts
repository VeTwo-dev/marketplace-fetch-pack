import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Cache } from "../../src/cache/index.js";
import type { ResolvedCacheConfig } from "../../src/types/config.js";
import { mkdir, writeFile, readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";

const CACHE_REL = `.vetwo-test-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CACHE_ABS = join(process.cwd(), CACHE_REL);

function makeConfig(overrides: Partial<ResolvedCacheConfig> = {}): ResolvedCacheConfig {
  return {
    enabled: true,
    directory: CACHE_REL,
    maxSize: 1024 * 1024,
    ttl: 60 * 60 * 1000,
    autoClean: false,
    ...overrides,
  };
}

describe("Cache", () => {
  let cache: Cache;

  beforeEach(async () => {
    await rm(CACHE_ABS, { recursive: true, force: true });
    cache = new Cache(makeConfig());
  });

  afterEach(async () => {
    await rm(CACHE_ABS, { recursive: true, force: true });
  });

  describe("initialize()", () => {
    it("creates cache directory", async () => {
      await cache.initialize();
      const s = await stat(CACHE_ABS);
      expect(s.isDirectory()).toBe(true);
    });

    it("initializes with empty manifest", async () => {
      await cache.initialize();
      const stats = await cache.stats();
      expect(stats.entries).toBe(0);
    });
  });

  describe("disabled cache", () => {
    it("returns null on get when disabled", async () => {
      cache = new Cache(makeConfig({ enabled: false }));
      const result = await cache.get("key1");
      expect(result).toBeNull();
    });

    it("does nothing on set when disabled", async () => {
      cache = new Cache(makeConfig({ enabled: false }));
      await cache.set("key1", "value1");
      const stats = await cache.stats();
      expect(stats.entries).toBe(0);
    });

    it("reports enabled as false", () => {
      cache = new Cache(makeConfig({ enabled: false }));
      expect(cache.enabled).toBe(false);
    });
  });

  describe("get/set", () => {
    it("stores and retrieves a value", async () => {
      await cache.initialize();
      await cache.set("key1", { data: "hello" });
      const result = await cache.get("key1");
      expect(result).not.toBeNull();
      expect(result!.key).toBe("key1");
      expect(result!.data).toEqual({ data: "hello" });
      expect(result!.size).toBeGreaterThan(0);
    });

    it("returns null for missing key", async () => {
      await cache.initialize();
      const result = await cache.get("nonexistent");
      expect(result).toBeNull();
    });

    it("handles sequential different keys", async () => {
      await cache.initialize();
      await cache.set("key1", "first");
      await cache.set("key2", "second");
      const r1 = await cache.get("key1");
      const r2 = await cache.get("key2");
      expect(r1!.data).toBe("first");
      expect(r2!.data).toBe("second");
    });

    it("handles string values", async () => {
      await cache.initialize();
      await cache.set("str", "hello world");
      const result = await cache.get("str");
      expect(result!.data).toBe("hello world");
    });

    it("handles array values", async () => {
      await cache.initialize();
      await cache.set("arr", [1, 2, 3]);
      const result = await cache.get("arr");
      expect(result!.data).toEqual([1, 2, 3]);
    });
  });

  describe("has()", () => {
    it("returns true for existing key", async () => {
      await cache.initialize();
      await cache.set("key1", "val");
      expect(await cache.has("key1")).toBe(true);
    });

    it("returns false for missing key", async () => {
      await cache.initialize();
      expect(await cache.has("missing")).toBe(false);
    });
  });

  describe("delete()", () => {
    it("deletes an existing key", async () => {
      await cache.initialize();
      await cache.set("key1", "val");
      const deleted = await cache.delete("key1");
      expect(deleted).toBe(true);
      expect(await cache.get("key1")).toBeNull();
    });

    it("returns false for missing key", async () => {
      await cache.initialize();
      const deleted = await cache.delete("missing");
      expect(deleted).toBe(false);
    });
  });

  describe("clear()", () => {
    it("removes all entries", async () => {
      await cache.initialize();
      await cache.set("a", 1);
      await cache.set("b", 2);
      await cache.clear();
      const stats = await cache.stats();
      expect(stats.entries).toBe(0);
    });
  });

  describe("stats()", () => {
    it("tracks hits and misses", async () => {
      await cache.initialize();
      await cache.set("key1", "val");

      await cache.get("key1"); // hit
      await cache.get("key1"); // hit
      await cache.get("missing"); // miss

      const stats = await cache.stats();
      expect(stats.entries).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    });

    it("reports zero entries for fresh empty cache", async () => {
      const freshCache = new Cache(makeConfig());
      await freshCache.initialize();
      const stats = await freshCache.stats();
      expect(stats.entries).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it("tracks category counts", async () => {
      await cache.initialize();
      await cache.set("r1", "data", "registry");
      await cache.set("m1", "data", "manifest");
      await cache.set("d1", "data", "download");

      const stats = await cache.stats();
      expect(stats.registryEntries).toBe(1);
      expect(stats.manifestEntries).toBe(1);
      expect(stats.downloadEntries).toBe(1);
    });
  });

  describe("expiration", () => {
    it("returns null for expired entries", async () => {
      cache = new Cache(makeConfig({ ttl: 1 }));
      await cache.initialize();
      await cache.set("key1", "val");

      await new Promise((r) => setTimeout(r, 10));

      const result = await cache.get("key1");
      expect(result).toBeNull();
    });
  });

  describe("cache categories", () => {
    it("stores entries under category directories", async () => {
      await cache.initialize();
      await cache.set("r1", { data: 1 }, "registry");

      const catDir = join(CACHE_ABS, "registry");
      const files = await readdir(catDir);
      expect(files.length).toBe(1);
    });
  });

  describe("updateConfig()", () => {
    it("updates config", () => {
      cache.updateConfig({ maxSize: 500 });
      expect(cache.enabled).toBe(true);
    });
  });
});
