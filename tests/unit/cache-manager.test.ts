import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CacheManager } from "../../src/cache/CacheManager.js";
import { MarketplaceStateManager } from "../../src/state/index.js";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CacheManager", () => {
  let tmpDir: string;
  let state: MarketplaceStateManager;
  let cache: CacheManager;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `vetwo-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    state = new MarketplaceStateManager(tmpDir);
    await state.initialize();
    cache = new CacheManager(state, { enabled: true, autoClean: false });
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.clearAll().catch(() => {});
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. creates cache directories
  // ---------------------------------------------------------------------------
  it("creates cache directories", () => {
    const cacheDir = state.paths.cache;
    expect(existsSync(join(cacheDir, "metadata"))).toBe(true);
    expect(existsSync(join(cacheDir, "content"))).toBe(true);
    expect(existsSync(join(cacheDir, "artifacts"))).toBe(true);
    expect(existsSync(join(cacheDir, "cas"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 2. stores and retrieves a value
  // ---------------------------------------------------------------------------
  it("stores and retrieves a value", async () => {
    await cache.set("my-key", { hello: "world" }, "metadata");
    const result = await cache.get<{ hello: string }>("my-key", "metadata");
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ hello: "world" });
  });

  // ---------------------------------------------------------------------------
  // 3. returns null for missing key
  // ---------------------------------------------------------------------------
  it("returns null for missing key", async () => {
    const result = await cache.get("nonexistent", "metadata");
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 4. reports cache miss
  // ---------------------------------------------------------------------------
  it("reports cache miss", async () => {
    const before = cache.stats.misses;
    await cache.get("missing", "metadata");
    expect(cache.stats.misses).toBe(before + 1);
  });

  // ---------------------------------------------------------------------------
  // 5. reports cache hit
  // ---------------------------------------------------------------------------
  it("reports cache hit", async () => {
    await cache.set("hit-key", "data", "content");
    const before = cache.stats.hits;
    await cache.get("hit-key", "content");
    expect(cache.stats.hits).toBe(before + 1);
  });

  // ---------------------------------------------------------------------------
  // 6. returns stale entry but tracks staleHits
  // ---------------------------------------------------------------------------
  it("returns stale entry but tracks staleHits", async () => {
    // Create entry with very short TTL, but long stale window
    await cache.set("stale-key", "value", "metadata", {
      ttlOverride: 1, // 1ms TTL
    });

    // Wait until TTL expires but stale window is still valid
    await new Promise((r) => setTimeout(r, 50));

    const staleHitsBefore = cache.stats.staleHits;
    const result = await cache.get("stale-key", "metadata");
    expect(result).not.toBeNull();
    expect(result!.data).toBe("value");
    expect(cache.stats.staleHits).toBe(staleHitsBefore + 1);
  });

  // ---------------------------------------------------------------------------
  // 7. returns null for expired entry and removes it
  // ---------------------------------------------------------------------------
  it("returns null for expired entry and removes it", async () => {
    // TTL=1ms, staleTtl=0 (not provided, defaults to layer config staleTtl)
    // We need to ensure stale window also expires so get returns null.
    // We'll use a small TTL and wait long enough for both to expire.
    await cache.set(
      "expired-key",
      "value",
      "metadata",
      { ttlOverride: 1 },
    );

    await new Promise((r) => setTimeout(r, 100));

    // The default metadata staleTtl is 15 min, so we need to create a cache
    // with short staleTtl. Let's recreate with short staleTtl.
    await cache.clearAll();
    cache = new CacheManager(state, {
      enabled: true,
      autoClean: false,
      metadata: { ttl: 1, staleTtl: 1 },
    });
    await cache.initialize();

    await cache.set("expired-key", "value", "metadata");
    await new Promise((r) => setTimeout(r, 20));

    const result = await cache.get("expired-key", "metadata");
    expect(result).toBeNull();
    expect(cache.stats.expiredEntries).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // 8. has() returns true for existing fresh entry
  // ---------------------------------------------------------------------------
  it("has() returns true for existing fresh entry", async () => {
    await cache.set("exists", 42, "content");
    expect(cache.has("exists", "content")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 9. has() returns false for missing key
  // ---------------------------------------------------------------------------
  it("has() returns false for missing key", () => {
    expect(cache.has("nope", "metadata")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 10. getState() returns correct states
  // ---------------------------------------------------------------------------
  it("getState() returns correct states", async () => {
    expect(cache.getState("unknown", "metadata")).toBe("missing");

    await cache.set("fresh-key", "val", "metadata");
    expect(cache.getState("fresh-key", "metadata")).toBe("fresh");
  });

  // ---------------------------------------------------------------------------
  // 11. invalidate() removes entry
  // ---------------------------------------------------------------------------
  it("invalidate() removes entry", async () => {
    await cache.set("to-inv", "data", "metadata");
    const removed = await cache.invalidate("to-inv");
    expect(removed).toBe(true);
    expect(await cache.get("to-inv", "metadata")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 12. invalidateLayer() removes all entries in layer
  // ---------------------------------------------------------------------------
  it("invalidateLayer() removes all entries in layer", async () => {
    await cache.set("a", 1, "content");
    await cache.set("b", 2, "content");
    await cache.set("c", 3, "metadata");

    const count = await cache.invalidateLayer("content");
    expect(count).toBe(2);
    expect(await cache.get("a", "content")).toBeNull();
    expect(await cache.get("b", "content")).toBeNull();
    expect(await cache.get("c", "metadata")).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 13. invalidateResource() removes matching entries
  // ---------------------------------------------------------------------------
  it("invalidateResource() removes matching entries", async () => {
    await cache.set("pkg-a", "data1", "metadata", { repository: "my-pkg" });
    await cache.set("pkg-b", "data2", "content");
    await cache.set("pkg-c", "data3", "metadata");

    const count = await cache.invalidateResource("my-pkg");
    expect(count).toBe(1);
    expect(await cache.get("pkg-a", "metadata")).toBeNull();
    expect(await cache.get("pkg-b", "content")).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 14. clearExpired() removes expired entries
  // ---------------------------------------------------------------------------
  it("clearExpired() removes expired entries", async () => {
    cache = new CacheManager(state, {
      enabled: true,
      autoClean: false,
      metadata: { ttl: 1, staleTtl: 0 },
    });
    await cache.initialize();

    await cache.set("exp1", "v1", "metadata");
    await cache.set("exp2", "v2", "metadata");
    await new Promise((r) => setTimeout(r, 20));

    const cleared = await cache.clearExpired();
    expect(cleared).toBe(2);
    expect(await cache.get("exp1", "metadata")).toBeNull();
    expect(await cache.get("exp2", "metadata")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 15. clearAll() removes everything
  // ---------------------------------------------------------------------------
  it("clearAll() removes everything", async () => {
    await cache.set("x", 1, "metadata");
    await cache.set("y", 2, "content");
    await cache.set("z", 3, "artifacts");

    await cache.clearAll();
    expect(cache.stats.entries).toHaveLength(0);
    expect(await cache.get("x", "metadata")).toBeNull();
    expect(await cache.get("y", "content")).toBeNull();
    expect(await cache.get("z", "artifacts")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 16. atomic writes prevent corruption
  // ---------------------------------------------------------------------------
  it("atomic writes prevent corruption", async () => {
    await cache.set("atomic-key", { value: 123 }, "metadata");
    await cache.set("atomic-key", { value: 456 }, "metadata");

    const manifestPath = join(state.paths.cache, "cache-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.version).toBe(2);
    expect(Array.isArray(manifest.entries)).toBe(true);

    // Only one entry should exist for this key
    const matching = manifest.entries.filter(
      (e: { key: string }) => e.key === "atomic-key",
    );
    expect(matching).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 17. getOrSet() returns cached value on hit
  // ---------------------------------------------------------------------------
  it("getOrSet() returns cached value on hit", async () => {
    await cache.set("cached", "original", "metadata");
    let factoryCalled = false;

    const result = await cache.getOrSet(
      "cached",
      async () => {
        factoryCalled = true;
        return "new-value";
      },
      "metadata",
    );

    expect(result.data).toBe("original");
    expect(factoryCalled).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 18. getOrSet() calls factory on miss
  // ---------------------------------------------------------------------------
  it("getOrSet() calls factory on miss", async () => {
    let factoryCalled = false;

    const result = await cache.getOrSet(
      "fresh-miss",
      async () => {
        factoryCalled = true;
        return "factory-value";
      },
      "metadata",
    );

    expect(factoryCalled).toBe(true);
    expect(result.data).toBe("factory-value");

    // Verify it was cached
    const cached = await cache.get<string>("fresh-miss", "metadata");
    expect(cached!.data).toBe("factory-value");
  });

  // ---------------------------------------------------------------------------
  // 19. setRaw() stores binary data and getRaw() reads raw content
  // ---------------------------------------------------------------------------
  it("setRaw() stores binary data and getRaw() reads raw content", async () => {
    const buf = Buffer.from([0x00, 0x01, 0xff, 0x02, 0xfe]);
    await cache.setRaw("binary-key", buf, "content");

    // Verify the entry is tracked in the manifest
    expect(cache.has("binary-key", "content")).toBe(true);
    expect(cache.getState("binary-key", "content")).toBe("fresh");

    // Verify the file exists on disk
    const files = readdirSync(join(state.paths.cache, "content"));
    const binFiles = files.filter((f) => f.endsWith(".bin"));
    expect(binFiles.length).toBe(1);

    // getRaw reads entries stored by set (JSON files)
    await cache.set("raw-json", { raw: true }, "metadata");
    const retrieved = await cache.getRaw("raw-json", "metadata");
    expect(retrieved).not.toBeNull();
    const parsed = JSON.parse(retrieved!.toString("utf-8"));
    expect(parsed).toEqual({ raw: true });
  });

  // ---------------------------------------------------------------------------
  // 20. content-addressable storage deduplicates
  // ---------------------------------------------------------------------------
  it("content-addressable storage deduplicates", async () => {
    const buf = Buffer.from("hello dedup");
    const ref1 = await cache.storeContentAddressable(buf, "content");
    const ref2 = await cache.storeContentAddressable(buf, "content");

    expect(ref1.sha256).toBe(ref2.sha256);
    expect(ref2.refCount).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 21. content-addressable storage retrieves by hash
  // ---------------------------------------------------------------------------
  it("content-addressable storage retrieves by hash", async () => {
    const buf = Buffer.from("cas retrieve test");
    const ref = await cache.storeContentAddressable(buf, "metadata");

    const retrieved = await cache.getContentAddressable(ref.sha256, "metadata");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.equals(buf)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 22. LRU eviction when maxEntries exceeded
  // ---------------------------------------------------------------------------
  it("LRU eviction when maxEntries exceeded", async () => {
    // Use small maxEntries for the layer
    cache = new CacheManager(state, {
      enabled: true,
      autoClean: false,
      metadata: { ttl: 60_000, staleTtl: 0, maxEntries: 3 },
    });
    await cache.initialize();

    await cache.set("e1", 1, "metadata");
    // Small delay so accessedAt differs
    await new Promise((r) => setTimeout(r, 5));
    await cache.set("e2", 2, "metadata");
    await new Promise((r) => setTimeout(r, 5));
    await cache.set("e3", 3, "metadata");
    await new Promise((r) => setTimeout(r, 5));
    await cache.set("e4", 4, "metadata");

    // e1 should be evicted (oldest LRU)
    expect(await cache.get("e1", "metadata")).toBeNull();
    expect(await cache.get("e4", "metadata")).not.toBeNull();
    expect(cache.stats.evictions).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // 23. cache key determinism
  // ---------------------------------------------------------------------------
  it("cache key determinism", async () => {
    await cache.set("deterministic", "first", "metadata");
    const result1 = await cache.get("deterministic", "metadata");
    await cache.set("deterministic", "second", "metadata");
    const result2 = await cache.get("deterministic", "metadata");

    expect(result1!.data).toBe("first");
    expect(result2!.data).toBe("second");

    // Same key, same layer → always same file path
    expect(cache.getState("deterministic", "metadata")).toBe("fresh");
  });

  // ---------------------------------------------------------------------------
  // 24. stats tracking
  // ---------------------------------------------------------------------------
  it("stats tracking", async () => {
    const stats = cache.stats;
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.staleHits).toBe(0);
    expect(stats.expiredEntries).toBe(0);
    expect(stats.writes).toBe(0);
    expect(stats.invalidations).toBe(0);
    expect(stats.evictions).toBe(0);
    expect(stats.bytesRead).toBe(0);
    expect(stats.bytesWritten).toBe(0);
    expect(stats.entries).toHaveLength(0);

    await cache.set("s1", "v1", "metadata");
    await cache.get("s1", "metadata"); // hit
    await cache.get("miss", "metadata"); // miss

    const after = cache.stats;
    expect(after.writes).toBe(1);
    expect(after.hits).toBe(1);
    expect(after.misses).toBe(1);
    expect(after.bytesWritten).toBeGreaterThan(0);
    expect(after.bytesRead).toBeGreaterThan(0);
    expect(after.entries).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 25. cleanup() removes expired and orphans
  // ---------------------------------------------------------------------------
  it("cleanup() removes expired and orphans", async () => {
    cache = new CacheManager(state, {
      enabled: true,
      autoClean: false,
      metadata: { ttl: 1, staleTtl: 0 },
    });
    await cache.initialize();

    await cache.set("cleanup-key", "v", "metadata");
    await new Promise((r) => setTimeout(r, 20));

    // Create an orphan file manually
    const orphanPath = join(state.paths.cache, "metadata", "orphan.json");
    mkdirSync(join(state.paths.cache, "metadata"), { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(orphanPath, "{}");

    const result = await cache.cleanup();
    expect(result.expired).toBe(1);
    expect(result.orphans).toBe(1);
    expect(existsSync(orphanPath)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 26. disabled cache returns null for all operations
  // ---------------------------------------------------------------------------
  it("disabled cache returns null for all operations", async () => {
    cache = new CacheManager(state, { enabled: false, autoClean: false });
    await cache.initialize();

    await cache.set("k", "v", "metadata");
    const get = await cache.get("k", "metadata");
    expect(get).toBeNull();

    const getRaw = await cache.getRaw("k", "metadata");
    expect(getRaw).toBeNull();

    expect(cache.has("k", "metadata")).toBe(false);
    expect(cache.getState("k", "metadata")).toBe("missing");
    expect(cache.enabled).toBe(false);

    const stats = cache.stats;
    expect(stats.writes).toBe(0);
    expect(stats.misses).toBe(2); // get + getRaw
  });

  // ---------------------------------------------------------------------------
  // 27. multiple layers work independently
  // ---------------------------------------------------------------------------
  it("multiple layers work independently", async () => {
    await cache.set("shared-key", "metadata-val", "metadata");
    await cache.set("shared-key", "content-val", "content");
    await cache.set("shared-key", "artifact-val", "artifacts");

    const meta = await cache.get<string>("shared-key", "metadata");
    const content = await cache.get<string>("shared-key", "content");
    const art = await cache.get<string>("shared-key", "artifacts");

    expect(meta!.data).toBe("metadata-val");
    expect(content!.data).toBe("content-val");
    expect(art!.data).toBe("artifact-val");

    // Invalidating one layer doesn't affect others
    await cache.invalidateLayer("content");
    expect(await cache.get("shared-key", "content")).toBeNull();
    expect(await cache.get("shared-key", "metadata")).not.toBeNull();
    expect(await cache.get("shared-key", "artifacts")).not.toBeNull();
  });
});
