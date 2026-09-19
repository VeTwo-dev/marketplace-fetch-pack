import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CacheManager } from "../../src/cache/CacheManager.js";
import { MarketplaceStateManager } from "../../src/state/index.js";
import { CacheInvalidationGraph } from "../../src/cache/invalidation.js";

describe("CacheInvalidationGraph", () => {
  let dir: string;
  let cache: CacheManager;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vetwo-inval-"));
    const state = new MarketplaceStateManager(dir);
    await state.initialize();
    cache = new CacheManager(state);
    await cache.initialize();
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("selective invalidation removes only requested keys", async () => {
    await cache.set("k1", { v: 1 }, "metadata");
    await cache.set("k2", { v: 2 }, "metadata");
    const graph = new CacheInvalidationGraph(cache);
    const n = await graph.selectiveInvalidation(["k1"]);
    expect(n).toBe(1);
    expect(cache.has("k1", "metadata")).toBe(false);
    expect(cache.has("k2", "metadata")).toBe(true);
  });

  it("fullReset clears all", async () => {
    await cache.set("k1", { v: 1 }, "content");
    const graph = new CacheInvalidationGraph(cache);
    await graph.fullReset();
    expect(cache.has("k1", "content")).toBe(false);
  });

  it("onResourceUpdated invalidates matching entries", async () => {
    await cache.set("resource:my-res:1.0", { id: "my-res" }, "metadata", { repository: "my-res" });
    const graph = new CacheInvalidationGraph(cache);
    const n = await graph.onResourceUpdated("my-res");
    expect(n).toBeGreaterThanOrEqual(1);
  });
});
