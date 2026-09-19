import { describe, it, expect } from "vitest";
import {
  ResourceIndexBuilder,
  lookupByVersionIndex,
  getVersionsForRange,
  type ResourceIndex,
} from "../../src/registry/resource-index.js";
import type { RegistryResource } from "../../src/types/registry.js";

function makeResource(id: string, version: string, category: string = "plugin", tags: string[] = [], author: string = "test"): RegistryResource {
  return {
    id,
    name: id,
    displayName: id,
    description: `Resource ${id}`,
    version,
    category,
    tags,
    author: { name: author },
    manifestPath: `${id}/resource.json`,
    manifestHash: `hash-${id}-${version}`,
    dependencies: [],
    keywords: [],
  };
}

describe("ResourceIndexBuilder", () => {
  const builder = new ResourceIndexBuilder();

  describe("build()", () => {
    it("builds index from empty array", () => {
      const index = builder.build([]);
      expect(index.totalCount).toBe(0);
      expect(index.byId.size).toBe(0);
      expect(index.byName.size).toBe(0);
    });

    it("indexes resources by ID", () => {
      const index = builder.build([makeResource("a", "1.0.0"), makeResource("b", "1.0.0")]);
      expect(index.byId.get("a")).toBeDefined();
      expect(index.byId.get("b")).toBeDefined();
      expect(index.byId.size).toBe(2);
    });

    it("indexes resources by name", () => {
      const index = builder.build([makeResource("a", "1.0.0")]);
      expect(index.byName.get("a")).toBeDefined();
    });

    it("indexes resources by alias (displayName)", () => {
      const r = makeResource("a", "1.0.0");
      const rWithAlias = { ...r, displayName: "Resource A" };
      const index = builder.build([rWithAlias]);
      expect(index.byAlias.get("Resource A")).toBe("a");
    });

    it("indexes resources by category", () => {
      const index = builder.build([
        makeResource("a", "1.0.0", "plugin"),
        makeResource("b", "1.0.0", "theme"),
        makeResource("c", "1.0.0", "plugin"),
      ]);
      expect(index.byCategory.get("plugin")).toHaveLength(2);
      expect(index.byCategory.get("theme")).toHaveLength(1);
    });

    it("indexes resources by tag", () => {
      const index = builder.build([
        makeResource("a", "1.0.0", "plugin", ["dark", "modern"]),
        makeResource("b", "1.0.0", "plugin", ["light"]),
        makeResource("c", "1.0.0", "plugin", ["dark"]),
      ]);
      expect(index.byTag.get("dark")).toHaveLength(2);
      expect(index.byTag.get("light")).toHaveLength(1);
      expect(index.byTag.get("modern")).toHaveLength(1);
    });

    it("indexes resources by author", () => {
      const index = builder.build([
        makeResource("a", "1.0.0", "plugin", [], "alice"),
        makeResource("b", "1.0.0", "plugin", [], "bob"),
        makeResource("c", "1.0.0", "plugin", [], "alice"),
      ]);
      expect(index.byAuthor.get("alice")).toHaveLength(2);
      expect(index.byAuthor.get("bob")).toHaveLength(1);
    });

    it("indexes resources by framework", () => {
      const r1: RegistryResource = {
        ...makeResource("a", "1.0.0"),
        compatibility: { frameworks: ["react", "vue"] },
      };
      const r2: RegistryResource = {
        ...makeResource("b", "1.0.0"),
        compatibility: { frameworks: ["react"] },
      };
      const index = builder.build([r1, r2]);
      expect(index.byFramework.get("react")).toHaveLength(2);
      expect(index.byFramework.get("vue")).toHaveLength(1);
    });

    it("builds version index", () => {
      const index = builder.build([
        makeResource("a", "1.0.0"),
        makeResource("a", "2.0.0"),
        makeResource("a", "1.5.0"),
      ]);
      const vi = index.versionIndex.get("a");
      expect(vi).toBeDefined();
      expect(vi!.versions).toHaveLength(3);
      expect(vi!.latest).toBe("2.0.0");
      expect(vi!.sorted).toBe(true);
    });

    it("sorts resources deterministically by ID then version", () => {
      const index = builder.build([
        makeResource("b", "2.0.0"),
        makeResource("a", "1.0.0"),
        makeResource("b", "1.0.0"),
      ]);
      expect(index.allResources[0]!.id).toBe("a");
      expect(index.allResources[1]!.id).toBe("b");
      expect(index.allResources[1]!.version).toBe("1.0.0");
      expect(index.allResources[2]!.version).toBe("2.0.0");
    });

    it("returns frozen index", () => {
      const index = builder.build([makeResource("a", "1.0.0")]);
      expect(Object.isFrozen(index)).toBe(true);
    });
  });

  describe("updateIncremental()", () => {
    it("adds new resources", () => {
      const initial = builder.build([makeResource("a", "1.0.0")]);
      const updated = builder.updateIncremental(initial, [makeResource("b", "1.0.0")], [], []);
      expect(updated.totalCount).toBe(2);
      expect(updated.byId.has("b")).toBe(true);
    });

    it("removes resources", () => {
      const initial = builder.build([makeResource("a", "1.0.0"), makeResource("b", "1.0.0")]);
      const updated = builder.updateIncremental(initial, [], ["a"], []);
      expect(updated.totalCount).toBe(1);
      expect(updated.byId.has("a")).toBe(false);
      expect(updated.byId.has("b")).toBe(true);
    });

    it("updates resources", () => {
      const initial = builder.build([makeResource("a", "1.0.0")]);
      const updated = builder.updateIncremental(initial, [], [], [makeResource("a", "2.0.0")]);
      expect(updated.totalCount).toBe(1);
      expect(updated.byId.get("a")!.version).toBe("2.0.0");
    });

    it("handles combined add, remove, update", () => {
      const initial = builder.build([
        makeResource("a", "1.0.0"),
        makeResource("b", "1.0.0"),
        makeResource("c", "1.0.0"),
      ]);
      const updated = builder.updateIncremental(
        initial,
        [makeResource("d", "1.0.0")],
        ["b"],
        [makeResource("a", "2.0.0")],
      );
      expect(updated.totalCount).toBe(3);
      expect(updated.byId.has("a")).toBe(true);
      expect(updated.byId.get("a")!.version).toBe("2.0.0");
      expect(updated.byId.has("b")).toBe(false);
      expect(updated.byId.has("c")).toBe(true);
      expect(updated.byId.has("d")).toBe(true);
    });
  });
});

