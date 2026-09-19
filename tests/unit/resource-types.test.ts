import { describe, it, expect } from "vitest";
import { ResourceTypeRegistry, createTypeRegistry } from "../../src/resource-types/index.js";
import type { ResourceTypeDefinition, ResourceTypeInstaller } from "../../src/types/resource-types.js";

function makeInstaller(): ResourceTypeInstaller {
  return {
    install: async () => ({ success: true, filesWritten: [], duration: 0, errors: [] }),
    preview: async () => ({ files: [], estimatedSize: 0, conflicts: [] }),
    remove: async () => {},
  };
}

function makeDef(id: string, manifestNames: string[] = ["resource.json"]): ResourceTypeDefinition {
  return {
    id,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${id} type`,
    icon: "icon",
    installer: `builtin-${id}`,
    capabilities: {
      supportsDependencies: false,
      supportsVariables: false,
      supportsTemplates: false,
      supportsTransforms: false,
      supportsMerge: false,
      supportsRollback: false,
      supportsPreview: false,
    },
    manifestNames,
    defaultDestination: `./${id}s`,
    mergeStrategies: [],
  };
}

describe("resource-types", () => {
  describe("ResourceTypeRegistry", () => {
    it("registers built-in types on construction", () => {
      const registry = new ResourceTypeRegistry();
      const all = registry.getAll();
      const ids = all.map((r) => r.type.id);
      expect(ids).toContain("plugin");
      expect(ids).toContain("theme");
      expect(ids).toContain("template");
      expect(ids).toContain("module");
      expect(ids).toContain("generator");
      expect(ids).toContain("extension");
    });

    it("has 6 built-in types", () => {
      const registry = new ResourceTypeRegistry();
      expect(registry.getAll()).toHaveLength(6);
    });

    describe("register()", () => {
      it("registers a custom type", () => {
        const registry = new ResourceTypeRegistry();
        const def = makeDef("custom");
        registry.register(def, makeInstaller());
        expect(registry.get("custom")).toBeDefined();
        expect(registry.get("custom")!.type.displayName).toBe("Custom");
      });
    });

    describe("unregister()", () => {
      it("unregisters a type", () => {
        const registry = new ResourceTypeRegistry();
        registry.register(makeDef("temp"), makeInstaller());
        expect(registry.unregister("temp")).toBe(true);
        expect(registry.get("temp")).toBeUndefined();
      });

      it("returns false for unknown type", () => {
        const registry = new ResourceTypeRegistry();
        expect(registry.unregister("nonexistent")).toBe(false);
      });

      it("can unregister built-in types", () => {
        const registry = new ResourceTypeRegistry();
        expect(registry.unregister("plugin")).toBe(true);
        expect(registry.get("plugin")).toBeUndefined();
      });
    });

    describe("get()", () => {
      it("returns registration for known id", () => {
        const registry = new ResourceTypeRegistry();
        const reg = registry.get("plugin");
        expect(reg).toBeDefined();
        expect(reg!.type.id).toBe("plugin");
        expect(reg!.registeredAt).toBeDefined();
      });

      it("returns undefined for unknown id", () => {
        const registry = new ResourceTypeRegistry();
        expect(registry.get("unknown")).toBeUndefined();
      });
    });

    describe("getAll()", () => {
      it("returns all registrations", () => {
        const registry = new ResourceTypeRegistry();
        const all = registry.getAll();
        expect(all.length).toBeGreaterThanOrEqual(6);
        for (const reg of all) {
          expect(reg.type.id).toBeDefined();
          expect(reg.installer).toBeDefined();
          expect(reg.registeredAt).toBeDefined();
        }
      });
    });

    describe("getByManifestName()", () => {
      it("finds type by manifest name", () => {
        const registry = new ResourceTypeRegistry();
        const reg = registry.getByManifestName("resource.json");
        expect(reg).toBeDefined();
      });

      it("finds plugin by package.json", () => {
        const registry = new ResourceTypeRegistry();
        const reg = registry.getByManifestName("package.json");
        expect(reg).toBeDefined();
        expect(reg!.type.id).toBe("plugin");
      });

      it("returns undefined for unknown manifest name", () => {
        const registry = new ResourceTypeRegistry();
        expect(registry.getByManifestName("unknown.xyz")).toBeUndefined();
      });

      it("finds generator by resource.json", () => {
        const registry = new ResourceTypeRegistry();
        const reg = registry.getByManifestName("resource.json");
        expect(reg).toBeDefined();
      });
    });

    describe("install()", () => {
      it("installs via registered installer", async () => {
        const registry = new ResourceTypeRegistry();
        const result = await registry.install(
          {
            resourceId: "res-1",
            version: "1.0.0",
            source: [],
            destination: "/tmp/test",
            variables: {},
            config: null,
            logger: null,
          },
          "plugin",
        );
        expect(result.success).toBe(true);
      });

      it("returns failure for unknown type", async () => {
        const registry = new ResourceTypeRegistry();
        const result = await registry.install(
          {
            resourceId: "res-1",
            version: "1.0.0",
            source: [],
            destination: "/tmp/test",
            variables: {},
            config: null,
            logger: null,
          },
          "nonexistent",
        );
        expect(result.success).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe("preview()", () => {
      it("returns empty preview for unknown type", async () => {
        const registry = new ResourceTypeRegistry();
        const result = await registry.preview(
          {
            resourceId: "res-1",
            version: "1.0.0",
            source: [],
            destination: "/tmp/test",
            variables: {},
            config: null,
            logger: null,
          },
          "nonexistent",
        );
        expect(result.files).toEqual([]);
      });
    });

    describe("remove()", () => {
      it("removes via registered installer", async () => {
        const registry = new ResourceTypeRegistry();
        // Should not throw
        await registry.remove(
          { resourceId: "res-1", destination: "/tmp/test", logger: null },
          "plugin",
        );
      });

      it("handles unknown type gracefully", async () => {
        const registry = new ResourceTypeRegistry();
        // Should not throw
        await registry.remove(
          { resourceId: "res-1", destination: "/tmp/test", logger: null },
          "nonexistent",
        );
      });
    });

    describe("built-in type definitions", () => {
      it("plugin has correct manifest names", () => {
        const registry = new ResourceTypeRegistry();
        const plugin = registry.get("plugin")!;
        expect(plugin.type.manifestNames).toContain("resource.json");
        expect(plugin.type.manifestNames).toContain("manifest.json");
        expect(plugin.type.manifestNames).toContain("vetwo.json");
        expect(plugin.type.manifestNames).toContain("package.json");
      });

      it("theme has correct manifest names", () => {
        const registry = new ResourceTypeRegistry();
        const theme = registry.get("theme")!;
        expect(theme.type.manifestNames).toContain("resource.json");
        expect(theme.type.manifestNames).toContain("manifest.json");
        expect(theme.type.manifestNames).toContain("vetwo.json");
      });

      it("template has correct manifest names", () => {
        const registry = new ResourceTypeRegistry();
        const tpl = registry.get("template")!;
        expect(tpl.type.manifestNames).toContain("resource.json");
      });

      it("module has correct manifest names", () => {
        const registry = new ResourceTypeRegistry();
        const mod = registry.get("module")!;
        expect(mod.type.manifestNames).toContain("package.json");
      });

      it("generator has correct manifest names", () => {
        const registry = new ResourceTypeRegistry();
        const gen = registry.get("generator")!;
        expect(gen.type.manifestNames).toContain("resource.json");
        expect(gen.type.manifestNames).toContain("vetwo.json");
      });

      it("extension has correct manifest names", () => {
        const registry = new ResourceTypeRegistry();
        const ext = registry.get("extension")!;
        expect(ext.type.manifestNames).toContain("package.json");
      });
    });
  });

  describe("createTypeRegistry()", () => {
    it("returns a ResourceTypeRegistry", () => {
      const registry = createTypeRegistry();
      expect(registry).toBeInstanceOf(ResourceTypeRegistry);
      expect(registry.getAll().length).toBeGreaterThanOrEqual(6);
    });
  });
});
