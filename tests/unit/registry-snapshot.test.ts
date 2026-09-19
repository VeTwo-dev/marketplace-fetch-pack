import { describe, it, expect } from "vitest";
import {
  buildRegistrySnapshot,
  snapshotToRegistry,
  createSnapshotId,
  type RegistrySnapshot,
} from "../../src/registry/registry-snapshot.js";
import type { Registry, RegistryResource } from "../../src/types/registry.js";
import type { RevisionInfo } from "../../src/registry/index-schema.js";

function makeResource(id: string, version: string = "1.0.0", category: string = "plugin"): RegistryResource {
  return {
    id,
    name: id,
    displayName: id,
    description: `Resource ${id}`,
    version,
    category,
    tags: [],
    author: { name: "test" },
    manifestPath: `${id}/resource.json`,
    manifestHash: `hash-${id}`,
    dependencies: [],
    keywords: [],
  };
}

function makeRegistry(overrides?: Partial<Registry>): Registry {
  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    repository: "https://github.com/test/repo",
    categories: [
      { id: "plugin", name: "Plugin", description: "Plugins", resourceCount: 1 },
    ],
    resources: [makeResource("test-resource")],
    metadata: {
      totalCount: 1,
      categoriesCount: 1,
      lastUpdated: new Date().toISOString(),
    },
    ...overrides,
  };
}

function makeRevision(overrides?: Partial<RevisionInfo>): RevisionInfo {
  return {
    sha: "abc123def456",
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RegistrySnapshot", () => {
  describe("createSnapshotId", () => {
    it("creates deterministic ID from repository and SHA", () => {
      const id1 = createSnapshotId("https://github.com/test/repo", { sha: "abc123", checkedAt: "" });
      const id2 = createSnapshotId("https://github.com/test/repo", { sha: "abc123", checkedAt: "" });
      expect(id1).toBe(id2);
    });

    it("creates different IDs for different SHAs", () => {
      const id1 = createSnapshotId("https://github.com/test/repo", { sha: "abc", checkedAt: "" });
      const id2 = createSnapshotId("https://github.com/test/repo", { sha: "xyz", checkedAt: "" });
      expect(id1).not.toBe(id2);
    });

    it("creates different IDs for different repositories", () => {
      const id1 = createSnapshotId("https://github.com/test/repo1", { sha: "abc", checkedAt: "" });
      const id2 = createSnapshotId("https://github.com/test/repo2", { sha: "abc", checkedAt: "" });
      expect(id1).not.toBe(id2);
    });

    it("includes prefix", () => {
      const id = createSnapshotId("repo", { sha: "sha", checkedAt: "" });
      expect(id).toMatch(/^snapshot:/);
    });
  });

  describe("buildRegistrySnapshot", () => {
    it("builds snapshot from registry", () => {
      const registry = makeRegistry();
      const revision = makeRevision();
      const snapshot = buildRegistrySnapshot(registry, revision, "registry.json");

      expect(snapshot.id).toMatch(/^snapshot:/);
      expect(snapshot.revision).toBe(revision);
      expect(snapshot.generatedAt).toBe(registry.generatedAt);
      expect(snapshot.repository).toBe(registry.repository);
      expect(snapshot.registryVersion).toBe(registry.version);
      expect(snapshot.resources).toHaveLength(1);
      expect(snapshot.categories).toHaveLength(1);
      expect(snapshot.metadata.source).toBe("registry.json");
    });

    it("counts resource types from categories", () => {
      const registry = makeRegistry({
        resources: [
          makeResource("a", "1.0.0", "plugin"),
          makeResource("b", "1.0.0", "theme"),
          makeResource("c", "1.0.0", "plugin"),
        ],
        categories: [
          { id: "plugin", name: "Plugin", description: "", resourceCount: 2 },
          { id: "theme", name: "Theme", description: "", resourceCount: 1 },
        ],
      });

      const snapshot = buildRegistrySnapshot(registry, makeRevision(), "manifest-scan");
      expect(snapshot.metadata.resourceTypeCount).toBe(2);
      expect(snapshot.metadata.totalCount).toBe(3);
    });

    it("records invalid resource count", () => {
      const snapshot = buildRegistrySnapshot(
        makeRegistry(),
        makeRevision(),
        "manifest-scan",
        3,
        5,
      );
      expect(snapshot.metadata.invalidResourceCount).toBe(3);
      expect(snapshot.metadata.warningsCount).toBe(5);
    });

    it("copies resource fields correctly", () => {
      const resource: RegistryResource = {
        ...makeResource("full", "2.0.0", "theme"),
        displayName: "Full Resource",
        description: "A full resource",
        tags: ["dark", "modern"],
        author: { name: "Author", email: "a@b.com" },
        manifestPath: "full/resource.json",
        manifestHash: "abc123",
        dependencies: [{ id: "dep1", version: "^1.0.0" }],
        compatibility: { node: ">=20", frameworks: ["react"] },
        repository: "https://github.com/test/repo",
        homepage: "https://example.com",
        license: "MIT",
        keywords: ["dark", "theme"],
        defaultDestination: "./my-dir",
      };

      const registry = makeRegistry({ resources: [resource] });
      const snapshot = buildRegistrySnapshot(registry, makeRevision(), "registry.json");

      const sr = snapshot.resources[0]!;
      expect(sr.id).toBe("full");
      expect(sr.version).toBe("2.0.0");
      expect(sr.category).toBe("theme");
      expect(sr.tags).toEqual(["dark", "modern"]);
      expect(sr.displayName).toBe("Full Resource");
      expect(sr.compatibility?.node).toBe(">=20");
      expect(sr.license).toBe("MIT");
      expect(sr.defaultDestination).toBe("./my-dir");
      expect(sr.dependencies).toHaveLength(1);
    });
  });

  describe("snapshotToRegistry", () => {
    it("converts snapshot back to registry", () => {
      const registry = makeRegistry();
      const snapshot = buildRegistrySnapshot(registry, makeRevision(), "registry.json");
      const converted = snapshotToRegistry(snapshot);

      expect(converted.version).toBe(snapshot.registryVersion);
      expect(converted.repository).toBe(snapshot.repository);
      expect(converted.generatedAt).toBe(snapshot.generatedAt);
      expect(converted.resources).toHaveLength(1);
      expect(converted.resources[0]!.id).toBe("test-resource");
      expect(converted.categories).toHaveLength(1);
    });

    it("preserves all resource fields through roundtrip", () => {
      const resource: RegistryResource = {
        ...makeResource("roundtrip", "3.0.0"),
        displayName: "Roundtrip Resource",
        description: "Test roundtrip",
        tags: ["test"],
        author: { name: "Author", email: "a@b.com" },
        manifestPath: "roundtrip/resource.json",
        manifestHash: "hash",
        dependencies: [{ id: "dep", version: "^1.0.0", optional: true }],
        compatibility: { node: ">=20" },
        license: "MIT",
        keywords: ["test"],
      };

      const registry = makeRegistry({ resources: [resource] });
      const snapshot = buildRegistrySnapshot(registry, makeRevision(), "registry.json");
      const converted = snapshotToRegistry(snapshot);

      const r = converted.resources[0]!;
      expect(r.id).toBe("roundtrip");
      expect(r.version).toBe("3.0.0");
      expect(r.displayName).toBe("Roundtrip Resource");
      expect(r.dependencies).toHaveLength(1);
      expect(r.dependencies[0]!.optional).toBe(true);
      expect(r.compatibility?.node).toBe(">=20");
      expect(r.license).toBe("MIT");
    });
  });
});
