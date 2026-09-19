import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InstalledStateManager,
  createInstalledStateManager,
} from "../../src/installed-state/index.js";
import {
  ReconciliationEngine,
  createReconciliationEngine,
} from "../../src/reconciliation/index.js";
import {
  LifecycleManager,
  createLifecycleManager,
} from "../../src/lifecycle/index.js";
import { createEnhancedLockFileService } from "../../src/lockfile/index.js";
import { createLogger } from "../../src/logger/index.js";
import type { InstalledResource, ManagedFile } from "../../src/types/installed-state.js";

const logger = createLogger({ prefix: "test-lifecycle", level: "silent" });

function makeManagedFile(relativePath: string, sha?: string): ManagedFile {
  return {
    relativePath,
    sha: sha ?? "abc123",
    size: 100,
    installedAt: new Date().toISOString(),
    expectedSha: sha ?? "abc123",
    integrityStatus: "match",
  };
}

function makeInstalledResource(
  overrides: Partial<InstalledResource> = {},
): InstalledResource {
  return {
    id: "test-resource",
    version: "1.0.0",
    state: "installed",
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "registry",
    registryRevision: null,
    resourceRevision: null,
    integrity: "sha256-abc",
    managedFiles: [makeManagedFile("resource.json")],
    dependencies: [],
    transactionId: null,
    metadata: {
      manifestHash: "hash123",
      destination: "/tmp/test",
      totalSize: 100,
      fileCount: 1,
    },
    ...overrides,
  };
}

