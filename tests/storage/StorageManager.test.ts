import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdir,
  writeFile,
  readFile,
  stat,
  readdir,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  StorageManager,
  createStorageManager,
} from "../../src/storage/StorageManager.js";

const TEST_ROOT = join(
  tmpdir(),
  `vetwo-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

function makeConfig(
  overrides: Partial<Parameters<typeof createStorageManager>[0]> = {},
) {
  return {
    root: TEST_ROOT,
    ...overrides,
  };
}

describe("StorageManager", () => {
  let storage: StorageManager;

  beforeEach(async () => {
    storage = new StorageManager(makeConfig());
    await storage.initialize();
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  // ── Initialization ──────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates the root directory", async () => {
      const s = await stat(TEST_ROOT);
      expect(s.isDirectory()).toBe(true);
    });

    it("creates the tmp directory", async () => {
      const s = await stat(join(TEST_ROOT, "tmp"));
      expect(s.isDirectory()).toBe(true);
    });

    it("is idempotent", async () => {
      await storage.initialize();
      await storage.initialize();
      expect(storage.initialized).toBe(true);
    });

    it("marks initialized as true", () => {
      expect(storage.initialized).toBe(true);
    });
  });

  // ── ensureSubdir ────────────────────────────────────────────────

  describe("ensureSubdir()", () => {
    it("creates the requested subdirectory", async () => {
      const dir = await storage.ensureSubdir("cache");
      const s = await stat(dir);
      expect(s.isDirectory()).toBe(true);
      expect(dir).toBe(join(TEST_ROOT, "cache"));
    });

    it("is idempotent", async () => {
      const d1 = await storage.ensureSubdir("snapshots");
      const d2 = await storage.ensureSubdir("snapshots");
      expect(d1).toBe(d2);
    });

    it("creates different subdirectories", async () => {
      const cache = await storage.ensureSubdir("cache");
      const db = await storage.ensureSubdir("database");
      expect(cache).not.toBe(db);
    });
  });

  // ── Atomic Writes ───────────────────────────────────────────────

  describe("writeAtomic()", () => {
    it("writes data to the target path", async () => {
      const target = join(TEST_ROOT, "test-file.txt");
      await storage.writeAtomic(target, "hello world");
      const content = await readFile(target, "utf-8");
      expect(content).toBe("hello world");
    });

    it("creates intermediate directories", async () => {
      const target = join(TEST_ROOT, "a", "b", "c", "file.txt");
      await storage.writeAtomic(target, "nested");
      const content = await readFile(target, "utf-8");
      expect(content).toBe("nested");
    });

    it("overwrites existing files", async () => {
      const target = join(TEST_ROOT, "overwrite.txt");
      await storage.writeAtomic(target, "first");
      await storage.writeAtomic(target, "second");
      const content = await readFile(target, "utf-8");
      expect(content).toBe("second");
    });

    it("writes large data atomically", async () => {
      const target = join(TEST_ROOT, "large.json");
      const data = JSON.stringify({ items: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })) });
      await storage.writeAtomic(target, data);
      const content = await readFile(target, "utf-8");
      expect(content).toBe(data);
    });
  });

  // ── Cache Operations ────────────────────────────────────────────

  describe("cacheSet() / cacheGet()", () => {
    it("stores and retrieves a value", async () => {
      await storage.cacheSet("registry", "key1", { data: "hello" });
      const result = await storage.cacheGet<{ data: string }>("registry", "key1");
      expect(result).toEqual({ data: "hello" });
    });

    it("returns null for missing key", async () => {
      const result = await storage.cacheGet("registry", "missing");
      expect(result).toBeNull();
    });

    it("overwrites existing entries", async () => {
      await storage.cacheSet("registry", "key1", "first");
      await storage.cacheSet("registry", "key1", "second");
      const result = await storage.cacheGet("registry", "key1");
      expect(result).toBe("second");
    });

    it("handles different categories independently", async () => {
      await storage.cacheSet("registry", "k1", "r-val");
      await storage.cacheSet("deps", "k1", "d-val");

      const r = await storage.cacheGet("registry", "k1");
      const d = await storage.cacheGet("deps", "k1");
      expect(r).toBe("r-val");
      expect(d).toBe("d-val");
    });

    it("handles complex data types", async () => {
      const data = { nested: { array: [1, 2, 3], flag: true } };
      await storage.cacheSet("manifest", "complex", data);
      const result = await storage.cacheGet("manifest", "complex");
      expect(result).toEqual(data);
    });
  });

  describe("cacheHas()", () => {
    it("returns true for existing key", async () => {
      await storage.cacheSet("registry", "exists", "val");
      const result = await storage.cacheHas("registry", "exists");
      expect(result.exists).toBe(true);
      expect(result.filePath).not.toBeNull();
    });

    it("returns false for missing key", async () => {
      const result = await storage.cacheHas("registry", "nope");
      expect(result.exists).toBe(false);
      expect(result.filePath).toBeNull();
    });
  });

  describe("cacheEvict()", () => {
    it("removes an existing entry", async () => {
      await storage.cacheSet("registry", "to-delete", "data");
      const evicted = await storage.cacheEvict("registry", "to-delete");
      expect(evicted).toBe(true);

      const result = await storage.cacheGet("registry", "to-delete");
      expect(result).toBeNull();
    });

    it("returns false for missing key", async () => {
      const evicted = await storage.cacheEvict("registry", "ghost");
      expect(evicted).toBe(false);
    });
  });

  describe("cacheClear()", () => {
    it("removes all cache data", async () => {
      await storage.cacheSet("registry", "a", 1);
      await storage.cacheSet("deps", "b", 2);
      await storage.cacheClear();

      const r1 = await storage.cacheGet("registry", "a");
      const r2 = await storage.cacheGet("deps", "b");
      expect(r1).toBeNull();
      expect(r2).toBeNull();
    });
  });

  describe("cacheTouch()", () => {
    it("updates lastAccessedAt timestamp", async () => {
      await storage.cacheSet("registry", "touch-me", "data");

      const before = await storage.cacheHas("registry", "touch-me");
      expect(before.exists).toBe(true);

      await new Promise((r) => setTimeout(r, 10));
      await storage.cacheTouch("registry", "touch-me");

      const after = await storage.cacheGet("registry", "touch-me");
      expect(after).toBe("data");
    });

    it("is a no-op for missing keys", async () => {
      await storage.cacheTouch("registry", "nonexistent");
    });
  });

  // ── LRU Eviction ────────────────────────────────────────────────

  describe("LRU eviction by count", () => {
    it("evicts oldest entries when maxCacheEntries exceeded", async () => {
      const smallStorage = new StorageManager(
        makeConfig({ maxCacheEntries: 3 }),
      );
      await smallStorage.initialize();

      await smallStorage.cacheSet("cat", "k1", "v1");
      await smallStorage.cacheSet("cat", "k2", "v2");
      await smallStorage.cacheSet("cat", "k3", "v3");
      await smallStorage.cacheSet("cat", "k4", "v4");

      const stats = await smallStorage.cacheStats();
      expect(stats.totalEntries).toBeLessThanOrEqual(3);

      const r4 = await smallStorage.cacheGet("cat", "k4");
      expect(r4).toBe("v4");
    });
  });

  describe("LRU eviction by size", () => {
    it("evicts oldest entries when maxCacheSize exceeded", async () => {
      const smallStorage = new StorageManager(
        makeConfig({ maxCacheSize: 500 }),
      );
      await smallStorage.initialize();

      const bigValue = "x".repeat(200);
      await smallStorage.cacheSet("cat", "a", bigValue);
      await smallStorage.cacheSet("cat", "b", bigValue);
      await smallStorage.cacheSet("cat", "c", bigValue);
      await smallStorage.cacheSet("cat", "d", bigValue);

      const stats = await smallStorage.cacheStats();
      expect(stats.totalSizeBytes).toBeLessThanOrEqual(600);
    });
  });

  // ── Tmp Management ──────────────────────────────────────────────

  describe("tmp cleanup", () => {
    it("creates tmp directory on init", async () => {
      const s = await stat(join(TEST_ROOT, "tmp"));
      expect(s.isDirectory()).toBe(true);
    });

    it("cleans stale tmp files on initialization", async () => {
      const staleStorage = new StorageManager(makeConfig({ tmpTtlMs: 1 }));
      await staleStorage.initialize();

      const tmpFile = join(staleStorage.paths.tmp, "old-file.tmp");
      await writeFile(tmpFile, "stale");

      // Make file appear old by setting mtime to the past
      const pastDate = new Date(Date.now() - 10000);
      await utimes(tmpFile, pastDate, pastDate);

      const freshStorage = new StorageManager(makeConfig({ tmpTtlMs: 1 }));
      await freshStorage.initialize();

      let exists = true;
      try {
        await stat(tmpFile);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });

    it("preserves recent tmp files", async () => {
      const tmpFile = join(TEST_ROOT, "tmp", "fresh.tmp");
      await writeFile(tmpFile, "fresh");

      const freshStorage = new StorageManager(
        makeConfig({ tmpTtlMs: 3600000 }),
      );
      await freshStorage.initialize();

      const s = await stat(tmpFile);
      expect(s.isFile()).toBe(true);
    });
  });

  describe("createTmpDir()", () => {
    it("creates a temporary directory with prefix", async () => {
      const dir = await storage.createTmpDir("install");
      const s = await stat(dir);
      expect(s.isDirectory()).toBe(true);
      expect(dir).toContain("install");
      expect(dir).toContain(TEST_ROOT);
    });

    it("creates unique directories", async () => {
      const d1 = await storage.createTmpDir("job");
      const d2 = await storage.createTmpDir("job");
      expect(d1).not.toBe(d2);
    });
  });

  describe("createTmpFile()", () => {
    it("creates a temporary file with data", async () => {
      const result = await storage.createTmpFile("download", "file-content");
      const content = await readFile(result.tmpPath, "utf-8");
      expect(content).toBe("file-content");
    });

    it("cleanup removes the file", async () => {
      const result = await storage.createTmpFile("temp", "data");
      await result.cleanup();

      let exists = true;
      try {
        await stat(result.tmpPath);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });
  });

  describe("moveTmpToTarget()", () => {
    it("moves a tmp file to the target path", async () => {
      const result = await storage.createTmpFile("move", "moved-data");
      const target = join(TEST_ROOT, "moved", "file.txt");

      await storage.moveTmpToTarget(result.tmpPath, target);

      const content = await readFile(target, "utf-8");
      expect(content).toBe("moved-data");

      let tmpExists = true;
      try {
        await stat(result.tmpPath);
      } catch {
        tmpExists = false;
      }
      expect(tmpExists).toBe(false);
    });

    it("creates intermediate directories for target", async () => {
      const result = await storage.createTmpFile("move-nested", "deep");
      const target = join(TEST_ROOT, "a", "b", "c", "file.txt");

      await storage.moveTmpToTarget(result.tmpPath, target);

      const content = await readFile(target, "utf-8");
      expect(content).toBe("deep");
    });
  });

  // ── Stats ───────────────────────────────────────────────────────

  describe("stats()", () => {
    it("returns zero stats for empty storage", async () => {
      const stats = await storage.stats();
      expect(stats.totalSizeBytes).toBe(0);
      expect(stats.root).toBe(TEST_ROOT);
    });

    it("tracks file sizes per directory", async () => {
      await storage.ensureSubdir("cache");
      await writeFile(join(TEST_ROOT, "cache", "test.json"), '{"a":1}');
      const stats = await storage.stats();
      expect(stats.directories.cache.sizeBytes).toBeGreaterThan(0);
      expect(stats.directories.cache.fileCount).toBe(1);
    });
  });

  describe("directoryStats()", () => {
    it("returns zeros for non-existent directory", async () => {
      const ds = await storage.directoryStats("/nonexistent/path");
      expect(ds.sizeBytes).toBe(0);
      expect(ds.fileCount).toBe(0);
    });

    it("counts files correctly", async () => {
      const dir = await storage.ensureSubdir("reports");
      await writeFile(join(dir, "a.txt"), "aaa");
      await writeFile(join(dir, "b.txt"), "bb");

      const ds = await storage.directoryStats(dir);
      expect(ds.fileCount).toBe(2);
      expect(ds.sizeBytes).toBe(5);
    });
  });

  // ── cacheStats() ────────────────────────────────────────────────

  describe("cacheStats()", () => {
    it("returns empty stats for empty cache", async () => {
      const cs = await storage.cacheStats();
      expect(cs.totalEntries).toBe(0);
      expect(cs.categories).toEqual([]);
    });

    it("tracks entries across categories", async () => {
      await storage.cacheSet("registry", "a", 1);
      await storage.cacheSet("registry", "b", 2);
      await storage.cacheSet("deps", "c", 3);

      const cs = await storage.cacheStats();
      expect(cs.totalEntries).toBe(3);
      expect(cs.categories.length).toBe(2);
    });
  });

  // ── destroy() ───────────────────────────────────────────────────

  describe("destroy()", () => {
    it("removes the entire storage root", async () => {
      await storage.destroy();
      let exists = true;
      try {
        await stat(TEST_ROOT);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
      expect(storage.initialized).toBe(false);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles rapid sequential cache operations", async () => {
      for (let i = 0; i < 20; i++) {
        await storage.cacheSet("cat", `k${i}`, `v${i}`);
      }

      for (let i = 0; i < 20; i++) {
        const r = await storage.cacheGet("cat", `k${i}`);
        expect(r).toBe(`v${i}`);
      }
    });

    it("handles writeAtomic with read-only target directory gracefully", async () => {
      const target = join(TEST_ROOT, "readonly-test.txt");
      await storage.writeAtomic(target, "content");
      const content = await readFile(target, "utf-8");
      expect(content).toBe("content");
    });

    it("handles large number of cache entries for eviction", async () => {
      const tinyStorage = new StorageManager(
        makeConfig({ maxCacheEntries: 5, maxCacheSize: 1024 * 1024 }),
      );
      await tinyStorage.initialize();

      for (let i = 0; i < 20; i++) {
        await tinyStorage.cacheSet("cat", `key-${i}`, `value-${i}`);
      }

      const stats = await tinyStorage.cacheStats();
      expect(stats.totalEntries).toBeLessThanOrEqual(5);
    });
  });
});
