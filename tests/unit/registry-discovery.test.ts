import { describe, it, expect, beforeEach, vi } from "vitest";
import { RegistryDiscovery } from "../../src/registry/discovery.js";
import type { ResolvedConfig } from "../../src/types/config.js";

function makeConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    repository: "https://github.com/test/repo",
    branch: "main",
    cache: {
      enabled: true,
      directory: "/tmp/cache",
      maxSize: 100 * 1024 * 1024,
      ttl: 24 * 60 * 60 * 1000,
      autoClean: true,
    },
    destination: "/tmp/dest",
    logger: { level: "silent", prefix: "test", color: false },
    plugins: [],
    hooks: {},
    autoDetect: true,
    concurrency: 5,
    timeout: 30000,
    source: "default",
    offline: false,
    ...overrides,
  };
}

const VALID_RESOURCE_MANIFEST = {
  name: "test-resource",
  version: "1.0.0",
  description: "A test resource",
  author: { name: "Test Author" },
  category: "plugins",
  tags: ["test"],
  files: [{ path: "index.js" }],
  dependencies: [],
  keywords: [],
};

function makeProvider(tree: Array<{ path: string; type: string }>, files: Record<string, object>) {
  return {
    type: "github" as const,
    name: "test",
    async connect() {},
    async readFile(path: string) {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return JSON.stringify(content);
    },
    async readJson(path: string) {
      const text = await this.readFile(path);
      return JSON.parse(text);
    },
    async getTree() {
      return tree;
    },
    async getRawUrl(path: string) {
      return `https://example.com/${path}`;
    },
    invalidate() {},
  };
}

