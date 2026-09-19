import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabaseService } from "../../src/database/index.js";
import type { DatabaseEntry, DatabaseHistoryEntry } from "../../src/types/database.js";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const TMP = join(process.cwd(), `.vetwo-test-database-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function makeEntry(resourceId: string, version = "1.0.0"): DatabaseEntry {
  return {
    id: `db-${resourceId}`,
    resourceId,
    version,
    installedAt: new Date().toISOString(),
    destination: "/tmp/test",
    manifestHash: "abc123",
    files: [],
    status: "installed",
  };
}

function makeHistory(resourceId: string, action: "install" | "update" | "remove" | "rollback" = "install"): DatabaseHistoryEntry {
  return {
    action,
    resourceId,
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    success: true,
  };
}

beforeEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("database", () => {
  describe("initialize()", () => {
    it("creates database directory and files", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);

      const entries = await db.getAllEntries();
      expect(entries).toEqual([]);
    });

    it("is idempotent", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addEntry(makeEntry("res-1"));
      await db.initialize(TMP);

      const entries = await db.getAllEntries();
      expect(entries).toHaveLength(1);
    });
  });

  describe("addEntry()", () => {
    it("adds an entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addEntry(makeEntry("res-1"));

      const entry = await db.getEntry("res-1");
      expect(entry).not.toBeNull();
      expect(entry!.resourceId).toBe("res-1");
    });

    it("updates existing entry with same resourceId", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addEntry(makeEntry("res-1", "1.0.0"));
      await db.addEntry(makeEntry("res-1", "2.0.0"));

      const entry = await db.getEntry("res-1");
      expect(entry!.version).toBe("2.0.0");

      const all = await db.getAllEntries();
      expect(all).toHaveLength(1);
    });

    it("adds multiple different entries", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addEntry(makeEntry("a"));
      await db.addEntry(makeEntry("b"));
      await db.addEntry(makeEntry("c"));

      const all = await db.getAllEntries();
      expect(all).toHaveLength(3);
    });
  });

  describe("removeEntry()", () => {
    it("removes an entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addEntry(makeEntry("a"));
      await db.addEntry(makeEntry("b"));

      await db.removeEntry("a");
      expect(await db.getEntry("a")).toBeNull();
      expect(await db.getEntry("b")).not.toBeNull();
    });

    it("handles removing non-existent entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.removeEntry("nonexistent");
      const all = await db.getAllEntries();
      expect(all).toHaveLength(0);
    });
  });

  describe("getEntry()", () => {
    it("returns null for non-existent entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      expect(await db.getEntry("missing")).toBeNull();
    });
  });

  describe("getAllEntries()", () => {
    it("returns all entries", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addEntry(makeEntry("x"));
      await db.addEntry(makeEntry("y"));

      const all = await db.getAllEntries();
      expect(all).toHaveLength(2);
    });

    it("returns empty array initially", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      const all = await db.getAllEntries();
      expect(all).toEqual([]);
    });
  });

  describe("hasEntry()", () => {
    it("returns true for existing entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addEntry(makeEntry("res-1"));
      expect(await db.hasEntry("res-1")).toBe(true);
    });

    it("returns false for non-existent entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      expect(await db.hasEntry("missing")).toBe(false);
    });
  });

  describe("updateEntryStatus()", () => {
    it("updates the status of an entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addEntry(makeEntry("res-1"));

      await db.updateEntryStatus("res-1", "pending");
      const entry = await db.getEntry("res-1");
      expect(entry!.status).toBe("pending");
    });

    it("throws for non-existent entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await expect(db.updateEntryStatus("missing", "installed")).rejects.toThrow("Entry not found: missing");
    });
  });

  describe("addHistory()", () => {
    it("adds a history entry", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addHistory(makeHistory("res-1"));

      const history = await db.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]!.resourceId).toBe("res-1");
    });

    it("appends multiple entries", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addHistory(makeHistory("a", "install"));
      await db.addHistory(makeHistory("a", "update"));
      await db.addHistory(makeHistory("b", "install"));

      const history = await db.getHistory();
      expect(history).toHaveLength(3);
    });

    it("respects maxHistoryEntries limit", async () => {
      const db = createDatabaseService(TMP, { directory: ".vetwo", maxHistoryEntries: 3 });
      await db.initialize(TMP);
      for (let i = 0; i < 5; i++) {
        await db.addHistory(makeHistory(`res-${i}`));
      }

      const history = await db.getHistory();
      expect(history).toHaveLength(3);
    });
  });

  describe("getHistory()", () => {
    it("filters by resourceId", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addHistory(makeHistory("a"));
      await db.addHistory(makeHistory("b"));
      await db.addHistory(makeHistory("a"));

      const history = await db.getHistory("a");
      expect(history).toHaveLength(2);
      expect(history.every((h) => h.resourceId === "a")).toBe(true);
    });

    it("respects limit", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      for (let i = 0; i < 5; i++) {
        await db.addHistory(makeHistory("res"));
      }

      const history = await db.getHistory(undefined, 2);
      expect(history).toHaveLength(2);
    });

    it("returns empty when no history", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      expect(await db.getHistory()).toEqual([]);
    });
  });

  describe("clearHistory()", () => {
    it("clears all history", async () => {
      const db = createDatabaseService(TMP);
      await db.initialize(TMP);
      await db.addHistory(makeHistory("a"));
      await db.addHistory(makeHistory("b"));

      await db.clearHistory();
      expect(await db.getHistory()).toEqual([]);
    });
  });
});
