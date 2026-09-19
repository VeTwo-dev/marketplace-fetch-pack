import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSnapshotManager } from "../../src/snapshot/index.js";
import type { SnapshotConfig } from "../../src/types/snapshot.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const TMP = join(process.cwd(), `.vetwo-test-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const config: SnapshotConfig = {
  enabled: true,
  maxSnapshots: 10,
  retentionDays: 30,
  directory: ".vetwo-snapshots",
};

let destDir: string;
let baseDir: string;

beforeEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  baseDir = join(TMP, "base");
  destDir = join(TMP, "dest");
  await mkdir(baseDir, { recursive: true });
  await mkdir(destDir, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("snapshot", () => {
  describe("create()", () => {
    it("creates a snapshot from destination files", async () => {
      await writeFile(join(destDir, "file1.txt"), "content1", "utf-8");
      await writeFile(join(destDir, "file2.txt"), "content2", "utf-8");

      const manager = createSnapshotManager(baseDir, config);
      const snapshot = await manager.create("res-1", "1.0.0", destDir);

      expect(snapshot.id).toBeDefined();
      expect(snapshot.resourceId).toBe("res-1");
      expect(snapshot.version).toBe("1.0.0");
      expect(snapshot.files).toHaveLength(2);
      expect(snapshot.metadata.totalFiles).toBe(2);
      expect(snapshot.metadata.totalSize).toBeGreaterThan(0);
    });

    it("captures file content and SHA", async () => {
      await writeFile(join(destDir, "a.txt"), "hello", "utf-8");
      const manager = createSnapshotManager(baseDir, config);
      const snapshot = await manager.create("res-2", "1.0.0", destDir);

      expect(snapshot.files[0]!.content).toBe("hello");
      expect(snapshot.files[0]!.sha).toBeDefined();
      expect(snapshot.files[0]!.sha.length).toBe(64);
    });

    it("creates snapshot of empty directory", async () => {
      const manager = createSnapshotManager(baseDir, config);
      const snapshot = await manager.create("res-3", "1.0.0", destDir);
      expect(snapshot.files).toHaveLength(0);
      expect(snapshot.metadata.totalFiles).toBe(0);
    });

    it("handles nested directories", async () => {
      const subDir = join(destDir, "sub");
      await mkdir(subDir, { recursive: true });
      await writeFile(join(subDir, "nested.txt"), "nested", "utf-8");

      const manager = createSnapshotManager(baseDir, config);
      const snapshot = await manager.create("res-4", "1.0.0", destDir);
      expect(snapshot.files).toHaveLength(1);
      expect(snapshot.files[0]!.path).toContain("nested.txt");
    });
  });

  describe("get()", () => {
    it("retrieves a snapshot by id", async () => {
      await writeFile(join(destDir, "f.txt"), "data", "utf-8");
      const manager = createSnapshotManager(baseDir, config);
      const created = await manager.create("res-1", "1.0.0", destDir);

      const retrieved = await manager.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.resourceId).toBe("res-1");
    });

    it("returns null for non-existent snapshot", async () => {
      const manager = createSnapshotManager(baseDir, config);
      const result = await manager.get("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  describe("list()", () => {
    it("lists all snapshots", async () => {
      await writeFile(join(destDir, "f.txt"), "data", "utf-8");
      const manager = createSnapshotManager(baseDir, config);
      await manager.create("res-1", "1.0.0", destDir);
      await manager.create("res-1", "2.0.0", destDir);

      const list = await manager.list();
      expect(list).toHaveLength(2);
    });

    it("filters by resourceId", async () => {
      await writeFile(join(destDir, "f.txt"), "data", "utf-8");
      const manager = createSnapshotManager(baseDir, config);
      await manager.create("res-1", "1.0.0", destDir);
      await manager.create("res-2", "1.0.0", destDir);

      const list = await manager.list("res-1");
      expect(list).toHaveLength(1);
      expect(list[0]!.resourceId).toBe("res-1");
    });

    it("returns empty array when no snapshots", async () => {
      const manager = createSnapshotManager(baseDir, config);
      const list = await manager.list();
      expect(list).toEqual([]);
    });
  });

  describe("delete()", () => {
    it("deletes an existing snapshot", async () => {
      await writeFile(join(destDir, "f.txt"), "data", "utf-8");
      const manager = createSnapshotManager(baseDir, config);
      const snapshot = await manager.create("res-1", "1.0.0", destDir);

      const deleted = await manager.delete(snapshot.id);
      expect(deleted).toBe(true);

      const retrieved = await manager.get(snapshot.id);
      expect(retrieved).toBeNull();
    });

    it("returns false for non-existent snapshot", async () => {
      const manager = createSnapshotManager(baseDir, config);
      const deleted = await manager.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("clean()", () => {
    it("removes old snapshots", async () => {
      await writeFile(join(destDir, "f.txt"), "data", "utf-8");
      const manager = createSnapshotManager(baseDir, config);
      const snapshot = await manager.create("res-1", "1.0.0", destDir);

      // Delete the snapshot manually to simulate age, then recreate with old timestamp
      await manager.delete(snapshot.id);

      // Create a new snapshot
      const newSnapshot = await manager.create("res-1", "2.0.0", destDir);

      // All snapshots are fresh, so clean(0) should remove them all
      const removed = await manager.clean(0);
      expect(removed).toBe(1);

      const list = await manager.list();
      expect(list).toHaveLength(0);
    });
  });

  describe("restore()", () => {
    it("restores snapshot files to destination", async () => {
      await writeFile(join(destDir, "original.txt"), "original", "utf-8");
      const manager = createSnapshotManager(baseDir, config);
      const snapshot = await manager.create("res-1", "1.0.0", destDir);

      // Modify the file
      await writeFile(join(destDir, "original.txt"), "modified", "utf-8");
      // Create extra file AFTER snapshot
      const extraFile = join(destDir, "extra.txt");
      await writeFile(extraFile, "extra", "utf-8");

      const result = await manager.restore(snapshot.id);
      expect(result.success).toBe(true);
      expect(result.filesRestored).toBe(1);

      // Verify restore overwrites modified content
      const content = await import("node:fs/promises").then((fs) =>
        fs.readFile(join(destDir, "original.txt"), "utf-8")
      );
      expect(content).toBe("original");
    });

    it("returns error for non-existent snapshot", async () => {
      const manager = createSnapshotManager(baseDir, config);
      const result = await manager.restore("nonexistent");
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
