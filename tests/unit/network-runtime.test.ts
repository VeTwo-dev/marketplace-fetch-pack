import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMEOUTS,
  RetryBudget,
  NetworkTelemetry,
  CategoryConcurrencyLimiter,
  StaleWhileRevalidate,
  buildNamespacedCacheKey,
} from "../../src/network/runtime.js";

describe("Timeout model (Step 5)", () => {
  it("defines separate timeout categories", () => {
    expect(DEFAULT_TIMEOUTS.connection).toBeLessThan(DEFAULT_TIMEOUTS.request);
    expect(DEFAULT_TIMEOUTS.request).toBeLessThan(DEFAULT_TIMEOUTS.download);
    expect(DEFAULT_TIMEOUTS.registry).toBeGreaterThan(0);
  });
});

describe("Retry budget (Step 7)", () => {
  it("permits retries up to the cap then fails fast", () => {
    const budget = new RetryBudget({ maxRetries: 3, windowMs: 60_000 });
    expect(budget.tryConsume("api.github.com")).toBe(true);
    expect(budget.tryConsume("api.github.com")).toBe(true);
    expect(budget.tryConsume("api.github.com")).toBe(true);
    expect(budget.remaining("api.github.com")).toBe(0);
    // Budget exhausted → retry storm prevented
    expect(budget.tryConsume("api.github.com")).toBe(false);
    expect(budget.tryConsume("api.github.com")).toBe(false);
  });

  it("budgets are per-endpoint — one failing host doesn't starve others", () => {
    const budget = new RetryBudget({ maxRetries: 2, windowMs: 60_000 });
    budget.tryConsume("host-a");
    budget.tryConsume("host-a");
    expect(budget.tryConsume("host-a")).toBe(false);
    expect(budget.tryConsume("host-b")).toBe(true); // unaffected
  });

  it("refills after the window elapses", async () => {
    const budget = new RetryBudget({ maxRetries: 1, windowMs: 50 });
    expect(budget.tryConsume("k")).toBe(true);
    expect(budget.tryConsume("k")).toBe(false);
    await new Promise((r) => setTimeout(r, 70));
    expect(budget.remaining("k")).toBe(1);
    expect(budget.tryConsume("k")).toBe(true);
  });

  it("reset clears all budgets", () => {
    const budget = new RetryBudget({ maxRetries: 1, windowMs: 60_000 });
    budget.tryConsume("x");
    budget.reset();
    expect(budget.tryConsume("x")).toBe(true);
  });
});

describe("Network telemetry (Step 24)", () => {
  it("tracks bounded counters and hit rate", () => {
    const t = new NetworkTelemetry();
    t.recordRequest();
    t.recordRequest();
    t.recordRequest();
    t.recordCacheHit();
    t.recordCacheHit();
    t.recordCacheMiss();
    t.recordDeduplicated();
    t.recordRetry();
    t.recordTimeout();
    t.recordRateLimited();
    t.recordBytes(1024);
    t.recordBytesReused(512);

    const snap = t.snapshot();
    expect(snap.requests).toBe(3);
    expect(snap.cacheHits).toBe(2);
    expect(snap.cacheMisses).toBe(1);
    expect(t.hitRate).toBeCloseTo(2 / 3);
    expect(snap.bytesDownloaded).toBe(1024);
    expect(snap.bytesReused).toBe(512);
  });

  it("hit rate is zero before any traffic (no NaN)", () => {
    expect(new NetworkTelemetry().hitRate).toBe(0);
  });
});

