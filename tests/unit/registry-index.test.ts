import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RegistryIndexManager } from "../../src/registry/registry-index.js";
import { REGISTRY_INDEX_SCHEMA_VERSION } from "../../src/registry/index-schema.js";
import type { RegistryIndex, RevisionInfo } from "../../src/registry/index-schema.js";
import type { Registry } from "../../src/types/registry.js";
import { resolveStatePaths } from "../../src/state/index.js";

function makeRegistry(overrides?: Partial<Registry>): Registry {
  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    repository: "https://github.com/test/repo",
    categories: [
      { id: "plugins", name: "Plugins", description: "Plugins", resourceCount: 1 },
    ],
    resources: [
      {
        id: "test-resource",
        name: "test-resource",
        displayName: "test-resource",
        description: "A test resource",
        version: "1.0.0",
        category: "plugins",
        tags: ["test"],
        author: { name: "Test Author" },
        manifestPath: "test/resource.json",
        manifestHash: "abc123",
        dependencies: [],
        keywords: ["test"],
      },
    ],
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

function makeIndex(overrides?: Partial<RegistryIndex>): RegistryIndex {
  return {
    schemaVersion: REGISTRY_INDEX_SCHEMA_VERSION,
    registryVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    repository: "https://github.com/test/repo",
    ref: "1.0.0",
    revision: makeRevision(),
    resources: [
      {
        id: "test-resource",
        name: "test-resource",
        displayName: "test-resource",
        description: "A test resource",
        version: "1.0.0",
        category: "plugins",
        tags: ["test"],
        keywords: ["test"],
        author: { name: "Test Author" },
        manifestPath: "test/resource.json",
        manifestHash: "abc123",
        dependencies: [],
      },
    ],
    categories: [
      { id: "plugins", name: "Plugins", description: "Plugins", resourceCount: 1 },
    ],
    metadata: {
      totalCount: 1,
      categoriesCount: 1,
      lastUpdated: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe("RegistryIndexManager", () => {
  let tmpDir: string;
  let manager: RegistryIndexManager;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `vetwo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const statePaths = resolveStatePaths(tmpDir);
    manager = new RegistryIndexManager(statePaths);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadLocal", () => {
    it("returns null when no index exists", async () => {
      const result = await manager.loadLocal();
      expect(result).toBeNull();
    });

    it("loads a valid index", async () => {
      const index = makeIndex();
      await manager.save(index);

      const loaded = await manager.loadLocal();
      expect(loaded).not.toBeNull();
      expect(loaded!.schemaVersion).toBe(REGISTRY_INDEX_SCHEMA_VERSION);
      expect(loaded!.resources).toHaveLength(1);
      expect(loaded!.resources[0]!.id).toBe("test-resource");
    });

    it("returns null for invalid schema version", async () => {
      const index = makeIndex({ schemaVersion: 999 });
      const dir = join(tmpDir, ".vetwo", "marketplace", "indexes");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "registry-index.json"), JSON.stringify(index));

      const result = await manager.loadLocal();
      expect(result).toBeNull();
    });

    it("returns null for malformed JSON", async () => {
      const dir = join(tmpDir, ".vetwo", "marketplace", "indexes");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "registry-index.json"), "not json");

      const result = await manager.loadLocal();
      expect(result).toBeNull();
    });

    it("returns null for invalid structure", async () => {
      const dir = join(tmpDir, ".vetwo", "marketplace", "indexes");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "registry-index.json"), JSON.stringify({ bad: true }));

      const result = await manager.loadLocal();
      expect(result).toBeNull();
    });

    it("caches the loaded index in memory", async () => {
      const index = makeIndex();
      await manager.save(index);

      const first = await manager.loadLocal();
      const second = await manager.loadLocal();
      expect(first).toBe(second);
    });
  });

  describe("save", () => {
    it("saves index atomically", async () => {
      const index = makeIndex();
      await manager.save(index);

      const loaded = await manager.loadLocal();
      expect(loaded).not.toBeNull();
      expect(loaded!.resources).toHaveLength(1);
    });

    it("overwrites existing index", async () => {
      const index1 = makeIndex();
      await manager.save(index1);

      const index2 = makeIndex({
        resources: [
          {
            id: "new-resource",
            name: "new-resource",
            displayName: "new-resource",
            description: "New",
            version: "2.0.0",
            category: "plugins",
            tags: [],
            keywords: [],
            author: { name: "Author" },
            manifestPath: "new/resource.json",
            manifestHash: "def",
            dependencies: [],
          },
        ],
      });
      await manager.save(index2);

      const loaded = await manager.loadLocal();
      expect(loaded!.resources).toHaveLength(1);
      expect(loaded!.resources[0]!.id).toBe("new-resource");
    });
  });

  describe("invalidate", () => {
    it("removes the index file", async () => {
      const index = makeIndex();
      await manager.save(index);
      expect(await manager.loadLocal()).not.toBeNull();

      await manager.invalidate();
      expect(await manager.loadLocal()).toBeNull();
    });

    it("does not throw when no index exists", async () => {
      await expect(manager.invalidate()).resolves.not.toThrow();
    });
  });

  describe("buildFromRegistry", () => {
    it("builds a valid index from registry", () => {
      const registry = makeRegistry();
      const revision = makeRevision();
      const index = manager.buildFromRegistry(registry, revision);

      expect(index.schemaVersion).toBe(REGISTRY_INDEX_SCHEMA_VERSION);
      expect(index.resources).toHaveLength(1);
      expect(index.categories).toHaveLength(1);
      expect(index.revision.sha).toBe("abc123def456");
    });

    it("handles multiple resources and categories", () => {
      const registry = makeRegistry({
        resources: [
          {
            id: "a", name: "a", displayName: "a", description: "a",
            version: "1.0.0", category: "plugins", tags: [],
            author: { name: "A" }, manifestPath: "a.json",
            manifestHash: "a", dependencies: [], keywords: [],
          },
          {
            id: "b", name: "b", displayName: "b", description: "b",
            version: "1.0.0", category: "themes", tags: [],
            author: { name: "B" }, manifestPath: "b.json",
            manifestHash: "b", dependencies: [], keywords: [],
          },
        ],
        categories: [
          { id: "plugins", name: "Plugins", description: "", resourceCount: 1 },
          { id: "themes", name: "Themes", description: "", resourceCount: 1 },
        ],
      });

      const index = manager.buildFromRegistry(registry, makeRevision());
      expect(index.resources).toHaveLength(2);
      expect(index.categories).toHaveLength(2);
    });
  });

  describe("isIndexFresh", () => {
    it("returns true when SHA matches", () => {
      const index = makeIndex({ revision: { sha: "abc123", checkedAt: "" } });
      const remote = { sha: "abc123", checkedAt: "" };
      expect(manager.isIndexFresh(index, remote)).toBe(true);
    });

    it("returns false when SHA differs", () => {
      const index = makeIndex({ revision: { sha: "abc123", checkedAt: "" } });
      const remote = { sha: "xyz789", checkedAt: "" };
      expect(manager.isIndexFresh(index, remote)).toBe(false);
    });

    it("returns true when ETag matches", () => {
      const index = makeIndex({ revision: { etag: "\"abc\"", checkedAt: "" } });
      const remote = { etag: "\"abc\"", checkedAt: "" };
      expect(manager.isIndexFresh(index, remote)).toBe(true);
    });

    it("returns false when ETag differs", () => {
      const index = makeIndex({ revision: { etag: "\"abc\"", checkedAt: "" } });
      const remote = { etag: "\"xyz\"", checkedAt: "" };
      expect(manager.isIndexFresh(index, remote)).toBe(false);
    });

    it("returns true when Last-Modified matches", () => {
      const index = makeIndex({ revision: { lastModified: "Mon, 01 Jan 2024 00:00:00 GMT", checkedAt: "" } });
      const remote = { lastModified: "Mon, 01 Jan 2024 00:00:00 GMT", checkedAt: "" };
      expect(manager.isIndexFresh(index, remote)).toBe(true);
    });

    it("returns false when no revision info available", () => {
      const index = makeIndex({ revision: { checkedAt: "" } });
      const remote = { checkedAt: "" };
      expect(manager.isIndexFresh(index, remote)).toBe(false);
    });
  });

  describe("indexToRegistry", () => {
    it("converts index back to registry", () => {
      const index = makeIndex();
      const registry = manager.indexToRegistry(index);

      expect(registry.version).toBe("1.0.0");
      expect(registry.resources).toHaveLength(1);
      expect(registry.resources[0]!.id).toBe("test-resource");
      expect(registry.categories).toHaveLength(1);
    });

    it("preserves all resource fields", () => {
      const index = makeIndex({
        resources: [{
          id: "full",
          name: "full",
          displayName: "Full Resource",
          description: "Full description",
          version: "2.0.0",
          category: "themes",
          tags: ["theme", "dark"],
          keywords: ["dark", "theme"],
          author: { name: "Author", email: "a@b.com" },
          manifestPath: "full/manifest.json",
          manifestHash: "hash123",
          dependencies: [{ id: "dep1", version: "^1.0.0", optional: false }],
          compatibility: { node: ">=20", frameworks: ["react"] },
          repository: "https://github.com/test/repo",
          homepage: "https://example.com",
          license: "MIT",
          defaultDestination: "./my-dir",
        }],
      });

      const registry = manager.indexToRegistry(index);
      const r = registry.resources[0]!;
      expect(r.displayName).toBe("Full Resource");
      expect(r.version).toBe("2.0.0");
      expect(r.category).toBe("themes");
      expect(r.compatibility?.node).toBe(">=20");
      expect(r.license).toBe("MIT");
    });
  });

  describe("dynamic categories", () => {
    it("categories are derived from resources, not hardcoded", () => {
      const registry = makeRegistry({
        resources: [
          {
            id: "a", name: "a", displayName: "a", description: "a",
            version: "1.0.0", category: "components", tags: [],
            author: { name: "A" }, manifestPath: "a.json",
            manifestHash: "a", dependencies: [], keywords: [],
          },
        ],
        categories: [
          { id: "components", name: "Components", description: "", resourceCount: 1 },
        ],
      });

      const index = manager.buildFromRegistry(registry, makeRevision());
      expect(index.categories[0]!.id).toBe("components");
    });
  });
});
