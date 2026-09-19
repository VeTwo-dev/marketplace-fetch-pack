import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLockFileService } from "../../src/lockfile/index.js";
import type { LockFile, LockEntry } from "../../src/types/lockfile.js";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const TMP = join(process.cwd(), `.vetwo-test-lockfile-${Date.now()}-${Math.random().toString(36).slice(2)}`);

beforeEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

function makeEntry(id: string, version = "1.0.0"): LockEntry {
  return {
    id,
    version,
    resolved: `https://example.com/${id}-${version}.tgz`,
    integrity: `sha256-${id}`,
    dependencies: [],
    installedAt: new Date().toISOString(),
    source: "npm",
  };
}

describe("lockfile", () => {
  describe("read/write round-trip", () => {
    it("writes and reads back a lockfile", async () => {
      const service = createLockFileService();
      const lockfile: LockFile = {
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        lockfileVersion: 1,
        resources: [makeEntry("res-1"), makeEntry("res-2")],
      };

      await service.write(TMP, lockfile);
      const read = await service.read(TMP);

      expect(read).not.toBeNull();
      expect(read!.version).toBe("1.0.0");
      expect(read!.resources).toHaveLength(2);
      expect(read!.resources[0]!.id).toBe("res-1");
      expect(read!.resources[1]!.id).toBe("res-2");
    });

    it("returns null when no lockfile exists", async () => {
      const service = createLockFileService();
      const result = await service.read(TMP);
      expect(result).toBeNull();
    });

    it("returns null for corrupted lockfile", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(TMP, "vetwo.lock.json"), "not valid json", "utf-8");
      const service = createLockFileService();
      const result = await service.read(TMP);
      expect(result).toBeNull();
    });
  });

  describe("addEntry()", () => {
    it("adds a new entry to empty lockfile", async () => {
      const service = createLockFileService();
      await service.addEntry(TMP, makeEntry("res-1"));

      const entry = await service.getEntry(TMP, "res-1");
      expect(entry).not.toBeNull();
      expect(entry!.id).toBe("res-1");
    });

    it("adds multiple entries", async () => {
      const service = createLockFileService();
      await service.addEntry(TMP, makeEntry("a"));
      await service.addEntry(TMP, makeEntry("b"));

      const lockfile = await service.read(TMP);
      expect(lockfile!.resources).toHaveLength(2);
    });

    it("updates existing entry with same id", async () => {
      const service = createLockFileService();
      await service.addEntry(TMP, makeEntry("res-1", "1.0.0"));
      await service.addEntry(TMP, makeEntry("res-1", "2.0.0"));

      const entry = await service.getEntry(TMP, "res-1");
      expect(entry!.version).toBe("2.0.0");

      const lockfile = await service.read(TMP);
      expect(lockfile!.resources).toHaveLength(1);
    });
  });

  describe("removeEntry()", () => {
    it("removes an existing entry", async () => {
      const service = createLockFileService();
      await service.addEntry(TMP, makeEntry("a"));
      await service.addEntry(TMP, makeEntry("b"));
      await service.removeEntry(TMP, "a");

      expect(await service.hasEntry(TMP, "a")).toBe(false);
      expect(await service.hasEntry(TMP, "b")).toBe(true);
    });

    it("handles removing from non-existent lockfile", async () => {
      const service = createLockFileService();
      // Should not throw
      await service.removeEntry(TMP, "nonexistent");
    });

    it("handles removing non-existent entry", async () => {
      const service = createLockFileService();
      await service.addEntry(TMP, makeEntry("a"));
      await service.removeEntry(TMP, "nonexistent");

      const lockfile = await service.read(TMP);
      expect(lockfile!.resources).toHaveLength(1);
    });
  });

  describe("hasEntry()", () => {
    it("returns true for existing entry", async () => {
      const service = createLockFileService();
      await service.addEntry(TMP, makeEntry("res-1"));
      expect(await service.hasEntry(TMP, "res-1")).toBe(true);
    });

    it("returns false for non-existent entry", async () => {
      const service = createLockFileService();
      expect(await service.hasEntry(TMP, "missing")).toBe(false);
    });

    it("returns false when no lockfile exists", async () => {
      const service = createLockFileService();
      expect(await service.hasEntry(TMP, "any")).toBe(false);
    });
  });

  describe("getEntry()", () => {
    it("returns the entry", async () => {
      const service = createLockFileService();
      await service.addEntry(TMP, makeEntry("res-1", "3.0.0"));
      const entry = await service.getEntry(TMP, "res-1");
      expect(entry).not.toBeNull();
      expect(entry!.version).toBe("3.0.0");
    });

    it("returns null for missing entry", async () => {
      const service = createLockFileService();
      expect(await service.getEntry(TMP, "missing")).toBeNull();
    });
  });

  describe("clear()", () => {
    it("removes the lockfile", async () => {
      const service = createLockFileService();
      await service.addEntry(TMP, makeEntry("a"));
      await service.addEntry(TMP, makeEntry("b"));
      await service.clear(TMP);

      const lockfile = await service.read(TMP);
      expect(lockfile).toBeNull();
    });

    it("does not throw when no lockfile exists", async () => {
      const service = createLockFileService();
      await service.clear(TMP);
      expect(await service.read(TMP)).toBeNull();
    });
  });
});
