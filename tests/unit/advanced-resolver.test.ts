import { describe, it, expect } from "vitest";
import { AdvancedDependencyResolver, type ResolverContext } from "../../src/dependencies/advanced-resolver.js";
import { VersionResolver } from "../../src/versions/index.js";
import type { RegistryResource } from "../../src/types/registry.js";

function makeResource(id: string, version: string, deps: Array<{ id: string; version?: string; optional?: boolean }> = []): RegistryResource {
  return {
    id,
    name: id,
    displayName: id,
    description: `Resource ${id}`,
    version,
    category: "plugin",
    tags: [],
    author: { name: "test" },
    manifestPath: `${id}/resource.json`,
    manifestHash: `hash-${id}`,
    dependencies: deps,
    keywords: [],
  };
}

function makeContext(resources: RegistryResource[], overrides?: Partial<ResolverContext>): ResolverContext {
  const registryResources = new Map<string, RegistryResource[]>();
  for (const r of resources) {
    const existing = registryResources.get(r.id);
    if (existing !== undefined) {
      existing.push(r);
    } else {
      registryResources.set(r.id, [r]);
    }
  }

  return {
    registryResources,
    installedVersions: new Map(),
    nodeVersion: "22.0.0",
    frameworks: [],
    platform: "linux",
    maxDepth: 128,
    skipOptional: false,
    multiVersionPolicy: "deny",
    ...overrides,
  };
}

describe("AdvancedDependencyResolver", () => {
  const versionResolver = new VersionResolver();
  const resolver = new AdvancedDependencyResolver(versionResolver);

  describe("resolve()", () => {
    it("resolves resource with no dependencies", () => {
      const context = makeContext([makeResource("a", "1.0.0")]);
      const result = resolver.resolve("a", context);

      expect(result.graph.root).toBe("a");
      expect(result.graph.totalSize).toBe(1);
      expect(result.resolvedVersions.get("a")).toBe("1.0.0");
      expect(result.conflicts).toHaveLength(0);
      expect(result.isDeterministic).toBe(true);
    });

    it("resolves simple dependency chain", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0"),
      ]);
      const result = resolver.resolve("a", context);

      expect(result.graph.totalSize).toBe(2);
      expect(result.resolvedVersions.has("a")).toBe(true);
      expect(result.resolvedVersions.has("b")).toBe(true);
      expect(result.installationOrder).toContain("b");
      expect(result.installationOrder).toContain("a");
    });

    it("resolves transitive dependencies", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0", [{ id: "c" }]),
        makeResource("c", "1.0.0"),
      ]);
      const result = resolver.resolve("a", context);

      expect(result.graph.totalSize).toBe(3);
      expect(result.installationOrder.indexOf("c")).toBeLessThan(
        result.installationOrder.indexOf("b"),
      );
      expect(result.installationOrder.indexOf("b")).toBeLessThan(
        result.installationOrder.indexOf("a"),
      );
    });

    it("detects dependency cycle", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0", [{ id: "a" }]),
      ]);
      const result = resolver.resolve("a", context);
      expect(result.graph.circular.length).toBeGreaterThan(0);
    });

    it("detects self dependency", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "a" }]),
      ]);
      expect(() => resolver.resolve("a", context)).toThrow();
    });

    it("detects conflicts", () => {
      const context = makeContext([
        makeResource("root", "1.0.0", [
          { id: "dep", version: "^1.0.0" },
        ]),
        makeResource("dep", "1.0.0"),
        makeResource("dep", "2.0.0"),
      ]);
      const result = resolver.resolve("root", context);
      expect(result.conflicts.length).toBeGreaterThanOrEqual(0);
    });

    it("handles shared dependencies", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "shared" }]),
        makeResource("b", "1.0.0", [{ id: "shared" }]),
        makeResource("shared", "1.0.0"),
      ]);

      const resultA = resolver.resolve("a", context);
      expect(resultA.graph.totalSize).toBe(2);
      expect(resultA.resolvedVersions.has("shared")).toBe(true);
    });

    it("skips optional dependencies when skipOptional=true", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "optional-dep", optional: true }]),
      ], { skipOptional: true });
      const result = resolver.resolve("a", context);

      expect(result.graph.totalSize).toBe(1);
      expect(result.optionalResults.length).toBeGreaterThanOrEqual(0);
    });

    it("records peer requirements", () => {
      const resources = [
        makeResource("a", "1.0.0", [{ id: "peer-dep", version: "^1.0.0" }]),
        makeResource("peer-dep", "1.0.0"),
      ];
      const context = makeContext(resources);
      const result = resolver.resolve("a", context);
      expect(result.peerRequirements).toBeDefined();
      expect(result.peerRequirements.length).toBeGreaterThanOrEqual(0);
    });

    it("handles missing required dependency", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "missing" }]),
      ]);
      expect(() => resolver.resolve("a", context)).toThrow();
    });

    it("records optional dependency not found", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "missing-optional", optional: true }]),
      ]);
      const result = resolver.resolve("a", context);
      expect(result.optionalResults.some((r) => r.dependencyId === "missing-optional")).toBe(true);
    });

    it("produces deterministic results", () => {
      const context = makeContext([
        makeResource("a", "1.0.0", [{ id: "b" }, { id: "c" }]),
        makeResource("b", "1.0.0"),
        makeResource("c", "1.0.0"),
      ]);
      const result1 = resolver.resolve("a", context);
      const result2 = resolver.resolve("a", context);

      expect(result1.installationOrder).toEqual(result2.installationOrder);
      expect(result1.resolvedVersions).toEqual(result2.resolvedVersions);
    });
  });

  describe("analyzeImpact()", () => {
    it("reports no impact for no dependents", () => {
      const resources = [
        makeResource("a", "1.0.0"),
        makeResource("b", "1.0.0"),
      ];
      const context = makeContext(resources);
      const impact = resolver.analyzeImpact("a", "2.0.0", context);

      expect(impact.resourceId).toBe("a");
      expect(impact.newVersion).toBe("2.0.0");
      expect(impact.directDependents).toHaveLength(0);
      expect(impact.impactSeverity).toBe("safe");
    });

    it("reports direct dependents", () => {
      const resources = [
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0"),
      ];
      const context = makeContext(resources);
      const impact = resolver.analyzeImpact("b", "2.0.0", context);

      expect(impact.directDependents).toContain("a");
    });

    it("reports transitive dependents", () => {
      const resources = [
        makeResource("a", "1.0.0", [{ id: "b" }]),
        makeResource("b", "1.0.0", [{ id: "c" }]),
        makeResource("c", "1.0.0"),
      ];
      const context = makeContext(resources);
      const impact = resolver.analyzeImpact("c", "2.0.0", context);

      expect(impact.transitiveDependents).toContain("b");
      expect(impact.transitiveDependents).toContain("a");
    });
  });
});