describe("LifecycleManager", () => {
  let tempDir: string;
  let stateDir: string;
  let installedState: InstalledStateManager;
  let reconciliation: ReconciliationEngine;
  let lockFileService: ReturnType<typeof createEnhancedLockFileService>;
  let lifecycle: LifecycleManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lifecycle-test-"));
    stateDir = join(tempDir, "state");
    installedState = createInstalledStateManager(stateDir, logger);
    await installedState.initialize();
    lockFileService = createEnhancedLockFileService();
    reconciliation = createReconciliationEngine(
      { installedState, lockFileService },
      logger,
    );
    lifecycle = createLifecycleManager(
      { installedState, reconciliation, lockFileService, database: null },
      logger,
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("status", () => {
    it("returns status for installed resource", async () => {
      await installedState.addResource(makeInstalledResource());
      const status = await lifecycle.status("test-resource", tempDir);
      expect(status).not.toBeNull();
      expect(status!.resourceId).toBe("test-resource");
      expect(status!.version).toBe("1.0.0");
      expect(status!.status).toBe("installed");
    });

    it("returns null for non-existent resource", async () => {
      const status = await lifecycle.status("nonexistent", tempDir);
      expect(status).toBeNull();
    });

    it("computes managed file state", async () => {
      await installedState.addResource(
        makeInstalledResource({
          managedFiles: [
            makeManagedFile("a.ts"),
            { ...makeManagedFile("b.ts"), integrityStatus: "modified" },
          ],
        }),
      );
      const status = await lifecycle.status("test-resource", tempDir);
      expect(status!.managedFileState.totalFiles).toBe(2);
      expect(status!.managedFileState.matchCount).toBe(1);
      expect(status!.managedFileState.modifiedCount).toBe(1);
    });

    it("computes integrity state", async () => {
      await installedState.addResource(makeInstalledResource());
      const status = await lifecycle.status("test-resource", tempDir);
      expect(status!.integrityState.verified).toBe(true);
      expect(status!.integrityState.filesChecked).toBe(1);
    });
  });

  describe("updateCheck", () => {
    it("returns check result for installed resource", async () => {
      await installedState.addResource(makeInstalledResource());
      const check = await lifecycle.updateCheck("test-resource", tempDir);
      expect(check.installedVersion).toBe("1.0.0");
      expect(check.updateAvailable).toBe(false);
    });

    it("returns empty result for non-existent resource", async () => {
      const check = await lifecycle.updateCheck("nonexistent", tempDir);
      expect(check.installedVersion).toBe("");
      expect(check.updateAvailable).toBe(false);
    });
  });

  describe("update", () => {
    it("returns success for already up-to-date resource", async () => {
      const resourceDir = join(tempDir, "test-resource");
      await mkdir(resourceDir, { recursive: true });
      await writeFile(join(resourceDir, "resource.json"), "{}", "utf-8");

      const { sha256 } = await import("../../src/utils/index.js");
      const sha = sha256("{}");

      await installedState.addResource(
        makeInstalledResource({
          managedFiles: [makeManagedFile("resource.json", sha)],
        }),
      );

      const result = await lifecycle.update("test-resource", tempDir);
      expect(result.success).toBe(true);
      expect(result.action).toBe("update");
    });

    it("returns error for non-existent resource", async () => {
      const result = await lifecycle.update("nonexistent", tempDir);
      expect(result.success).toBe(false);
    });

    it("skips resource in updating state", async () => {
      await installedState.addResource(
        makeInstalledResource({ state: "updating" }),
      );
      const result = await lifecycle.update("test-resource", tempDir);
      expect(result.success).toBe(false);
    });

    it("supports dry run", async () => {
      await installedState.addResource(makeInstalledResource());
      const result = await lifecycle.update("test-resource", tempDir, {
        dryRun: true,
      });
      expect(result.success).toBe(true);
      expect(result.details).toContain("Dry run");
    });
  });

  describe("repair", () => {
    it("reports healthy resource", async () => {
      const resourceDir = join(tempDir, "test-resource");
      await mkdir(resourceDir, { recursive: true });
      await writeFile(join(resourceDir, "resource.json"), "{}", "utf-8");

      const { sha256 } = await import("../../src/utils/index.js");
      const sha = sha256("{}");

      await installedState.addResource(
        makeInstalledResource({
          managedFiles: [makeManagedFile("resource.json", sha)],
        }),
      );

      const result = await lifecycle.repair(
        { resourceId: "test-resource" },
        tempDir,
      );
      expect(result.success).toBe(true);
      expect(result.details).toContain("healthy");
    });

    it("fails for non-existent resource", async () => {
      const result = await lifecycle.repair(
        { resourceId: "nonexistent" },
        tempDir,
      );
      expect(result.success).toBe(false);
    });

    it("supports dry run", async () => {
      await installedState.addResource(makeInstalledResource());
      const result = await lifecycle.repair(
        { resourceId: "test-resource", dryRun: true },
        tempDir,
      );
      expect(result.success).toBe(true);
      expect(result.details).toContain("Dry run");
    });

    it("fails with fail policy on modified files", async () => {
      const resourceDir = join(tempDir, "test-resource");
      await mkdir(resourceDir, { recursive: true });
      await writeFile(join(resourceDir, "file.txt"), "original", "utf-8");

      const { sha256 } = await import("../../src/utils/index.js");
      const originalSha = sha256("original");

      // sha matches the file on disk (currentSha === managed.sha → modified),
      // expectedSha differs (currentSha !== expectedSha)
      await installedState.addResource(
        makeInstalledResource({
          managedFiles: [
            {
              ...makeManagedFile("file.txt", originalSha),
              expectedSha: "old-sha-expected-to-differ",
            },
          ],
        }),
      );

      const result = await lifecycle.repair(
        { resourceId: "test-resource", modifiedFilePolicy: "fail" },
        tempDir,
      );
      expect(result.success).toBe(false);
      expect(result.details).toContain("modified by user");
    });
  });

  describe("remove", () => {
    it("removes resource successfully", async () => {
      await installedState.addResource(makeInstalledResource());
      const result = await lifecycle.remove(
        { resourceId: "test-resource" },
        tempDir,
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("remove");
      const check = await installedState.getResource("test-resource");
      expect(check).toBeNull();
    });

    it("fails for non-existent resource", async () => {
      const result = await lifecycle.remove(
        { resourceId: "nonexistent" },
        tempDir,
      );
      expect(result.success).toBe(false);
    });

    it("blocks removal when dependents exist", async () => {
      await installedState.addResource(
        makeInstalledResource({
          id: "dep",
          version: "1.0.0",
          managedFiles: [makeManagedFile("dep.json")],
        }),
      );
      await installedState.addResource(
        makeInstalledResource({
          id: "consumer",
          version: "1.0.0",
          dependencies: [{ id: "dep", version: "1.0.0", optional: false }],
          managedFiles: [makeManagedFile("consumer.json")],
        }),
      );

      const result = await lifecycle.remove(
        { resourceId: "dep" },
        tempDir,
      );
      expect(result.success).toBe(false);
      expect(result.details).toContain("still required by");
    });

    it("force removes despite dependents", async () => {
      await installedState.addResource(
        makeInstalledResource({
          id: "dep",
          managedFiles: [makeManagedFile("dep.json")],
        }),
      );
      await installedState.addResource(
        makeInstalledResource({
          id: "consumer",
          dependencies: [{ id: "dep", version: "1.0.0", optional: false }],
          managedFiles: [makeManagedFile("consumer.json")],
        }),
      );

      const result = await lifecycle.remove(
        { resourceId: "dep", force: true },
        tempDir,
      );
      expect(result.success).toBe(true);
    });

    it("supports dry run", async () => {
      await installedState.addResource(makeInstalledResource());
      const result = await lifecycle.remove(
        { resourceId: "test-resource", dryRun: true },
        tempDir,
      );
      expect(result.success).toBe(true);
      expect(result.details).toContain("Dry run");
      const check = await installedState.getResource("test-resource");
      expect(check).not.toBeNull();
    });
  });

  describe("reinstall", () => {
    it("removes and marks for reinstall", async () => {
      await installedState.addResource(makeInstalledResource());
      const result = await lifecycle.reinstall(
        { resourceId: "test-resource" },
        tempDir,
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("reinstall");
    });

    it("fails for non-existent resource", async () => {
      const result = await lifecycle.reinstall(
        { resourceId: "nonexistent" },
        tempDir,
      );
      expect(result.success).toBe(false);
    });
  });

  describe("getRemovePlan", () => {
    it("returns plan with managed files", async () => {
      await installedState.addResource(
        makeInstalledResource({
          managedFiles: [makeManagedFile("a.ts"), makeManagedFile("b.ts")],
        }),
      );
      const plan = await lifecycle.getRemovePlan("test-resource", tempDir);
      expect(plan.managedFiles).toHaveLength(2);
      expect(plan.blocksRemoval).toBe(false);
    });

    it("detects blocking dependents", async () => {
      await installedState.addResource(
        makeInstalledResource({ id: "dep" }),
      );
      await installedState.addResource(
        makeInstalledResource({
          id: "consumer",
          dependencies: [{ id: "dep", version: "1.0.0", optional: false }],
        }),
      );
      const plan = await lifecycle.getRemovePlan("dep", tempDir);
      expect(plan.blocksRemoval).toBe(true);
      expect(plan.dependents).toContain("consumer");
    });
  });

  describe("orphans", () => {
    it("detects orphaned resources", async () => {
      await installedState.addResource(
        makeInstalledResource({ id: "orphan" }),
      );
      await installedState.addResource(
        makeInstalledResource({
          id: "consumer",
          dependencies: [{ id: "other", version: "1.0.0", optional: false }],
        }),
      );
      const orphanList = await lifecycle.orphans(tempDir);
      expect(orphanList).toContain("orphan");
    });

    it("returns empty when no orphans", async () => {
      await installedState.addResource(
        makeInstalledResource({ id: "dep" }),
      );
      await installedState.addResource(
        makeInstalledResource({
          id: "consumer",
          dependencies: [{ id: "dep", version: "1.0.0", optional: false }],
        }),
      );
      const orphanList = await lifecycle.orphans(tempDir);
      expect(orphanList).not.toContain("dep");
    });
  });

  describe("list", () => {
    it("lists all installed resources", async () => {
      await installedState.addResource(makeInstalledResource({ id: "a" }));
      await installedState.addResource(makeInstalledResource({ id: "b" }));
      const list = await lifecycle.list(tempDir);
      expect(list).toHaveLength(2);
    });
  });

  describe("batch operations", () => {
    it("batch removes multiple resources", async () => {
      await installedState.addResource(makeInstalledResource({ id: "a" }));
      await installedState.addResource(makeInstalledResource({ id: "b" }));
      const results = await lifecycle.batchRemove(["a", "b"], tempDir);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("repairAll finds and repairs resources", async () => {
      const results = await lifecycle.repairAll(tempDir);
      expect(results).toHaveLength(0);
    });
  });

  describe("updateAll", () => {
    it("updates all resources", async () => {
      const resourceDir = join(tempDir, "test-resource");
      await mkdir(resourceDir, { recursive: true });
      await writeFile(join(resourceDir, "resource.json"), "{}", "utf-8");

      const { sha256 } = await import("../../src/utils/index.js");
      const sha = sha256("{}");

      await installedState.addResource(
        makeInstalledResource({
          managedFiles: [makeManagedFile("resource.json", sha)],
        }),
      );

      const results = await lifecycle.updateAll(tempDir);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });
  });
});
