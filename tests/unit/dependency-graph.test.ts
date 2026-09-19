import { describe, it, expect } from "vitest";
import {
  normalizeDependencySpec,
  buildReverseEdges,
  detectCycles,
  detectSelfDependency,
  buildTopologicalOrder,
  pruneIrrelevant,
  getDependents,
  getTransitiveDependents,
  type DependencyNodeV2,
  type DependencyEdge,
} from "../../src/dependencies/graph.js";

function makeNode(id: string, version: string = "1.0.0", deps: DependencyEdge[] = []): DependencyNodeV2 {
  return {
    id,
    version,
    dependencies: deps,
    type: "required",
    optional: false,
    depth: 0,
    originPath: [id],
  };
}

function makeEdge(from: string, to: string, versionRange: string = "*", optional: boolean = false): DependencyEdge {
  return { from, to, type: optional ? "optional" : "required", versionRange, optional };
}

describe("Dependency Graph Model", () => {
  describe("normalizeDependencySpec", () => {
    it("normalizes required dependency", () => {
      const spec = normalizeDependencySpec({ id: "dep", version: "^1.0.0" });
      expect(spec.resourceId).toBe("dep");
      expect(spec.versionRange).toBe("^1.0.0");
      expect(spec.type).toBe("required");
      expect(spec.optional).toBe(false);
    });

    it("normalizes optional dependency", () => {
      const spec = normalizeDependencySpec({ id: "dep", version: "^1.0.0", optional: true });
      expect(spec.type).toBe("optional");
      expect(spec.optional).toBe(true);
    });

    it("defaults version to *", () => {
      const spec = normalizeDependencySpec({ id: "dep" });
      expect(spec.versionRange).toBe("*");
    });
  });

  describe("buildReverseEdges", () => {
    it("builds reverse edges", () => {
      const edges = [
        makeEdge("a", "b"),
        makeEdge("a", "c"),
        makeEdge("b", "c"),
      ];
      const reverse = buildReverseEdges(edges);
      expect(reverse.get("b")).toHaveLength(1);
      expect(reverse.get("b")![0]!.from).toBe("b");
      expect(reverse.get("b")![0]!.to).toBe("a");
      expect(reverse.get("c")).toHaveLength(2);
    });

    it("returns empty map for no edges", () => {
      const reverse = buildReverseEdges([]);
      expect(reverse.size).toBe(0);
    });
  });

  describe("detectCycles", () => {
    it("detects no cycles in acyclic graph", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "b")])],
        ["b", makeNode("b")],
      ]);
      expect(detectCycles(nodes)).toHaveLength(0);
    });

    it("detects simple cycle A -> B -> A", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "b")])],
        ["b", makeNode("b", "1.0.0", [makeEdge("b", "a")])],
      ]);
      const cycles = detectCycles(nodes);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("detects deeper cycle A -> B -> C -> A", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "b")])],
        ["b", makeNode("b", "1.0.0", [makeEdge("b", "c")])],
        ["c", makeNode("c", "1.0.0", [makeEdge("c", "a")])],
      ]);
      const cycles = detectCycles(nodes);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("ignores optional dependencies in cycle detection", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "b", "*", true)])],
        ["b", makeNode("b", "1.0.0", [makeEdge("b", "a", "*", true)])],
      ]);
      expect(detectCycles(nodes)).toHaveLength(0);
    });
  });

  describe("detectSelfDependency", () => {
    it("detects self dependency", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "a")])],
      ]);
      expect(detectSelfDependency(nodes)).toEqual(["a"]);
    });

    it("returns empty when no self dependencies", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "b")])],
        ["b", makeNode("b")],
      ]);
      expect(detectSelfDependency(nodes)).toHaveLength(0);
    });
  });

  describe("buildTopologicalOrder", () => {
    it("returns single node for no edges", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a")],
      ]);
      const order = buildTopologicalOrder(nodes, []);
      expect(order).toEqual(["a"]);
    });

    it("returns dependencies before dependents", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "b")])],
        ["b", makeNode("b")],
      ]);
      const order = buildTopologicalOrder(nodes, [makeEdge("a", "b")]);
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
    });

    it("handles complex DAG", () => {
      const edges = [
        makeEdge("app", "lib"),
        makeEdge("app", "util"),
        makeEdge("lib", "util"),
      ];
      const nodes = new Map<string, DependencyNodeV2>([
        ["app", makeNode("app", "1.0.0", edges)],
        ["lib", makeNode("lib", "1.0.0", [makeEdge("lib", "util")])],
        ["util", makeNode("util")],
      ]);
      const order = buildTopologicalOrder(nodes, edges);
      expect(order.indexOf("util")).toBeLessThan(order.indexOf("lib"));
      expect(order.indexOf("lib")).toBeLessThan(order.indexOf("app"));
    });

    it("returns deterministic ordering", () => {
      const edges = [
        makeEdge("c", "a"),
        makeEdge("c", "b"),
        makeEdge("b", "a"),
      ];
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a")],
        ["b", makeNode("b", "1.0.0", [makeEdge("b", "a")])],
        ["c", makeNode("c", "1.0.0", edges)],
      ]);
      const order1 = buildTopologicalOrder(nodes, edges);
      const order2 = buildTopologicalOrder(nodes, edges);
      expect(order1).toEqual(order2);
    });
  });

  describe("pruneIrrelevant", () => {
    it("prunes unreachable nodes", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "b")])],
        ["b", makeNode("b")],
        ["c", makeNode("c")],
      ]);
      const pruned = pruneIrrelevant(nodes, ["a"], [makeEdge("a", "b")]);
      expect(pruned.has("a")).toBe(true);
      expect(pruned.has("b")).toBe(true);
      expect(pruned.has("c")).toBe(false);
    });

    it("keeps all reachable nodes", () => {
      const nodes = new Map<string, DependencyNodeV2>([
        ["a", makeNode("a", "1.0.0", [makeEdge("a", "b"), makeEdge("a", "c")])],
        ["b", makeNode("b")],
        ["c", makeNode("c")],
      ]);
      const edges = [makeEdge("a", "b"), makeEdge("a", "c")];
      const pruned = pruneIrrelevant(nodes, ["a"], edges);
      expect(pruned.size).toBe(3);
    });
  });

  describe("getDependents", () => {
    it("returns direct dependents", () => {
      const reverseEdges = buildReverseEdges([
        makeEdge("a", "shared"),
        makeEdge("b", "shared"),
      ]);
      const dependents = getDependents("shared", reverseEdges);
      expect(dependents).toContain("a");
      expect(dependents).toContain("b");
    });

    it("returns empty when no dependents", () => {
      const reverseEdges = new Map();
      expect(getDependents("a", reverseEdges)).toEqual([]);
    });
  });

  describe("getTransitiveDependents", () => {
    it("returns transitive dependents", () => {
      const reverseEdges = buildReverseEdges([
        makeEdge("a", "b"),
        makeEdge("b", "c"),
      ]);
      const dependents = getTransitiveDependents("c", reverseEdges);
      expect(dependents).toContain("b");
      expect(dependents).toContain("a");
    });

    it("returns empty when no dependents", () => {
      const reverseEdges = new Map();
      expect(getTransitiveDependents("a", reverseEdges)).toEqual([]);
    });
  });
});
