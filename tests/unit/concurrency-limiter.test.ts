import { describe, it, expect } from "vitest";
import { ConcurrencyLimiter } from "../../src/registry/concurrency-limiter.js";

describe("ConcurrencyLimiter", () => {
  it("starts with zero running", () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 3 });
    expect(limiter.running).toBe(0);
    expect(limiter.queued).toBe(0);
    expect(limiter.available).toBe(3);
  });

  it("acquires up to maxConcurrent", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
    await limiter.acquire();
    expect(limiter.running).toBe(1);
    expect(limiter.available).toBe(1);
    await limiter.acquire();
    expect(limiter.running).toBe(2);
    expect(limiter.available).toBe(0);
    limiter.clear();
  });

  it("releases permits", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
    await limiter.acquire();
    await limiter.acquire();
    limiter.release();
    expect(limiter.running).toBe(1);
    expect(limiter.available).toBe(1);
    limiter.clear();
  });

  it("queues when at capacity", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 1, queueTimeoutMs: 1000 });
    await limiter.acquire();

    let resolved = false;
    const promise = limiter.acquire().then(() => { resolved = true; });

    expect(resolved).toBe(false);
    expect(limiter.queued).toBe(1);

    limiter.release();
    await promise;
    expect(resolved).toBe(true);
    limiter.clear();
  });

  it("times out queued requests", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 1, queueTimeoutMs: 50 });
    await limiter.acquire();

    await expect(limiter.acquire()).rejects.toThrow("queue timeout");
    limiter.clear();
  });

  it("run() acquires, executes, and releases", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
    expect(limiter.running).toBe(0);
  });

  it("run() releases on error", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
    await expect(limiter.run(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(limiter.running).toBe(0);
  });

  it("runAll() executes multiple tasks", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
    const results = await limiter.runAll([
      async () => 1,
      async () => 2,
      async () => 3,
    ]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("runAll() respects concurrency limit", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
    let maxConcurrent = 0;
    let current = 0;

    const task = async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 10));
      current--;
    };

    await limiter.runAll([task, task, task, task, task]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("clear() cancels queued requests", async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
    await limiter.acquire();

    const promise = limiter.acquire();
    limiter.clear();

    await expect(promise).rejects.toThrow("cleared");
  });
});
