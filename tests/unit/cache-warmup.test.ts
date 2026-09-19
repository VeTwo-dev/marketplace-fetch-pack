import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CacheManager } from "../../src/cache/CacheManager.js";
import { MarketplaceStateManager } from "../../src/state/index.js";
import { CacheWarmup } from "../../src/cache/warmup.js";

describe("CacheWarmup", () => {
  let dir: string;
  let cache: CacheManager;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vetwo-warmup-"));
    const state = new MarketplaceStateManager(dir);
    await state.initialize();
    cache = new CacheManager(state);
    await cache.initialize();
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("prefetch populates cache", async () => {
    const w = new CacheWarmup(cache);
    const results = await w.prefetch(["a", "b"], async (k) => ({ key: k }), "content");
    expect(results.size).toBe(2);
    expect(cache.has("a", "content")).toBe(true);
  });

  it("prefetch respects existing cache", async () => {
    await cache.set("a", { key: "a" }, "content");
    const w = new CacheWarmup(cache);
    let factoryCalls = 0;
    await w.prefetch(["a"], async () => { factoryCalls++; return { key: "a" }; }, "content");
    expect(factoryCalls).toBe(0);
  });

  it("prefetch respects abort signal", async () => {
    const w = new CacheWarmup(cache);
    const ac = new AbortController();
    ac.abort();
    const results = await w.prefetch(["a", "b", "c"], async (k) => ({ key: k }), "content", { signal: ac.signal });
    expect(results.size).toBe(0);
  });
});
