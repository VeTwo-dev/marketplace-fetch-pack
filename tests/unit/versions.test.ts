import { describe, it, expect } from "vitest";
import { VersionResolver } from "../../src/versions/index.js";
import type { RegistryResource } from "../../src/types/registry.js";

function makeResource(id: string, version: string, compat?: { node?: string; frameworks?: string[]; platforms?: string[] }): RegistryResource {
  return {
    id,
    name: id,
    displayName: id,
    description: "",
    version,
    category: "plugin",
    tags: [],
    author: { name: "test" },
    manifestPath: "",
    manifestHash: "",
    dependencies: [],
    keywords: [],
    compatibility: compat,
  };
}

describe("VersionResolver", () => {
  const resolver = new VersionResolver();

  describe("compareVersions()", () => {
    it("returns positive when a > b", () => {
      expect(resolver.compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
    });

    it("returns negative when a < b", () => {
      expect(resolver.compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    });

    it("returns 0 when equal", () => {
      expect(resolver.compareVersions("1.2.3", "1.2.3")).toBe(0);
    });

    it("compares patch versions", () => {
      expect(resolver.compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
    });

    it("compares minor versions", () => {
      expect(resolver.compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    });

    it("handles v prefix", () => {
      expect(resolver.compareVersions("v1.0.0", "1.0.0")).toBe(0);
    });

    it("pre-release versions are lower", () => {
      expect(resolver.compareVersions("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
    });

    it("pre-release alpha < beta", () => {
      expect(resolver.compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    });
  });

  describe("parseSpec()", () => {
    it("parses * as any", () => {
      const spec = resolver.parseSpec("*");
      expect(spec.operator).toBe("any");
    });

    it("parses >= as gte", () => {
      const spec = resolver.parseSpec(">=1.0.0");
      expect(spec.operator).toBe("gte");
      expect(spec.version).toBe("1.0.0");
    });

    it("parses <= as lte", () => {
      const spec = resolver.parseSpec("<=2.0.0");
      expect(spec.operator).toBe("lte");
      expect(spec.version).toBe("2.0.0");
    });

    it("parses > as gt", () => {
      const spec = resolver.parseSpec(">1.0.0");
      expect(spec.operator).toBe("gt");
    });

    it("parses < as lt", () => {
      const spec = resolver.parseSpec("<2.0.0");
      expect(spec.operator).toBe("lt");
    });

    it("parses ^ as caret", () => {
      const spec = resolver.parseSpec("^1.2.3");
      expect(spec.operator).toBe("caret");
      expect(spec.version).toBe("1.2.3");
    });

    it("parses ~ as tilde", () => {
      const spec = resolver.parseSpec("~1.2.3");
      expect(spec.operator).toBe("tilde");
      expect(spec.version).toBe("1.2.3");
    });

    it("parses exact version", () => {
      const spec = resolver.parseSpec("1.2.3");
      expect(spec.operator).toBe("exact");
      expect(spec.version).toBe("1.2.3");
    });
  });

  describe("satisfies()", () => {
    it("any satisfies all versions", () => {
      expect(resolver.satisfies("1.0.0", { raw: "*", operator: "any", version: "0.0.0" })).toBe(true);
    });

    it("exact match", () => {
      expect(resolver.satisfies("1.2.3", { raw: "1.2.3", operator: "exact", version: "1.2.3" })).toBe(true);
    });

    it("exact mismatch", () => {
      expect(resolver.satisfies("1.2.4", { raw: "1.2.3", operator: "exact", version: "1.2.3" })).toBe(false);
    });

    it("gte satisfies higher version", () => {
      expect(resolver.satisfies("2.0.0", { raw: ">=1.0.0", operator: "gte", version: "1.0.0" })).toBe(true);
    });

    it("gte satisfies equal version", () => {
      expect(resolver.satisfies("1.0.0", { raw: ">=1.0.0", operator: "gte", version: "1.0.0" })).toBe(true);
    });

    it("gte fails lower version", () => {
      expect(resolver.satisfies("0.9.0", { raw: ">=1.0.0", operator: "gte", version: "1.0.0" })).toBe(false);
    });

    it("lte satisfies lower version", () => {
      expect(resolver.satisfies("1.0.0", { raw: "<=2.0.0", operator: "lte", version: "2.0.0" })).toBe(true);
    });

    it("gt requires strictly greater", () => {
      expect(resolver.satisfies("1.0.0", { raw: ">1.0.0", operator: "gt", version: "1.0.0" })).toBe(false);
      expect(resolver.satisfies("1.0.1", { raw: ">1.0.0", operator: "gt", version: "1.0.0" })).toBe(true);
    });

    it("lt requires strictly less", () => {
      expect(resolver.satisfies("2.0.0", { raw: "<2.0.0", operator: "lt", version: "2.0.0" })).toBe(false);
      expect(resolver.satisfies("1.9.9", { raw: "<2.0.0", operator: "lt", version: "2.0.0" })).toBe(true);
    });

    it("caret allows patch updates", () => {
      expect(resolver.satisfies("1.2.5", { raw: "^1.2.3", operator: "caret", version: "1.2.3" })).toBe(true);
    });

    it("caret disallows major bump", () => {
      expect(resolver.satisfies("2.0.0", { raw: "^1.2.3", operator: "caret", version: "1.2.3" })).toBe(false);
    });

    it("tilde allows patch updates same minor", () => {
      expect(resolver.satisfies("1.2.5", { raw: "~1.2.3", operator: "tilde", version: "1.2.3" })).toBe(true);
    });

    it("tilde disallows minor bump", () => {
      expect(resolver.satisfies("1.3.0", { raw: "~1.2.3", operator: "tilde", version: "1.2.3" })).toBe(false);
    });
  });

  describe("resolveVersion()", () => {
    const available = [
      makeResource("a", "1.0.0"),
      makeResource("b", "1.2.0"),
      makeResource("c", "2.0.0"),
      makeResource("d", "2.1.0"),
    ];

    it("* returns latest version", () => {
      const result = resolver.resolveVersion(available, "*");
      expect(result).not.toBeNull();
      expect(result!.resolved).toBe("2.1.0");
      expect(result!.satisfies).toBe(true);
    });

    it("exact version match", () => {
      const result = resolver.resolveVersion(available, "1.2.0");
      expect(result).not.toBeNull();
      expect(result!.resolved).toBe("1.2.0");
    });

    it("range returns best matching", () => {
      const result = resolver.resolveVersion(available, ">=1.0.0");
      expect(result).not.toBeNull();
      expect(result!.resolved).toBe("2.1.0");
    });

    it("returns null for empty available", () => {
      const result = resolver.resolveVersion([], "*");
      expect(result).toBeNull();
    });

    it("returns unsatisfied when no match", () => {
      const result = resolver.resolveVersion(available, "3.0.0");
      expect(result).not.toBeNull();
      expect(result!.satisfies).toBe(false);
      expect(result!.resolved).toBe("");
    });

    it("latest returns latest", () => {
      const result = resolver.resolveVersion(available, "latest");
      expect(result!.resolved).toBe("2.1.0");
    });
  });

  describe("getLatest()", () => {
    it("returns null for empty array", () => {
      expect(resolver.getLatest([])).toBeNull();
    });

    it("returns the latest version", () => {
      const resources = [makeResource("a", "1.0.0"), makeResource("b", "2.0.0")];
      const result = resolver.getLatest(resources);
      expect(result!.version).toBe("2.0.0");
    });
  });

  describe("getCompatible()", () => {
    const resources = [
      makeResource("a", "1.0.0", { node: ">=20.0.0" }),
      makeResource("b", "2.0.0", { frameworks: ["react"] }),
      makeResource("c", "3.0.0"),
    ];

    it("filters by node version", () => {
      const result = resolver.getCompatible(resources, "22.0.0");
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by frameworks", () => {
      const result = resolver.getCompatible(resources, "22.0.0", ["react"]);
      expect(result.some((r) => r.id === "b")).toBe(true);
    });

    it("returns all when no compat info", () => {
      const noCompat = [makeResource("x", "1.0.0")];
      const result = resolver.getCompatible(noCompat, "18.0.0");
      expect(result).toHaveLength(1);
    });
  });

  describe("checkCompatibility()", () => {
    it("reports compatible for matching resource", () => {
      const resource = makeResource("a", "1.0.0", { node: ">=20.0.0" });
      const result = resolver.checkCompatibility(resource, "22.0.0");
      expect(result.compatible).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("reports incompatible node version", () => {
      const resource = makeResource("a", "1.0.0", { node: ">=20.0.0" });
      const result = resolver.checkCompatibility(resource, "18.0.0");
      expect(result.compatible).toBe(false);
      expect(result.issues.some((i) => i.type === "node")).toBe(true);
    });

    it("reports framework mismatch as warning", () => {
      const resource = makeResource("a", "1.0.0", { node: ">=20.0.0", frameworks: ["react"] });
      const result = resolver.checkCompatibility(resource, "22.0.0", ["vue"]);
      expect(result.compatible).toBe(true);
      expect(result.issues.some((i) => i.type === "framework" && i.severity === "warning")).toBe(true);
    });

    it("compatible when no compat info", () => {
      const resource = makeResource("a", "1.0.0");
      const result = resolver.checkCompatibility(resource, "18.0.0");
      expect(result.compatible).toBe(true);
    });
  });
});
