import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransactionManager } from "../../src/transaction/index.js";
import { MarketplaceStateManager } from "../../src/state/index.js";
import { FakeClock } from "../../src/abstractions/clock.js";
import { DeterministicIdGenerator } from "../../src/abstractions/id.js";
import { createLogger } from "../../src/logger/index.js";

const logger = createLogger({ prefix: "test", level: "silent" });

describe("TransactionManager", () => {
  let tempDir: string;
  let stateManager: MarketplaceStateManager;
  let txManager: TransactionManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "market-tx-test-"));
    stateManager = new MarketplaceStateManager(tempDir, logger);
    await stateManager.initialize();
    txManager = new TransactionManager(stateManager, logger);
    await txManager.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a transaction with pending status", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    expect(tx.status).toBe("pending");
    expect(tx.resourceId).toBe("pkg-a");
    expect(tx.version).toBe("1.0.0");
    expect(tx.resourceIds).toEqual(["pkg-a"]);
    expect(tx.id).toBeTruthy();
    expect(tx.startedAt).toBeTruthy();
  });

  it("updates transaction status", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.updateTransaction(tx.id, { status: "writing" });
    const updated = await txManager.getTransaction(tx.id);
    expect(updated!.status).toBe("writing");
  });

  it("marks transaction as committed", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.markCommitted(tx.id);
    const updated = await txManager.getTransaction(tx.id);
    expect(updated!.status).toBe("committed");
    expect(updated!.completedAt).toBeTruthy();
  });

  it("marks transaction as failed", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.markFailed(tx.id, "download error");
    const updated = await txManager.getTransaction(tx.id);
    expect(updated!.status).toBe("failed");
    expect(updated!.error).toBe("download error");
  });

  it("marks transaction as rolled back", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.markRolledBack(tx.id);
    const updated = await txManager.getTransaction(tx.id);
    expect(updated!.status).toBe("rolled-back");
  });

  it("lists active transactions", async () => {
    await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.createTransaction("pkg-b", "2.0.0", ["pkg-b"]);
    const list = await txManager.getActiveTransactions();
    expect(list).toHaveLength(2);
  });

  it("returns null for unknown transaction", async () => {
    const tx = await txManager.getTransaction("nonexistent");
    expect(tx).toBeNull();
  });

  it("deletes a transaction", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.deleteTransaction(tx.id);
    const deleted = await txManager.getTransaction(tx.id);
    expect(deleted).toBeNull();
  });

  it("persists transactions to disk", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.updateTransaction(tx.id, { status: "writing" });
    const loaded = await txManager.getTransaction(tx.id);
    expect(loaded!.status).toBe("writing");
    expect(loaded!.resourceId).toBe("pkg-a");
  });

  it("detects stale transactions", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.updateTransaction(tx.id, { status: "preparing" });
    const stale = await txManager.detectStaleTransactions();
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe(tx.id);
  });

  it("does not report committed transactions as stale", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", ["pkg-a"]);
    await txManager.markCommitted(tx.id);
    const stale = await txManager.detectStaleTransactions();
    expect(stale).toHaveLength(0);
  });

  it("generates unique transaction ids", async () => {
    const tx1 = await txManager.createTransaction("a", "1.0.0", ["a"]);
    const tx2 = await txManager.createTransaction("b", "1.0.0", ["b"]);
    expect(tx1.id).not.toBe(tx2.id);
  });

  it("stores resource ids in transaction", async () => {
    const tx = await txManager.createTransaction("pkg-a", "1.0.0", [
      "pkg-a",
      "dep-b",
    ]);
    expect(tx.resourceIds).toEqual(["pkg-a", "dep-b"]);
  });

  it("returns empty list when no transactions exist", async () => {
    const list = await txManager.getActiveTransactions();
    expect(list).toHaveLength(0);
  });

  it("returns empty stale list when no pending transactions", async () => {
    const stale = await txManager.detectStaleTransactions();
    expect(stale).toHaveLength(0);
  });

  it("supports deterministic clock and ids via DI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "market-tx-det-"));
    try {
      const state = new MarketplaceStateManager(dir, logger);
      const clock = new FakeClock(Date.parse("2026-01-01T00:00:00.000Z"));
      const ids = new DeterministicIdGenerator("tx");
      const deterministic = new TransactionManager(state, logger, undefined, {
        clock,
        ids,
      });
      const tx = await deterministic.createTransaction("pkg-a", "1.0.0", [
        "pkg-a",
      ]);
      expect(tx.id).toBe("tx_0000");
      expect(tx.startedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(tx.journal[0]?.at).toBe("2026-01-01T00:00:00.000Z");
      clock.advance(5000);
      await deterministic.updateTransaction(tx.id, { status: "writing" });
      const updated = await deterministic.getTransaction(tx.id);
      expect(updated?.journal.at(-1)?.at).toBe("2026-01-01T00:00:05.000Z");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
