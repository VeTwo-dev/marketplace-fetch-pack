import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DownloadEngine } from "../../src/download/DownloadEngine.js";
import { CacheManager } from "../../src/cache/CacheManager.js";
import { MarketplaceStateManager } from "../../src/state/index.js";
import {
  MockTransport,
  createSuccessHandler,
  createErrorHandler,
} from "../../src/network/mock-transport.js";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type {
  DownloadRequest,
  DownloadMetadata,
} from "../../src/download/types.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("DownloadEngine", () => {
  let tmpDir: string;
  let state: MarketplaceStateManager;
  let cache: CacheManager;
  let engine: DownloadEngine;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tmpDir = join(
      tmpdir(),
      `vetwo-dl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    state = new MarketplaceStateManager(tmpDir);
    await state.initialize();
    cache = new CacheManager(state, { enabled: true, autoClean: false });
    await cache.initialize();
    engine = new DownloadEngine(
      state,
      cache,
      new MockTransport(createSuccessHandler("hello")),
    );
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await cache.clearAll().catch(() => {});
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("initialization", () => {
    it("initializes with correct directories", async () => {
      expect(state.paths.root).toContain(".vetwo/marketplace");
      expect(existsSync(state.paths.cache)).toBe(true);
      expect(existsSync(state.paths.tmp)).toBe(false);
    });

    it("creates tmp directory on first download", async () => {
      globalThis.fetch = async () => new Response("content", { status: 200 });
      const dest = join(tmpDir, "output.bin");
      await engine.download({
        url: "https://example.com/file.bin",
        destination: dest,
      });
      expect(existsSync(state.paths.tmp)).toBe(true);
    });
  });

  describe("cache-first downloads", () => {
    it("returns cached content without download", async () => {
      const url = "https://example.com/cached.txt";
      const dest = join(tmpDir, "cached.txt");
      const content = "cached data";
      const checksum = sha256Hex(content);
      const metadata: DownloadMetadata = {
        url,
        checksum,
        size: content.length,
        downloadedAt: new Date().toISOString(),
        filePath: dest,
      };
      await cache.set(url, metadata, "content", {
        contentType: "application/octet-stream",
        source: "download-engine",
      });

      writeFileSync(dest, content);

      let fetchCallCount = 0;
      globalThis.fetch = async () => {
        fetchCallCount++;
        return new Response("should not be called", { status: 200 });
      };

      const result = await engine.download({ url, destination: dest });
      expect(fetchCallCount).toBe(0);
      expect(result.fromCache).toBe(true);
      expect(result.success).toBe(true);
    });

    it("invalidates cache and re-downloads on invalidation", async () => {
      const url = "https://example.com/invalidated.txt";
      const dest = join(tmpDir, "invalidated.txt");
      const metadata: DownloadMetadata = {
        url,
        checksum: "old-hash",
        size: 8,
        downloadedAt: new Date().toISOString(),
      };
      await cache.set(url, metadata, "content");

      await engine.invalidateCache(url);

      globalThis.fetch = async () =>
        new Response("new content", { status: 200 });
      const result = await engine.download({ url, destination: dest });
      expect(result.fromCache).toBe(false);
      expect(result.success).toBe(true);
    });
  });

  describe("deduplication", () => {
    it("same URL returns shared result for concurrent calls", async () => {
      const url = "https://example.com/shared.txt";
      const dest = join(tmpDir, "shared.txt");
      const content = "shared content";
      let fetchCount = 0;

      globalThis.fetch = async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 50));
        return new Response(content, { status: 200 });
      };

      const [r1, r2, r3] = await Promise.all([
        engine.download({ url, destination: dest }),
        engine.download({ url, destination: dest }),
        engine.download({ url, destination: dest }),
      ]);

      expect(fetchCount).toBe(1);
      expect(r1.checksum).toBe(r2.checksum);
      expect(r2.checksum).toBe(r3.checksum);
      expect(r1.success).toBe(true);
    });

    it("different URLs are not deduplicated", async () => {
      const dest1 = join(tmpDir, "file1.txt");
      const dest2 = join(tmpDir, "file2.txt");
      let fetchCount = 0;

      globalThis.fetch = async () => {
        fetchCount++;
        return new Response("content", { status: 200 });
      };

      await Promise.all([
        engine.download({
          url: "https://example.com/a.txt",
          destination: dest1,
        }),
        engine.download({
          url: "https://example.com/b.txt",
          destination: dest2,
        }),
      ]);

      expect(fetchCount).toBe(2);
    });

    it("different destinations for same URL are not deduplicated", async () => {
      const dest1 = join(tmpDir, "copy1.txt");
      const dest2 = join(tmpDir, "copy2.txt");
      let fetchCount = 0;

      globalThis.fetch = async () => {
        fetchCount++;
        return new Response("content", { status: 200 });
      };

      await Promise.all([
        engine.download({
          url: "https://example.com/same.txt",
          destination: dest1,
        }),
        engine.download({
          url: "https://example.com/same.txt",
          destination: dest2,
        }),
      ]);

      expect(fetchCount).toBe(2);
    });
  });

  describe("integrity verification", () => {
    it("passes integrity check with correct checksum", async () => {
      const url = "https://example.com/verified.bin";
      const dest = join(tmpDir, "verified.bin");
      const content = "verified content";
      const expectedChecksum = sha256Hex(content);

      globalThis.fetch = async () => new Response(content, { status: 200 });

      const result = await engine.download({
        url,
        destination: dest,
        expectedChecksum,
      });

      expect(result.success).toBe(true);
      expect(result.checksum).toBe(expectedChecksum);
    });

    it("fails integrity check with wrong checksum", async () => {
      const url = "https://example.com/bad-checksum.bin";
      const dest = join(tmpDir, "bad-checksum.bin");
      const content = "some content";
      const wrongChecksum = sha256Hex("completely different content");

      globalThis.fetch = async () => new Response(content, { status: 200 });

      await expect(
        engine.download({
          url,
          destination: dest,
          expectedChecksum: wrongChecksum,
          retries: 0,
        }),
      ).rejects.toThrow(MarketplaceClientError);
    });

    it("INTEGRITY_CHECK_FAILED error has correct code", async () => {
      const url = "https://example.com/integrity.bin";
      const dest = join(tmpDir, "integrity.bin");
      const content = "real content";
      const wrongChecksum =
        "0000000000000000000000000000000000000000000000000000000000000000";

      globalThis.fetch = async () => new Response(content, { status: 200 });

      try {
        await engine.download({
          url,
          destination: dest,
          expectedChecksum: wrongChecksum,
          retries: 0,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MarketplaceClientError);
        expect((error as MarketplaceClientError).code).toBe(
          "INTEGRITY_CHECK_FAILED",
        );
      }
    });
  });

  describe("metadata storage", () => {
    it("stores metadata after download", async () => {
      const url = "https://example.com/meta.txt";
      const dest = join(tmpDir, "meta.txt");
      const content = "metadata test";

      globalThis.fetch = async () => new Response(content, { status: 200 });

      await engine.download({ url, destination: dest });
      const metadata = await engine.getMetadata(url);

      expect(metadata).not.toBeNull();
      expect(metadata!.url).toBe(url);
      expect(metadata!.checksum).toBe(sha256Hex(content));
      expect(metadata!.size).toBe(content.length);
      expect(metadata!.filePath).toBe(dest);
      expect(metadata!.downloadedAt).toBeDefined();
    });

    it("metadata includes checksum and size", async () => {
      const url = "https://example.com/details.bin";
      const dest = join(tmpDir, "details.bin");
      const content = "detailed content here";

      globalThis.fetch = async () => new Response(content, { status: 200 });

      await engine.download({ url, destination: dest });
      const metadata = await engine.getMetadata(url);

      expect(metadata!.checksum).toBe(sha256Hex(content));
      expect(metadata!.size).toBe(Buffer.byteLength(content));
    });

    it("returns null metadata for non-existent URL", async () => {
      const metadata = await engine.getMetadata(
        "https://nonexistent.com/x.bin",
      );
      expect(metadata).toBeNull();
    });
  });

  describe("overwrite behavior", () => {
    it("overwrites existing file when overwrite=true", async () => {
      const dest = join(tmpDir, "overwrite.txt");
      writeFileSync(dest, "old content");

      globalThis.fetch = async () =>
        new Response("new content", { status: 200 });

      const result = await engine.download({
        url: "https://example.com/overwrite.txt",
        destination: dest,
        overwrite: true,
      });

      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(readFileSync(dest, "utf-8")).toBe("new content");
    });

    it("skips download when file exists and overwrite=false", async () => {
      const dest = join(tmpDir, "existing.txt");
      const content = "existing content";
      writeFileSync(dest, content);

      let fetchCount = 0;
      globalThis.fetch = async () => {
        fetchCount++;
        return new Response("should not happen", { status: 200 });
      };

      const result = await engine.download({
        url: "https://example.com/existing.txt",
        destination: dest,
        overwrite: false,
      });

      expect(fetchCount).toBe(0);
      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(readFileSync(dest, "utf-8")).toBe(content);
    });

    it("re-downloads when existing file fails checksum match", async () => {
      const dest = join(tmpDir, "mismatch.txt");
      writeFileSync(dest, "old content");

      globalThis.fetch = async () =>
        new Response("new content", { status: 200 });

      const result = await engine.download({
        url: "https://example.com/mismatch.txt",
        destination: dest,
        overwrite: false,
        expectedChecksum: sha256Hex("new content"),
      });

      expect(result.fromCache).toBe(false);
      expect(readFileSync(dest, "utf-8")).toBe("new content");
    });
  });

  describe("error handling", () => {
    it("throws structured error on HTTP failure", async () => {
      globalThis.fetch = async () =>
        new Response("Not Found", { status: 404, statusText: "Not Found" });

      await expect(
        engine.download({
          url: "https://example.com/404.bin",
          destination: join(tmpDir, "404.bin"),
          retries: 0,
        }),
      ).rejects.toThrow(MarketplaceClientError);
    });

    it("throws DOWNLOAD_FAILED error code on network error", async () => {
      globalThis.fetch = async () => {
        throw new TypeError("fetch failed");
      };

      try {
        await engine.download({
          url: "https://example.com/err.bin",
          destination: join(tmpDir, "err.bin"),
          retries: 0,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MarketplaceClientError);
        expect((error as MarketplaceClientError).code).toBe("DOWNLOAD_FAILED");
      }
    });

    it("retries failed downloads up to configured limit", async () => {
      let attempt = 0;
      globalThis.fetch = async () => {
        attempt++;
        throw new TypeError("transient error");
      };

      try {
        await engine.download({
          url: "https://example.com/retry.bin",
          destination: join(tmpDir, "retry.bin"),
          retries: 2,
        });
        expect.fail("Should have thrown");
      } catch {
        expect(attempt).toBe(3);
      }
    });

    it("fails fast on a persistent rate-limit wall (two strikes)", async () => {
      let attempt = 0;
      globalThis.fetch = async () => {
        attempt++;
        return new Response("limited", {
          status: 429,
          headers: { "retry-after": "3600" },
        });
      };

      const fastEngine = new DownloadEngine(
        state,
        cache,
        new MockTransport(),
        { maxConcurrency: 2 },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 200 },
      );
      const t0 = Date.now();
      await expect(
        fastEngine.download({
          url: "https://example.com/limited.bin",
          destination: join(tmpDir, "limited.bin"),
          retries: 3,
        }),
      ).rejects.toThrow(/rate limit/i);
      // One capped wait + one confirmation strike — not minutes of retries.
      expect(attempt).toBe(2);
      expect(Date.now() - t0).toBeLessThan(10000);
    });

    it("does not retry on cancellation", async () => {
      const controller = new AbortController();
      let attempt = 0;

      globalThis.fetch = async (url, init) => {
        attempt++;
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      };

      try {
        await engine.download({
          url: "https://example.com/cancel.bin",
          destination: join(tmpDir, "cancel.bin"),
          signal: controller.signal,
          retries: 3,
        });
      } catch {
        expect(attempt).toBe(1);
      }
    });
  });

  describe("batch downloads", () => {
    it("batch download processes all files", async () => {
      globalThis.fetch = async (url) => {
        const u = url instanceof Request ? url.url : String(url);
        return new Response(`content-${u}`, { status: 200 });
      };

      const requests: DownloadRequest[] = [
        {
          url: "https://example.com/a.txt",
          destination: join(tmpDir, "batch-a.txt"),
        },
        {
          url: "https://example.com/b.txt",
          destination: join(tmpDir, "batch-b.txt"),
        },
        {
          url: "https://example.com/c.txt",
          destination: join(tmpDir, "batch-c.txt"),
        },
      ];

      const results = await engine.downloadBatch(requests);

      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r.success).toBe(true);
      }
      expect(existsSync(join(tmpDir, "batch-a.txt"))).toBe(true);
      expect(existsSync(join(tmpDir, "batch-b.txt"))).toBe(true);
      expect(existsSync(join(tmpDir, "batch-c.txt"))).toBe(true);
    });

    it("downloadBatch processes files sequentially within concurrency limit", async () => {
      const maxActive: number[] = [];
      let activeCount = 0;

      globalThis.fetch = async () => {
        activeCount++;
        maxActive.push(activeCount);
        await new Promise((r) => setTimeout(r, 10));
        activeCount--;
        return new Response("ok", { status: 200 });
      };

      const requests: DownloadRequest[] = Array.from({ length: 8 }, (_, i) => ({
        url: `https://example.com/seq-${i}.txt`,
        destination: join(tmpDir, `seq-${i}.txt`),
      }));

      engine = new DownloadEngine(state, cache, new MockTransport(), {
        maxConcurrency: 2,
      });
      await engine.downloadBatch(requests);

      expect(Math.max(...maxActive)).toBeLessThanOrEqual(2);
    });
  });

  describe("concurrency control", () => {
    it("respects maxConcurrency config", async () => {
      let activeCount = 0;
      let maxObserved = 0;

      globalThis.fetch = async () => {
        activeCount++;
        if (activeCount > maxObserved) maxObserved = activeCount;
        await new Promise((r) => setTimeout(r, 30));
        activeCount--;
        return new Response("ok", { status: 200 });
      };

      const engineLimited = new DownloadEngine(
        state,
        cache,
        new MockTransport(),
        { maxConcurrency: 1 },
      );
      const requests: DownloadRequest[] = Array.from({ length: 4 }, (_, i) => ({
        url: `https://example.com/conc-${i}.txt`,
        destination: join(tmpDir, `conc-${i}.txt`),
      }));

      await engineLimited.downloadBatch(requests);
      expect(maxObserved).toBe(1);
    });

    it("rejects when queue is full", async () => {
      globalThis.fetch = async () => {
        await new Promise((r) => setTimeout(r, 200));
        return new Response("ok", { status: 200 });
      };

      const engineSmallQueue = new DownloadEngine(
        state,
        cache,
        new MockTransport(),
        { maxConcurrency: 1, maxQueueSize: 2 },
      );

      const requests: DownloadRequest[] = Array.from({ length: 6 }, (_, i) => ({
        url: `https://example.com/queue-${i}.txt`,
        destination: join(tmpDir, `queue-${i}.txt`),
      }));

      const results = await Promise.allSettled(
        requests.map((r) => engineSmallQueue.download(r)),
      );

      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected.length).toBeGreaterThan(0);
    });
  });

  describe("cleanup", () => {
    it("cleanup removes orphaned temp files", async () => {
      globalThis.fetch = async () => new Response("content", { status: 200 });
      await engine.download({
        url: "https://example.com/x.bin",
        destination: join(tmpDir, "x.bin"),
      });

      const staleTmp = join(state.paths.tmp, "orphan-stale.tmp");
      writeFileSync(staleTmp, "stale data");
      const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(staleTmp, staleTime, staleTime);

      const fileStat = await import("node:fs/promises").then((m) =>
        m.stat(staleTmp),
      );
      expect(fileStat.mtimeMs).toBeLessThan(Date.now() - 60 * 60 * 1000);

      await engine.cleanup();
      expect(existsSync(staleTmp)).toBe(false);
    });

    it("cleanup removes stale temp files older than threshold", async () => {
      mkdirSync(state.paths.tmp, { recursive: true });
      const oldFile = join(state.paths.tmp, "very-old.tmp");
      writeFileSync(oldFile, "old");
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(oldFile, oldTime, oldTime);

      const recentFile = join(state.paths.tmp, "recent.tmp");
      writeFileSync(recentFile, "new");

      await engine.cleanup();
      expect(existsSync(oldFile)).toBe(false);
      expect(existsSync(recentFile)).toBe(true);
    });

    it("cleanup is safe to call when tmp dir does not exist", async () => {
      rmSync(state.paths.tmp, { recursive: true, force: true });
      await expect(engine.cleanup()).resolves.toBeUndefined();
    });

    it("temp files are cleaned up after successful download", async () => {
      globalThis.fetch = async () => new Response("content", { status: 200 });
      await engine.download({
        url: "https://example.com/final.bin",
        destination: join(tmpDir, "final.bin"),
      });

      const fs = await import("node:fs/promises");
      const files = await fs.readdir(state.paths.tmp);
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe("stats and result shape", () => {
    it("reports correct download stats", async () => {
      const content = "stat content";
      globalThis.fetch = async () => new Response(content, { status: 200 });

      const result = await engine.download({
        url: "https://example.com/stats.bin",
        destination: join(tmpDir, "stats.bin"),
      });

      expect(result.success).toBe(true);
      expect(result.size).toBe(Buffer.byteLength(content));
      expect(result.checksum).toBe(sha256Hex(content));
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.attempts).toBe(1);
      expect(result.path).toBe(join(tmpDir, "stats.bin"));
    });

    it("result includes correct fromCache flag", async () => {
      globalThis.fetch = async () => new Response("fresh", { status: 200 });

      const result = await engine.download({
        url: "https://example.com/fromcache.bin",
        destination: join(tmpDir, "fromcache.bin"),
      });

      expect(result.fromCache).toBe(false);
    });

    it("result passes through request metadata", async () => {
      globalThis.fetch = async () => new Response("meta", { status: 200 });
      const reqMetadata = { resourceId: "r-123", version: "1.0.0" };

      const result = await engine.download({
        url: "https://example.com/passmeta.bin",
        destination: join(tmpDir, "passmeta.bin"),
        metadata: reqMetadata,
      });

      expect(result.metadata).toEqual(reqMetadata);
    });
  });

  describe("subdirectory creation", () => {
    it("creates nested destination directories", async () => {
      const nestedDest = join(tmpDir, "a", "b", "c", "deep.txt");
      globalThis.fetch = async () => new Response("deep", { status: 200 });

      const result = await engine.download({
        url: "https://example.com/deep.txt",
        destination: nestedDest,
      });

      expect(result.success).toBe(true);
      expect(existsSync(nestedDest)).toBe(true);
    });
  });
});
