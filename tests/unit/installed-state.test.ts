import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InstalledStateManager,
  createInstalledStateManager,
} from "../../src/installed-state/index.js";
import { createLogger } from "../../src/logger/index.js";
import type { InstalledResource, ManagedFile } from "../../src/types/installed-state.js";

const logger = createLogger({ prefix: "test-installed-state", level: "silent" });

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

describe("InstalledStateManager", () => {
  let tempDir: string;
  let stateDir: string;
  let manager: InstalledStateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "installed-state-test-"));
    stateDir = join(tempDir, "state");
    manager = createInstalledStateManager(stateDir, logger);
    await manager.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("initializes with empty state file", async () => {
    const state = await manager.getState();
    expect(state.schemaVersion).toBe(1);
    expect(state.resources).toEqual([]);
  });

  it("adds a resource", async () => {
    const resource = makeInstalledResource();
    await manager.addResource(resource);
    const result = await manager.getResource("test-resource");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("test-resource");
    expect(result!.version).toBe("1.0.0");
  });

  it("updates existing resource on add", async () => {
    const resource = makeInstalledResource();
    await manager.addResource(resource);
    const updated = makeInstalledResource({ version: "2.0.0" });
    await manager.addResource(updated);
    const result = await manager.getResource("test-resource");
    expect(result!.version).toBe("2.0.0");
  });

  it("removes a resource", async () => {
    const resource = makeInstalledResource();
    await manager.addResource(resource);
    const removed = await manager.removeResource("test-resource");
    expect(removed).toBe(true);
    const result = await manager.getResource("test-resource");
    expect(result).toBeNull();
  });

  it("returns false when removing non-existent resource", async () => {
    const removed = await manager.removeResource("nonexistent");
    expect(removed).toBe(false);
  });

  it("gets all resources", async () => {
    await manager.addResource(makeInstalledResource({ id: "a" }));
    await manager.addResource(makeInstalledResource({ id: "b" }));
    const all = await manager.getAllResources();
    expect(all).toHaveLength(2);
  });

  it("updates resource state", async () => {
    await manager.addResource(makeInstalledResource());
    await manager.updateResourceState("test-resource", "updating");
    const result = await manager.getResource("test-resource");
    expect(result!.state).toBe("updating");
  });

  it("updates managed files", async () => {
    await manager.addResource(makeInstalledResource());
    const files = [makeManagedFile("a.ts"), makeManagedFile("b.ts")];
    await manager.updateManagedFiles("test-resource", files);
    const result = await manager.getResource("test-resource");
    expect(result!.managedFiles).toHaveLength(2);
    expect(result!.metadata.fileCount).toBe(2);
  });

  it("returns null for non-existent resource", async () => {
    const result = await manager.getResource("nonexistent");
    expect(result).toBeNull();
  });

  it("rebuilds from lockfile entries", async () => {
    const entries = [
      {
        id: "pkg-a",
        version: "1.0.0",
        integrity: "sha-abc",
        dependencies: [{ id: "dep-b", version: "1.0.0" }],
        installedAt: new Date().toISOString(),
        source: "registry",
      },
    ];
    const rebuilt = await manager.rebuildFromLockfile(entries, tempDir);
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].id).toBe("pkg-a");
  });

  it("preserves existing resources during rebuild", async () => {
    await manager.addResource(
      makeInstalledResource({ id: "existing", version: "1.0.0" }),
    );
    const entries = [
      {
        id: "existing",
        version: "2.0.0",
        integrity: "sha-new",
        dependencies: [],
        installedAt: new Date().toISOString(),
        source: "registry",
      },
    ];
    const rebuilt = await manager.rebuildFromLockfile(entries, tempDir);
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].version).toBe("1.0.0");
  });
});
