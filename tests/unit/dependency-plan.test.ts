import { describe, it, expect, beforeEach } from "vitest";
import { DependencyResolver } from "../../src/dependencies/index.js";
import { InstallationPlanBuilder } from "../../src/dependencies/plan.js";
import { VersionResolver } from "../../src/versions/index.js";
import { createLogger } from "../../src/logger/index.js";
import type { RegistryResource } from "../../src/types/registry.js";

const logger = createLogger({ prefix: "test", level: "silent" });

function makeResource(
  id: string,
  version: string,
  deps: Array<{ id: string; version?: string; optional?: boolean }> = [],
): RegistryResource {
  return {
    id,
    name: id,
    displayName: id,
    description: `Resource ${id}`,
    version,
    category: "test",
    tags: [],
    author: { name: "test" },
    manifestPath: `https://example.com/${id}/${version}/resource.json`,
    manifestHash: "",
    dependencies: deps,
    keywords: [],
  };
}

describe("DependencyResolver", () => {
  let resolver: DependencyResolver;

  beforeEach(() => {
    resolver = new DependencyResolver(logger);
  });

  describe("resolve", () => {
    it("resolves single resource with no deps", async () => {
      resolver.setResources([makeResource("a", "1.0.0")]);
      const graph = await resolver.resolve("a");
      expect(graph.root).toBe("a");
      expect(graph.flat).toEqual(["a"]);
      expect(graph.circular).toHaveLength(0);
      expect(graph.conflicts).toHaveLength(0);
    });

    it("resolves transitive dependencies", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0", [{ id: "c" }]),
        makeResource("c", "1.0.0"),
      ]);
      const graph = await resolver.resolve("a");
      expect(graph.flat).toContain("a");
      expect(graph.flat).toContain("b");
      expect(graph.flat).toContain("c");
      expect(graph.totalSize).toBe(3);
    });

    it("resolves multiple dependencies", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }, { id: "c" }]),
        makeResource("b", "1.0.0"),
        makeResource("c", "1.0.0"),
      ]);
      const graph = await resolver.resolve("a");
      expect(graph.flat.length).toBe(3);
    });

    it("detects circular dependencies", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0", [{ id: "a" }]),
      ]);
      const graph = await resolver.resolve("a");
      expect(graph.circular.length).toBeGreaterThan(0);
    });

    it("detects self-referencing circular", async () => {
      resolver.setResources([makeResource("a", "1.0.0", [{ id: "a" }])]);
      const graph = await resolver.resolve("a");
      expect(graph.circular.length).toBeGreaterThan(0);
    });

    it("throws on missing required dependency", async () => {
      resolver.setResources([makeResource("a", "1.0.0", [{ id: "missing" }])]);
      await expect(resolver.resolve("a")).rejects.toThrow();
    });

    it("skips optional dependencies when skipOptional=true", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [
          { id: "b" },
          { id: "opt-dep", optional: true },
        ]),
        makeResource("b", "1.0.0"),
      ]);
      const graph = await resolver.resolve("a", true);
      expect(graph.flat).toContain("a");
      expect(graph.flat).toContain("b");
      expect(graph.flat).not.toContain("opt-dep");
    });

    it("resolves version-constrained dependencies", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b", version: "^1.0.0" }]),
        makeResource("b", "1.0.0"),
        makeResource("b", "1.2.0"),
        makeResource("b", "2.0.0"),
      ]);
      const graph = await resolver.resolve("a");
      const bNode = graph.nodes.get("b");
      expect(bNode).toBeDefined();
      expect(bNode!.version).toBe("1.2.0");
    });

    it("uses latest version for wildcard dependency", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0"),
        makeResource("b", "2.0.0"),
      ]);
      const graph = await resolver.resolve("a");
      const bNode = graph.nodes.get("b");
      expect(bNode!.version).toBe("2.0.0");
    });

    it("getInstallOrder returns topological order", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }, { id: "c" }]),
        makeResource("b", "1.0.0", [{ id: "c" }]),
        makeResource("c", "1.0.0"),
      ]);
      const graph = await resolver.resolve("a");
      const order = resolver.getInstallOrder(graph);
      const cIdx = order.indexOf("c");
      const bIdx = order.indexOf("b");
      const aIdx = order.indexOf("a");
      expect(cIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(aIdx);
    });

    it("throws on unknown root resource", async () => {
      resolver.setResources([]);
      await expect(resolver.resolve("nonexistent")).rejects.toThrow();
    });

    it("returns empty graph for resource with no deps", async () => {
      resolver.setResources([makeResource("a", "1.0.0")]);
      const graph = await resolver.resolve("a");
      expect(graph.nodes.size).toBe(1);
      expect(graph.flat).toEqual(["a"]);
    });

    it("handles diamond dependency", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }, { id: "c" }]),
        makeResource("b", "1.0.0", [{ id: "d" }]),
        makeResource("c", "1.0.0", [{ id: "d" }]),
        makeResource("d", "1.0.0"),
      ]);
      const graph = await resolver.resolve("a");
      const dNodes = graph.flat.filter((id) => id === "d");
      expect(dNodes).toHaveLength(1);
    });

    it("propagates optional flag on DependencyNode", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [
          { id: "b" },
          { id: "opt", optional: true },
        ]),
        makeResource("b", "1.0.0"),
        makeResource("opt", "1.0.0"),
      ]);
      const graph = await resolver.resolve("a", false);
      const optNode = graph.nodes.get("opt");
      expect(optNode).toBeDefined();
      expect(optNode!.optional).toBe(true);
      const bNode = graph.nodes.get("b");
      expect(bNode!.optional).toBe(false);
    });

    it("resolves exact version constraint", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b", version: "1.2.0" }]),
        makeResource("b", "1.0.0"),
        makeResource("b", "1.2.0"),
        makeResource("b", "2.0.0"),
      ]);
      const graph = await resolver.resolve("a");
      const bNode = graph.nodes.get("b");
      expect(bNode!.version).toBe("1.2.0");
    });

    it("resolves tilde constraint", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b", version: "~1.2.0" }]),
        makeResource("b", "1.0.0"),
        makeResource("b", "1.2.0"),
        makeResource("b", "1.3.0"),
        makeResource("b", "2.0.0"),
      ]);
      const graph = await resolver.resolve("a");
      const bNode = graph.nodes.get("b");
      expect(bNode!.version).toBe("1.2.0");
    });
  });

  describe("resolvePlan", () => {
    it("creates plan with install action for new resources", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0"),
      ]);
      const plan = await resolver.resolvePlan("a");
      expect(plan.resources.get("a")!.action).toBe("install");
      expect(plan.resources.get("b")!.action).toBe("install");
    });

    it("marks installed compatible resources as skip", async () => {
      resolver.setResources([makeResource("a", "1.0.0")]);
      const plan = await resolver.resolvePlan("a", {
        installed: new Set(["a"]),
        installedVersions: new Map([["a", "1.0.0"]]),
      });
      expect(plan.resources.get("a")!.action).toBe("skip");
      expect(plan.skipped).toContain("a");
    });

    it("marks installed incompatible resources as update", async () => {
      resolver.setResources([makeResource("a", "2.0.0")]);
      const plan = await resolver.resolvePlan("a", {
        installed: new Set(["a"]),
        installedVersions: new Map([["a", "1.0.0"]]),
      });
      expect(plan.resources.get("a")!.action).toBe("update");
    });

    it("dryRun flag propagates", async () => {
      resolver.setResources([makeResource("a", "1.0.0")]);
      const plan = await resolver.resolvePlan("a", { dryRun: true });
      expect(plan.dryRun).toBe(true);
    });

    it("installOrder is topological", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }, { id: "c" }]),
        makeResource("b", "1.0.0", [{ id: "c" }]),
        makeResource("c", "1.0.0"),
      ]);
      const plan = await resolver.resolvePlan("a");
      const cIdx = plan.installOrder.indexOf("c");
      const bIdx = plan.installOrder.indexOf("b");
      const aIdx = plan.installOrder.indexOf("a");
      expect(cIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(aIdx);
    });

    it("totalResources is correct", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0"),
      ]);
      const plan = await resolver.resolvePlan("a");
      expect(plan.totalResources).toBe(2);
    });

    it("version range selects highest satisfying", async () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "lib", version: "~1.2.0" }]),
        makeResource("lib", "1.0.0"),
        makeResource("lib", "1.2.0"),
        makeResource("lib", "1.3.0"),
        makeResource("lib", "2.0.0"),
      ]);
      const plan = await resolver.resolvePlan("a");
      const lib = plan.resources.get("lib");
      expect(lib).toBeDefined();
      expect(lib!.version).toBe("1.2.0");
    });
  });

  describe("getDependents", () => {
    it("finds resources that depend on given id", () => {
      resolver.setResources([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0"),
        makeResource("c", "1.0.0", [{ id: "b" }]),
      ]);
      const dependents = resolver.getDependents("b");
      expect(dependents.length).toBe(2);
    });

    it("returns empty for no dependents", () => {
      resolver.setResources([makeResource("a", "1.0.0")]);
      const dependents = resolver.getDependents("a");
      expect(dependents).toHaveLength(0);
    });
  });

  describe("large graph performance", () => {
    it("handles 10 nodes efficiently", async () => {
      const resources: RegistryResource[] = [];
      for (let i = 0; i < 10; i++) {
        const deps = i > 0 ? [{ id: `n${i - 1}` }] : [];
        resources.push(makeResource(`n${i}`, "1.0.0", deps));
      }
      resolver.setResources(resources);
      const start = Date.now();
      const plan = await resolver.resolvePlan("n9");
      expect(Date.now() - start).toBeLessThan(1000);
      expect(plan.totalResources).toBe(10);
    });

    it("handles 50 nodes efficiently", async () => {
      const resources: RegistryResource[] = [];
      for (let i = 0; i < 50; i++) {
        const deps = i > 0 ? [{ id: `n${i - 1}` }] : [];
        resources.push(makeResource(`n${i}`, "1.0.0", deps));
      }
      resolver.setResources(resources);
      const start = Date.now();
      const plan = await resolver.resolvePlan("n49");
      expect(Date.now() - start).toBeLessThan(2000);
      expect(plan.totalResources).toBe(50);
    });

    it("handles 100 nodes efficiently", async () => {
      const resources: RegistryResource[] = [];
      for (let i = 0; i < 100; i++) {
        const deps = i > 0 ? [{ id: `n${i - 1}` }] : [];
        resources.push(makeResource(`n${i}`, "1.0.0", deps));
      }
      resolver.setResources(resources);
      const start = Date.now();
      const plan = await resolver.resolvePlan("n99");
      expect(Date.now() - start).toBeLessThan(3000);
      expect(plan.totalResources).toBe(100);
    });
  });
});

