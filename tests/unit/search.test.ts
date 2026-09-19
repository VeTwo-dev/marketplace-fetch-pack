import { describe, it, expect, vi } from "vitest";
import { SearchEngine } from "../../src/search/index.js";
import { EventBus } from "../../src/events/index.js";
import { PluginManager } from "../../src/plugins/index.js";
import type { RegistryResource } from "../../src/types/registry.js";

function makeResource(overrides: Partial<RegistryResource> = {}): RegistryResource {
  return {
    id: overrides.id ?? "test-resource",
    name: overrides.name ?? "Test Resource",
    displayName: overrides.displayName ?? "Test Resource Display",
    description: overrides.description ?? "A test resource for unit testing",
    version: overrides.version ?? "1.0.0",
    category: overrides.category ?? "plugin",
    tags: overrides.tags ?? ["test", "utility"],
    author: overrides.author ?? { name: "Test Author" },
    manifestPath: overrides.manifestPath ?? "/manifest.json",
    manifestHash: overrides.manifestHash ?? "abc123",
    dependencies: overrides.dependencies ?? [],
    keywords: overrides.keywords ?? ["test"],
    downloads: overrides.downloads,
    ...("compatibility" in overrides ? { compatibility: overrides.compatibility } : {}),
  };
}

describe("SearchEngine", () => {
  let events: EventBus;
  let plugins: PluginManager;
  let engine: SearchEngine;
  let resources: RegistryResource[];

  beforeEach(() => {
    events = new EventBus();
    plugins = new PluginManager();
    plugins.setContext({ marketplace: {}, config: {}, logger: {}, cache: {}, events: {} });
    engine = new SearchEngine(events, plugins);
    resources = [
      makeResource({ id: "alpha", name: "Alpha Plugin", displayName: "Alpha Display", category: "plugin", tags: ["test", "alpha"], downloads: 1000, keywords: ["alpha"] }),
      makeResource({ id: "beta", name: "Beta Theme", displayName: "Beta Display", category: "theme", tags: ["theme", "color"], downloads: 500, keywords: ["beta", "color"] }),
      makeResource({ id: "gamma", name: "Gamma Module", displayName: "Gamma Display", category: "module", tags: ["module", "util"], downloads: 200, keywords: ["gamma"] }),
      makeResource({ id: "delta", name: "Delta Tool", displayName: "Delta Display", category: "tool", tags: ["tool"], author: { name: "Other Author" }, downloads: 100, keywords: [] }),
    ];
    engine.setResources(resources);
  });

  describe("keyword search", () => {
    it("finds resources by name", async () => {
      const result = await engine.search({ keyword: "alpha" });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items[0]!.resource.id).toBe("alpha");
    });

    it("finds resources by description", async () => {
      const result = await engine.search({ keyword: "testing" });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it("finds resources by tags", async () => {
      const result = await engine.search({ keyword: "color" });
      expect(result.items.some((i) => i.resource.id === "beta")).toBe(true);
    });

    it("finds resources by keywords", async () => {
      const result = await engine.search({ keyword: "gamma" });
      expect(result.items.some((i) => i.resource.id === "gamma")).toBe(true);
    });

    it("returns empty for non-matching keyword", async () => {
      const result = await engine.search({ keyword: "nonexistent" });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("case insensitive search", async () => {
      const result = await engine.search({ keyword: "ALPHA" });
      expect(result.items.some((i) => i.resource.id === "alpha")).toBe(true);
    });
  });

  describe("tag filter", () => {
    it("filters by exact tag", async () => {
      const result = await engine.search({ tags: ["theme"] });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.resource.id).toBe("beta");
    });

    it("filters by multiple tags (AND)", async () => {
      const result = await engine.search({ tags: ["test", "alpha"] });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.resource.id).toBe("alpha");
    });
  });

  describe("category filter", () => {
    it("filters by category", async () => {
      const result = await engine.search({ category: "module" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.resource.id).toBe("gamma");
    });

    it("case insensitive category", async () => {
      const result = await engine.search({ category: "THEME" });
      expect(result.items).toHaveLength(1);
    });
  });

  describe("author filter", () => {
    it("filters by author name", async () => {
      const result = await engine.search({ author: "Test Author" });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.every((i) => i.resource.author === "Test Author")).toBe(true);
    });
  });

  describe("version filter", () => {
    it("filters by exact version", async () => {
      const result = await engine.search({ version: "1.0.0" });
      expect(result.items).toHaveLength(4);
    });
  });

  describe("type filter", () => {
    it("filters by plugin type", async () => {
      const result = await engine.search({ type: "plugin" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.resource.id).toBe("alpha");
    });

    it("filters by theme type", async () => {
      const result = await engine.search({ type: "theme" });
      expect(result.items).toHaveLength(1);
    });

    it("filters by all type", async () => {
      const result = await engine.search({ type: "all" });
      expect(result.items).toHaveLength(4);
    });
  });

  describe("sorting", () => {
    it("sorts by name ascending", async () => {
      const result = await engine.search({ sort: "name", order: "asc" });
      const names = result.items.map((i) => i.resource.name);
      expect([...names].sort()).toEqual(names);
    });

    it("sorts by name descending", async () => {
      const result = await engine.search({ sort: "name", order: "desc" });
      const names = result.items.map((i) => i.resource.name);
      expect([...names].sort().reverse()).toEqual(names);
    });

    it("sorts by downloads descending", async () => {
      const result = await engine.search({ sort: "downloads", order: "desc" });
      const ids = result.items.map((i) => i.resource.id);
      expect(ids[0]).toBe("alpha");
    });

    it("sorts by downloads ascending", async () => {
      const result = await engine.search({ sort: "downloads", order: "asc" });
      const ids = result.items.map((i) => i.resource.id);
      expect(ids[0]).toBe("delta");
    });

    it("default sort is by relevance (desc)", async () => {
      const result = await engine.search({ keyword: "alpha" });
      expect(result.items[0]!.resource.id).toBe("alpha");
    });
  });

  describe("framework filter", () => {
    it("filters by framework compatibility", async () => {
      const reactResource = makeResource({
        id: "react-plugin",
        name: "React Plugin",
        compatibility: { frameworks: ["react", "nextjs"] },
      });
      const vueResource = makeResource({
        id: "vue-plugin",
        name: "Vue Plugin",
        compatibility: { frameworks: ["vue"] },
      });
      const universalResource = makeResource({
        id: "universal",
        name: "Universal",
        compatibility: { frameworks: [] },
      });
      engine.setResources([reactResource, vueResource, universalResource]);

      const result = await engine.search({ framework: "react" });
      expect(result.items.some((i) => i.resource.id === "react-plugin")).toBe(true);
      expect(result.items.some((i) => i.resource.id === "universal")).toBe(true);
      expect(result.items.some((i) => i.resource.id === "vue-plugin")).toBe(false);
    });

    it("returns all resources when no framework specified", async () => {
      const result = await engine.search({});
      expect(result.items).toHaveLength(4);
    });
  });

  describe("pagination", () => {
    it("respects limit", async () => {
      const result = await engine.search({ limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("respects offset", async () => {
      const result = await engine.search({ limit: 2, offset: 2 });
      expect(result.items).toHaveLength(2);
    });
  });

  describe("scoring", () => {
    it("exact name match scores highest", async () => {
      const result = await engine.search({ keyword: "alpha" });
      const alphaItem = result.items.find((i) => i.resource.id === "alpha");
      const otherItems = result.items.filter((i) => i.resource.id !== "alpha");
      if (otherItems.length > 0) {
        expect(alphaItem!.score).toBeGreaterThanOrEqual(otherItems[0]!.score);
      }
    });

    it("score is non-negative", async () => {
      const result = await engine.search({ keyword: "alpha" });
      expect(result.items.every((i) => i.score >= 0)).toBe(true);
    });
  });

  describe("matched fields", () => {
    it("reports matched fields", async () => {
      const result = await engine.search({ keyword: "alpha" });
      const alphaItem = result.items.find((i) => i.resource.id === "alpha");
      expect(alphaItem!.matchedFields.length).toBeGreaterThan(0);
    });

    it("reports category as matched field", async () => {
      const result = await engine.search({ category: "plugin" });
      expect(result.items[0]!.matchedFields).toContain("category");
    });
  });

  describe("result structure", () => {
    it("returns valid SearchResult", async () => {
      const result = await engine.search({ keyword: "alpha" });
      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("query");
      expect(result).toHaveProperty("duration");
      expect(typeof result.duration).toBe("number");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("resource in result has correct shape", async () => {
      const result = await engine.search({ keyword: "alpha" });
      const item = result.items[0]!;
      expect(item.resource).toHaveProperty("id");
      expect(item.resource).toHaveProperty("name");
      expect(item.resource).toHaveProperty("displayName");
      expect(item.resource).toHaveProperty("description");
      expect(item.resource).toHaveProperty("version");
      expect(item.resource).toHaveProperty("category");
      expect(item.resource).toHaveProperty("tags");
      expect(item.resource).toHaveProperty("author");
      expect(item).toHaveProperty("score");
      expect(item).toHaveProperty("matchedFields");
    });
  });
});