describe("lookupByVersionIndex", () => {
  const builder = new ResourceIndexBuilder();

  it("returns latest for *", () => {
    const index = builder.build([makeResource("a", "1.0.0"), makeResource("a", "2.0.0")]);
    const vi = index.versionIndex.get("a")!;
    const result = lookupByVersionIndex(vi, "*");
    expect(result!.version).toBe("2.0.0");
  });

  it("returns exact version match", () => {
    const index = builder.build([makeResource("a", "1.0.0"), makeResource("a", "2.0.0")]);
    const vi = index.versionIndex.get("a")!;
    const result = lookupByVersionIndex(vi, "1.0.0");
    expect(result!.version).toBe("1.0.0");
  });

  it("returns null for non-existent version", () => {
    const index = builder.build([makeResource("a", "1.0.0")]);
    const vi = index.versionIndex.get("a")!;
    const result = lookupByVersionIndex(vi, "3.0.0");
    expect(result).toBeNull();
  });
});

describe("getVersionsForRange", () => {
  const builder = new ResourceIndexBuilder();

  it("returns all versions for *", () => {
    const index = builder.build([makeResource("a", "1.0.0"), makeResource("a", "2.0.0")]);
    const vi = index.versionIndex.get("a")!;
    const result = getVersionsForRange(vi, "*");
    expect(result).toHaveLength(2);
  });

  it("returns matching versions", () => {
    const index = builder.build([makeResource("a", "1.0.0"), makeResource("a", "2.0.0")]);
    const vi = index.versionIndex.get("a")!;
    const result = getVersionsForRange(vi, "1.0.0");
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe("1.0.0");
  });
});
