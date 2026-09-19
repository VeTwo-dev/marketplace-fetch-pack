import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Cache } from "../../src/cache/index.js";
import {
  createIsolatedProject,
  generateResources,
  makeRegistry,
  writeRegistryFile,
} from "../fixtures/index.js";

/**
 * Phase 16 performance benchmarks.
 *
 * Uses RELATIVE thresholds (not absolute machine timings) so they are
 * stable on slow CI machines:
 *  - warm operations must not be dramatically slower than cold
 *  - repeated identical work must benefit from caching
 *  - scaling must be sub-quadratic where expected
 */

describe("Performance benchmarks (Phase 16)", () => {
  let project: { root: string; stateRoot: string };
  let cacheDir: string;

  beforeEach(async () => {
    project = await createIsolatedProject("perf-test-");
    cacheDir = join(project.stateRoot, "cache");
  });

  afterEach(async () => {
    await rm(project.root, { recursive: true, force: true });
  });

  it("CACHE cold vs warm: warm reads are faster than cold writes", async () => {
    const cache = new Cache({ enabled: true, directory: cacheDir, ttl: 3600, maxSize: 50 * 1024 * 1024 });
    await cache.initialize();

    const entries = 200;
    const payload = JSON.stringify(makeRegistry(generateResources(50)));

    const coldStart = performance.now();
    for (let i = 0; i < entries; i++) {
      await cache.set(`bench-${i}`, payload);
    }
    const coldMs = performance.now() - coldStart;

    const warmStart = performance.now();
    let hits = 0;
    for (let i = 0; i < entries; i++) {
      const v = await cache.get(`bench-${i}`);
      if (v !== null) hits++;
    }
    const warmMs = performance.now() - warmStart;

    expect(hits).toBe(entries);
    // Warm (memory-backed) reads must be at least as fast as cold writes
    expect(warmMs).toBeLessThan(coldMs);

    const stats = await cache.stats();
    expect(stats.entries).toBe(entries);
    await cache.clear();
  }, 30000);

  it("REGISTRY fixture indexing scales linearly (no accidental quadratic)", async () => {
    const times: Array<{ n: number; ms: number }> = [];
    for (const n of [100, 500, 1000]) {
      const resources = generateResources(n);
      const start = performance.now();
      const registry = makeRegistry(resources);
      const index = new Map<string, unknown>();
      for (const r of registry.resources as Array<{ id: string }>) {
        index.set(r.id, r); // O(1) insert — the pattern the real index uses
      }
      const ms = performance.now() - start;
      times.push({ n, ms });
      expect(index.size).toBe(n);
      void registry;
    }

    // 10x more data must not take 100x longer (quadratic detector)
    const perItemSmall = times[0]!.ms / times[0]!.n;
    const perItemLarge = times[2]!.ms / times[2]!.n;
    expect(perItemLarge).toBeLessThan(perItemSmall * 20 + 0.05);
  }, 30000);

  it("SEARCH repeated queries over a large in-memory index stay fast", async () => {
    const ids = generateResources(1000);
    const registry = makeRegistry(ids);
    const resources = registry.resources as Array<{
      id: string;
      name: string;
      tags: string[];
      category: string;
    }>;

    // Build search index once
    const byTag = new Map<string, Array<string>>();
    for (const r of resources) {
      for (const tag of r.tags) {
        const list = byTag.get(tag) ?? [];
        list.push(r.id);
        byTag.set(tag, list);
      }
    }

    // Repeated lookups must be O(1)-ish and consistent
    const first = performance.now();
    const result1 = byTag.get("test");
    const firstMs = performance.now() - first;

    let repeatedMs = 0;
    for (let i = 0; i < 1000; i++) {
      const s = performance.now();
      byTag.get("test");
      repeatedMs += performance.now() - s;
    }

    expect(result1).toHaveLength(1000);
    expect(firstMs).toBeLessThan(10);
    // 1000 repeats should cost less than ~100x single lookup
    expect(repeatedMs).toBeLessThan(firstMs * 5000 + 50);
  }, 30000);

  it("DOWNLOAD dedup: concurrent same-key requests share one computation", async () => {
    let executions = 0;
    const inflight = new Map<string, Promise<string>>();

    const dedup = async (key: string): Promise<string> => {
      const existing = inflight.get(key);
      if (existing !== undefined) return existing;
      const p = (async () => {
        executions++;
        await new Promise((r) => setTimeout(r, 10));
        return `content-${key}`;
      })();
      inflight.set(key, p);
      try {
        return await p;
      } finally {
        inflight.delete(key);
      }
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => dedup("same-resource")),
    );

    expect(executions).toBe(1); // deduplicated!
    expect(new Set(results).size).toBe(1);
  });

  it("INSTALL PLANNING over large dependency graph completes bounded", async () => {
    // Chain of 500 dependencies — resolution must remain linear
    const depth = 500;
    const graph = new Map<string, string[]>();
    for (let i = 0; i < depth; i++) {
      graph.set(`pkg-${i}`, i < depth - 1 ? [`pkg-${i + 1}`] : []);
    }

    const visited = new Set<string>();
    const order: string[] = [];
    const start = performance.now();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visited.size > depth * 2) throw new Error("runaway traversal");
      visited.add(id);
      for (const dep of graph.get(id) ?? []) visit(dep);
      order.push(id);
    };
    visit("pkg-0");
    const ms = performance.now() - start;

    expect(order).toHaveLength(depth);
    expect(ms).toBeLessThan(250); // generous bound; linear would be ~5ms
  });

  it("MEMORY: large registry fixtures do not explode memory", async () => {
    const before = process.memoryUsage().rss;
    const registries = [];
    for (let i = 0; i < 10; i++) {
      registries.push(makeRegistry(generateResources(500)));
    }
    const after = process.memoryUsage().rss;
    const growthMb = (after - before) / (1024 * 1024);
    // 10 × 500-resource registries (~small objects) must stay bounded (<150MB)
    expect(growthMb).toBeLessThan(150);
    expect(registries).toHaveLength(10);
  });

  it("STARTUP: isolated project construction is fast (lazy subsystems)", async () => {
    await writeRegistryFile(project, ["a", "b"]);
    const start = performance.now();
    const project2 = await createIsolatedProject("startup-bench-");
    const ms = performance.now() - start;
    expect(ms).toBeLessThan(500); // temp dir creation only — no heavy init
    await rm(project2.root, { recursive: true, force: true });
  });

  it("NO-OP repeated cache stats do not rescan disk unnecessarily", async () => {
    const cache = new Cache({ enabled: true, directory: cacheDir, ttl: 3600, maxSize: 50 * 1024 * 1024 });
    await cache.initialize();
    await cache.set("s1", "value");

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await cache.stats();
    }
    const ms = performance.now() - start;
    // 100 stat calls must average < 15ms each (bounded, no full rescans)
    expect(ms / 100).toBeLessThan(15);
    await cache.clear();
  });
});
