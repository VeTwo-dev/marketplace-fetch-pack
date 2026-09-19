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
import { createEnhancedLockFileService } from "../../src/lockfile/index.js";
import { createLogger } from "../../src/logger/index.js";
import type { InstalledResource, ManagedFile } from "../../src/types/installed-state.js";

const logger = createLogger({ prefix: "test-reconciliation", level: "silent" });

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

describe("ReconciliationEngine", () => {
  let tempDir: string;
  let stateDir: string;
  let installedState: InstalledStateManager;
  let lockFileService: ReturnType<typeof createEnhancedLockFileService>;
  let engine: ReconciliationEngine;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "reconciliation-test-"));
    stateDir = join(tempDir, "state");
    installedState = createInstalledStateManager(stateDir, logger);
    await installedState.initialize();
    lockFileService = createEnhancedLockFileService();
    engine = createReconciliationEngine(
      { installedState, lockFileService },
      logger,
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports healthy resource when files match", async () => {
    const resourceDir = join(tempDir, "test-resource");
    await mkdir(resourceDir, { recursive: true });
    await writeFile(join(resourceDir, "resource.json"), "{}", "utf-8");

    const content = "{}";
    const { sha256 } = await import("../../src/utils/index.js");
    const sha = sha256(content);

    await installedState.addResource(
      makeInstalledResource({
        managedFiles: [makeManagedFile("resource.json", sha)],
      }),
    );

    const result = await engine.reconcile(tempDir);
    expect(result.healthy).toContain("test-resource");
    expect(result.modified).toHaveLength(0);
    expect(result.corrupted).toHaveLength(0);
  });

  it("detects missing files", async () => {
    await installedState.addResource(
      makeInstalledResource({
        managedFiles: [makeManagedFile("missing.txt", "abc123")],
      }),
    );

    const result = await engine.reconcile(tempDir);
    expect(result.missing).toContain("test-resource");
  });

  it("detects modified files", async () => {
    const resourceDir = join(tempDir, "test-resource");
    await mkdir(resourceDir, { recursive: true });
    const originalContent = "original";
    await writeFile(join(resourceDir, "file.txt"), originalContent, "utf-8");

    const { sha256 } = await import("../../src/utils/index.js");
    const originalSha = sha256(originalContent);

    // sha matches the file on disk (so currentSha === managed.sha → modified),
    // but expectedSha is different (so currentSha !== expectedSha)
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

    const result = await engine.reconcile(tempDir);
    expect(result.modified).toContain("test-resource");
  });

  it("detects corrupted files", async () => {
    const resourceDir = join(tempDir, "test-resource");
    await mkdir(resourceDir, { recursive: true });
    await writeFile(join(resourceDir, "file.txt"), "corrupted", "utf-8");

    await installedState.addResource(
      makeInstalledResource({
        managedFiles: [
          {
            ...makeManagedFile("file.txt"),
            sha: "expected-sha",
            expectedSha: "expected-sha",
          },
        ],
      }),
    );

    const result = await engine.reconcile(tempDir);
    expect(result.corrupted).toContain("test-resource");
  });

  it("detects lockfile mismatch", async () => {
    await mkdir(tempDir, { recursive: true });
    await lockFileService.write(tempDir, {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 2,
      resources: [
        {
          id: "test-resource",
          version: "2.0.0",
          resolved: "https://example.com",
          integrity: "different-integrity",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
      ],
    });

    await installedState.addResource(
      makeInstalledResource({ version: "1.0.0", integrity: "original-integrity" }),
    );

    const result = await engine.reconcile(tempDir);
    expect(result.lockfileMismatches).toContain("test-resource");
  });

  it("reconciles single resource", async () => {
    await installedState.addResource(makeInstalledResource());
    const item = await engine.reconcileResource("test-resource", tempDir);
    expect(item).not.toBeNull();
    expect(item!.resourceId).toBe("test-resource");
  });

  it("returns null for non-existent resource", async () => {
    const item = await engine.reconcileResource("nonexistent", tempDir);
    expect(item).toBeNull();
  });

  it("returns empty result when no resources", async () => {
    const result = await engine.reconcile(tempDir);
    expect(result.resources).toHaveLength(0);
    expect(result.healthy).toHaveLength(0);
  });

  it("marks offline capable", async () => {
    const result = await engine.reconcile(tempDir);
    expect(result.offlineCapable).toBe(true);
  });
});