describe("Category concurrency limiter (Steps 21–22)", () => {
  it("enforces separate pools per category", async () => {
    const limiter = new CategoryConcurrencyLimiter({
      background: 1,
      registry: 2,
    });

    let backgroundRunning = 0;
    let maxBackgroundConcurrent = 0;

    const tasks = Array.from({ length: 4 }, () =>
      limiter.run("background", async () => {
        backgroundRunning++;
        maxBackgroundConcurrent = Math.max(maxBackgroundConcurrent, backgroundRunning);
        await new Promise((r) => setTimeout(r, 10));
        backgroundRunning--;
      }),
    );
    await Promise.all(tasks);

    expect(maxBackgroundConcurrent).toBe(1);
  });

  it("background work cannot starve interactive work", async () => {
    const limiter = new CategoryConcurrencyLimiter({ background: 1, download: 4 });

    // Saturate background
    const bgHold = limiter.run("background", () => new Promise<void>((r) => setTimeout(r, 30)));
    // Download category has its own pool — runs immediately
    const start = Date.now();
    await limiter.run("download", async () => {});
    const interactiveMs = Date.now() - start;

    expect(interactiveMs).toBeLessThan(25); // not blocked behind background
    await bgHold;
  });
});

describe("Stale-while-revalidate (Step 16)", () => {
  it("fresh values return without fetching", async () => {
    const swr = new StaleWhileRevalidate<string>({ freshTtlMs: 10_000, staleTtlMs: 20_000 });
    await swr.get(async () => "v1");

    let fetched = 0;
    const result = await swr.get(async () => {
      fetched++;
      return "v2";
    });
    expect(result.state).toBe("fresh");
    expect(result.value).toBe("v1");
    expect(fetched).toBe(0);
  });

  it("stale values return immediately + refresh exactly once in background", async () => {
    const swr = new StaleWhileRevalidate<string>({ freshTtlMs: 5, staleTtlMs: 60_000 });
    await swr.get(async () => "old");
    await new Promise((r) => setTimeout(r, 10)); // age past fresh window

    let fetches = 0;
    const fetcher = async () => {
      fetches++;
      await new Promise((r) => setTimeout(r, 20));
      return "new";
    };

    const r1 = await swr.get(fetcher); // triggers bg refresh
    const r2 = await swr.get(fetcher); // dedup: shares in-flight refresh

    expect(r1.state).toBe("stale");
    expect(r1.value).toBe("old");
    expect(r2.value).toBe("old");
    expect(fetches).toBe(1); // coalesced!

    // After refresh completes, value is fresh
    await new Promise((r) => setTimeout(r, 30));
    expect(swr.peek()).toBe("new");
  });

  it("expired values fetch synchronously", async () => {
    const swr = new StaleWhileRevalidate<string>({ freshTtlMs: 1, staleTtlMs: 2 });
    await swr.get(async () => "ancient");
    await new Promise((r) => setTimeout(r, 10));

    const result = await swr.get(async () => "updated");
    expect(result.state).toBe("expired");
    expect(result.value).toBe("updated");
  });

  it("invalidate forces synchronous refetch", async () => {
    const swr = new StaleWhileRevalidate<string>({ freshTtlMs: 60_000, staleTtlMs: 120_000 });
    await swr.get(async () => "a");
    swr.invalidate();
    expect(swr.state()).toBe("expired");
    const result = await swr.get(async () => "b");
    expect(result.value).toBe("b");
  });
});

describe("Namespaced cache keys (Phase 20 Step 31)", () => {
  it("different contexts produce different keys — no cross-config collisions", () => {
    const base = { provider: "github", repository: "VeTwo-dev/VeTwo-Market-Place", ref: "main", schemaVersion: "1" };
    const k1 = buildNamespacedCacheKey(base, "registry");
    const k2 = buildNamespacedCacheKey({ ...base, ref: "dev" }, "registry");
    const k3 = buildNamespacedCacheKey({ ...base, provider: "http" }, "registry");
    const k4 = buildNamespacedCacheKey({ ...base, schemaVersion: "2" }, "registry");

    expect(new Set([k1, k2, k3, k4]).size).toBe(4);
  });

  it("same context produces identical keys (deterministic)", () => {
    const ctx = { provider: "p", repository: "r", ref: "v1", resource: "x", version: "1.0.0", schemaVersion: "1" };
    expect(buildNamespacedCacheKey(ctx, "manifest")).toBe(buildNamespacedCacheKey(ctx, "manifest"));
  });
});