describe("RegistryDiscovery", () => {
  describe("discover from registry.json", () => {
    it("loads valid registry.json", async () => {
      const registryData = {
        version: "1.0.0",
        repository: "https://github.com/test/repo",
        categories: [{ id: "plugins", name: "Plugins", description: "", resourceCount: 1 }],
        resources: [
          {
            id: "test",
            name: "test",
            displayName: "test",
            description: "test",
            version: "1.0.0",
            category: "plugins",
            tags: ["test"],
            author: { name: "Test" },
            manifestPath: "test/resource.json",
            manifestHash: "abc",
            dependencies: [],
            keywords: [],
          },
        ],
        metadata: { totalCount: 1, categoriesCount: 1, lastUpdated: new Date().toISOString() },
      };

      const provider = makeProvider([], { "registry.json": registryData });
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.source).toBe("registry.json");
      expect(result.registry.resources).toHaveLength(1);
      expect(result.registry.resources[0]!.id).toBe("test");
      expect(result.warnings).toHaveLength(0);
    });

    it("throws REGISTRY_INVALID for malformed registry.json", async () => {
      const provider = makeProvider([], { "registry.json": { bad: true } });
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      try {
        await discovery.discover();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("REGISTRY_INVALID");
      }
    });
  });

  describe("discover from manifest scan", () => {
    it("scans and builds registry from resource.json", async () => {
      const tree = [
        { path: "plugins/test-resource/resource.json", type: "blob" },
      ];
      const files = {
        "plugins/test-resource/resource.json": VALID_RESOURCE_MANIFEST,
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.source).toBe("manifest-scan");
      expect(result.registry.resources).toHaveLength(1);
      expect(result.registry.resources[0]!.id).toBe("test-resource");
      expect(result.registry.resources[0]!.category).toBe("plugins");
    });

    it("builds dynamic categories from manifests", async () => {
      const tree = [
        { path: "plugins/a/resource.json", type: "blob" },
        { path: "themes/b/resource.json", type: "blob" },
        { path: "plugins/c/resource.json", type: "blob" },
      ];
      const files = {
        "plugins/a/resource.json": { ...VALID_RESOURCE_MANIFEST, name: "a", category: "plugins" },
        "themes/b/resource.json": { ...VALID_RESOURCE_MANIFEST, name: "b", category: "themes" },
        "plugins/c/resource.json": { ...VALID_RESOURCE_MANIFEST, name: "c", category: "plugins" },
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.registry.categories).toHaveLength(2);
      const cats = result.registry.categories.map((c) => c.id).sort();
      expect(cats).toEqual(["plugins", "themes"]);
      const pluginsCat = result.registry.categories.find((c) => c.id === "plugins");
      expect(pluginsCat!.resourceCount).toBe(2);
    });

    it("handles manifest.json file names", async () => {
      const tree = [
        { path: "my-resource/manifest.json", type: "blob" },
      ];
      const files = {
        "my-resource/manifest.json": VALID_RESOURCE_MANIFEST,
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.registry.resources).toHaveLength(1);
    });

    it("handles vetwo.json file names", async () => {
      const tree = [
        { path: "my-resource/vetwo.json", type: "blob" },
      ];
      const files = {
        "my-resource/vetwo.json": VALID_RESOURCE_MANIFEST,
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.registry.resources).toHaveLength(1);
    });

    it("throws REGISTRY_NOT_FOUND when no manifests exist", async () => {
      const provider = makeProvider(
        [{ path: "README.md", type: "blob" }],
        {},
      );
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      try {
        await discovery.discover();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("REGISTRY_NOT_FOUND");
      }
    });
  });

  describe("duplicate resource handling", () => {
    it("warns on duplicate resource IDs and keeps first", async () => {
      const tree = [
        { path: "a/resource.json", type: "blob" },
        { path: "b/resource.json", type: "blob" },
      ];
      const manifest1 = { ...VALID_RESOURCE_MANIFEST, name: "shared-name" };
      const manifest2 = { ...VALID_RESOURCE_MANIFEST, name: "shared-name", description: "duplicate" };
      const files = {
        "a/resource.json": manifest1,
        "b/resource.json": manifest2,
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.registry.resources).toHaveLength(1);
      expect(result.registry.resources[0]!.description).toBe("A test resource");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.type).toBe("duplicate-resource");
    });
  });

  describe("error handling", () => {
    it("warns on invalid manifest but continues with valid ones", async () => {
      const tree = [
        { path: "good/resource.json", type: "blob" },
        { path: "bad/resource.json", type: "blob" },
      ];
      const files = {
        "good/resource.json": VALID_RESOURCE_MANIFEST,
        "bad/resource.json": { name: "", version: "", description: "", category: "", tags: [], files: [] },
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.registry.resources).toHaveLength(1);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.some((w) => w.type === "invalid-manifest" || w.type === "parse-error")).toBe(true);
    });

    it("throws when all manifests are invalid", async () => {
      const tree = [
        { path: "bad1/resource.json", type: "blob" },
        { path: "bad2/resource.json", type: "blob" },
      ];
      const files = {
        "bad1/resource.json": { name: "", version: "", description: "", category: "", tags: [], files: [] },
        "bad2/resource.json": { name: "", version: "", description: "", category: "", tags: [], files: [] },
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      try {
        await discovery.discover();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("REGISTRY_INVALID");
      }
    });

    it("warns on non-object manifest content", async () => {
      const tree = [
        { path: "a/resource.json", type: "blob" },
      ];
      const files = {
        "a/resource.json": "not-an-object" as any,
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      try {
        await discovery.discover();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("REGISTRY_INVALID");
      }
    });
  });

  describe("category building", () => {
    it("groups resources by category dynamically", async () => {
      const tree = [
        { path: "p1/resource.json", type: "blob" },
        { path: "p2/resource.json", type: "blob" },
        { path: "t1/resource.json", type: "blob" },
      ];
      const files = {
        "p1/resource.json": { ...VALID_RESOURCE_MANIFEST, name: "p1", category: "plugins" },
        "p2/resource.json": { ...VALID_RESOURCE_MANIFEST, name: "p2", category: "plugins" },
        "t1/resource.json": { ...VALID_RESOURCE_MANIFEST, name: "t1", category: "templates" },
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.registry.categories).toHaveLength(2);
      const catIds = result.registry.categories.map((c) => c.id);
      expect(catIds).toContain("plugins");
      expect(catIds).toContain("templates");
    });

    it("capitalizes category name", async () => {
      const tree = [
        { path: "a/resource.json", type: "blob" },
      ];
      const files = {
        "a/resource.json": { ...VALID_RESOURCE_MANIFEST, name: "a", category: "myplugins" },
      };

      const provider = makeProvider(tree, files);
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider as any);

      const result = await discovery.discover();
      expect(result.registry.categories[0]!.name).toBe("Myplugins");
    });
  });
});
