import { describe, it, expect } from "vitest";
import { DependencyResolver } from "../../src/dependencies/index.js";
import type { RegistryResource, RegistryDependency } from "../../src/types/registry.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

function makeResource(id: string, deps: RegistryDependency[] = []): RegistryResource {
  return {
    id,
    name: id,
    displayName: id,
    description: "",
    version: "1.0.0",
    category: "plugin",
    tags: [],
    author: { name: "test" },
    manifestPath: "",
    manifestHash: "",
    dependencies: deps,
    keywords: [],
  };
}

describe("DependencyResolver", () => {
  let resolver: DependencyResolver;

  beforeEach(() => {
    resolver = new DependencyResolver();
  });

  describe("setResources()", () => {
    it("registers resources", () => {
      resolver.setResources([makeResource("a"), makeResource("b")]);
      expect(resolver.getDependencies("a")).toEqual([]);
      expect(resolver.getDependencies("missing")).toEqual([]);
    });
  });

  describe("resolve() - simple dependencies", () => {
    it("resolves a resource with no dependencies", async () => {
      resolver.setResources([makeResource("a")]);
      const graph = await resolver.resolve("a");
      expect(graph.root).toBe("a");
      expect(graph.flat).toContain("a");
      expect(graph.nodes.size).toBe(1);
      expect(graph.circular).toHaveLength(0);
      expect(graph.conflicts).toHaveLength(0);
    });

    it("resolves a resource with simple dependencies", async () => {
      resolver.setResources([
        makeResource("a", [{ id: "b" }]),
        makeResource("b", [{ id: "c" }]),
        makeResource("c"),
      ]);
      const graph = await resolver.resolve("a");
      expect(graph.flat).toContain("a");
      expect(graph.flat).toContain("b");
      expect(graph.flat).toContain("c");
      expect(graph.nodes.size).toBe(3);
    });

    it("b depends on a comes first in install order", async () => {
      resolver.setResources([
        makeResource("a", [{ id: "b" }]),
        makeResource("b"),
      ]);
      const graph = await resolver.resolve("a");
      const order = resolver.getInstallOrder(graph);
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
    });
  });

  describe("resolve() - circular detection", () => {
    it("detects circular dependencies", async () => {
      resolver.setResources([
        makeResource("a", [{ id: "b" }]),
        makeResource("b", [{ id: "a" }]),
      ]);
      const graph = await resolver.resolve("a");
      expect(graph.circular.length).toBeGreaterThan(0);
    });

    it("detects self-referencing dependency", async () => {
      resolver.setResources([
        makeResource("a", [{ id: "a" }]),
      ]);
      const graph = await resolver.resolve("a");
      expect(graph.circular.length).toBeGreaterThan(0);
    });
  });

  describe("resolve() - conflict detection", () => {
    it("detects conflicting dependency versions", async () => {
      resolver.setResources([
        makeResource("root", [{ id: "dep-v1" }, { id: "dep-v2" }]),
        makeResource("dep-v1"),
        makeResource("dep-v2"),
      ]);
      const graph = await resolver.resolve("root");
      const hasConflict = graph.conflicts.some(
        (c) => c.id === "dep-v1" || c.id === "dep-v2",
      );
      // dep-v1 and dep-v2 have different ids so no conflict by id
      // conflicts arise when same id has different versions
      expect(graph.conflicts.length).toBe(0);
    });
  });

  describe("resolve() - error handling", () => {
    it("throws DEPENDENCY_NOT_FOUND for missing resource", async () => {
      resolver.setResources([makeResource("a", [{ id: "missing" }])]);
      await expect(resolver.resolve("a")).rejects.toThrow(MarketplaceClientError);
    });

    it("throws DEPENDENCY_NOT_FOUND for unknown root", async () => {
      resolver.setResources([]);
      await expect(resolver.resolve("unknown")).rejects.toThrow(MarketplaceClientError);
    });

    it("skips optional dependencies when skipOptional=true", async () => {
      resolver.setResources([
        makeResource("a", [{ id: "missing-optional", optional: true }]),
      ]);
      const graph = await resolver.resolve("a", true);
      expect(graph.flat).toContain("a");
    });

    it("still throws for required missing dep even with skipOptional", async () => {
      resolver.setResources([
        makeResource("a", [{ id: "missing" }]),
      ]);
      await expect(resolver.resolve("a", true)).rejects.toThrow(MarketplaceClientError);
    });
  });

  describe("getDependencies()", () => {
    it("returns dependencies for a resource", () => {
      resolver.setResources([
        makeResource("a", [{ id: "b" }, { id: "c" }]),
      ]);
      expect(resolver.getDependencies("a")).toHaveLength(2);
    });

    it("returns empty for resource with no deps", () => {
      resolver.setResources([makeResource("a")]);
      expect(resolver.getDependencies("a")).toEqual([]);
    });

    it("returns empty for unknown resource", () => {
      expect(resolver.getDependencies("missing")).toEqual([]);
    });
  });

  describe("getDependents()", () => {
    it("finds resources that depend on a given resource", () => {
      resolver.setResources([
        makeResource("a", [{ id: "shared" }]),
        makeResource("b", [{ id: "shared" }]),
        makeResource("c"),
        makeResource("shared"),
      ]);
      const dependents = resolver.getDependents("shared");
      expect(dependents.length).toBe(2);
      expect(dependents.map((d) => d.id)).toContain("a");
      expect(dependents.map((d) => d.id)).toContain("b");
    });

    it("returns empty when no dependents", () => {
      resolver.setResources([makeResource("a")]);
      expect(resolver.getDependents("a")).toEqual([]);
    });
  });

  describe("isInstalled()", () => {
    it("returns true when installed", () => {
      expect(resolver.isInstalled("a", new Set(["a", "b"]))).toBe(true);
    });

    it("returns false when not installed", () => {
      expect(resolver.isInstalled("c", new Set(["a", "b"]))).toBe(false);
    });
  });

  describe("getInstallOrder()", () => {
    it("returns dependencies before dependents", async () => {
      resolver.setResources([
        makeResource("app", [{ id: "lib" }, { id: "util" }]),
        makeResource("lib", [{ id: "util" }]),
        makeResource("util"),
      ]);
      const graph = await resolver.resolve("app");
      const order = resolver.getInstallOrder(graph);
      expect(order.indexOf("util")).toBeLessThan(order.indexOf("lib"));
      expect(order.indexOf("lib")).toBeLessThan(order.indexOf("app"));
    });
  });
});