describe("InstallationPlanBuilder", () => {
  let resolver: DependencyResolver;
  let builder: InstallationPlanBuilder;

  beforeEach(() => {
    resolver = new DependencyResolver(logger);
    builder = new InstallationPlanBuilder(
      resolver,
      new VersionResolver(logger),
      logger,
    );
  });

  it("builds plan for single resource", async () => {
    resolver.setResources([makeResource("a", "1.0.0")]);
    const plan = await builder.buildPlan("a");
    expect(plan.root).toBe("a");
    expect(plan.totalResources).toBe(1);
  });

  it("builds plan with dependencies", async () => {
    resolver.setResources([
      makeResource("a", "1.0.0", [{ id: "b" }]),
      makeResource("b", "1.0.0"),
    ]);
    const plan = await builder.buildPlan("a");
    expect(plan.totalResources).toBe(2);
    expect(plan.installOrder).toContain("b");
    expect(plan.installOrder).toContain("a");
  });

  it("throws for unknown resource", async () => {
    resolver.setResources([]);
    await expect(builder.buildPlan("unknown")).rejects.toThrow();
  });

  it("builds multi-plan merging two roots", async () => {
    resolver.setResources([
      makeResource("a", "1.0.0", [{ id: "shared" }]),
      makeResource("b", "1.0.0", [{ id: "shared" }]),
      makeResource("shared", "1.0.0"),
    ]);
    const plan = await builder.buildMultiPlan(["a", "b"]);
    expect(plan.totalResources).toBe(3);
    const sharedCount = plan.installOrder.filter((id) => id === "shared").length;
    expect(sharedCount).toBe(1);
  });

  it("throws for empty multi-plan", async () => {
    await expect(builder.buildMultiPlan([])).rejects.toThrow();
  });

  it("deterministic output for same inputs", async () => {
    resolver.setResources([
      makeResource("a", "1.0.0", [{ id: "b" }, { id: "c" }]),
      makeResource("b", "1.0.0"),
      makeResource("c", "1.0.0"),
    ]);
    const plan1 = await builder.buildPlan("a");
    const plan2 = await builder.buildPlan("a");
    expect(plan1.installOrder).toEqual(plan2.installOrder);
  });
});
