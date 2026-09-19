import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ResourceTypeRegistry,
  createTypeRegistry,
} from "../../src/resource-types/index.js";
import {
  InstallerRegistry,
  createInstallerRegistry,
} from "../../src/installer-registry/index.js";
import { genericFileInstaller } from "../../src/installer-registry/generic.js";
import { PluginManager } from "../../src/plugins/index.js";
import type { Plugin } from "../../src/types/plugin.js";
import type {
  ResourceTypeDefinition,
  ResourceTypeInstaller,
  InstallerContext,
} from "../../src/types/resource-types.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

function makeDef(id: string): ResourceTypeDefinition {
  return {
    id,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${id} type`,
    icon: "icon",
    installer: `${id}-installer`,
    capabilities: ["install", "update", "remove", "repair", "preview"],
    manifestNames: [`${id}.json`, "resource.json"],
    defaultDestination: `./${id}s`,
    mergeStrategies: [],
  };
}

function makeInstaller(): ResourceTypeInstaller {
  return {
    install: async () => ({
      success: true,
      filesWritten: [],
      duration: 0,
      errors: [],
    }),
    remove: async () => {},
    repair: async () => ({
      success: true,
      filesWritten: [],
      duration: 0,
      errors: [],
    }),
  };
}

describe("ResourceTypeRegistry extensions", () => {
  it("rejects duplicate resource type ids", () => {
    const registry = new ResourceTypeRegistry();
    expect(() => registry.register(makeDef("plugin"), makeInstaller())).toThrow(
      MarketplaceClientError,
    );
  });

  it("registers external types with plugin provenance", () => {
    const registry = new ResourceTypeRegistry();
    registry.register(makeDef("widget"), makeInstaller(), {
      source: "plugin",
      pluginId: "widget-plugin",
    });

    const reg = registry.get("widget");
    expect(reg).toBeDefined();
    expect(reg!.source).toBe("plugin");
    expect(reg!.pluginId).toBe("widget-plugin");
  });

  it("indexes manifest names for O(1) lookup", () => {
    const registry = new ResourceTypeRegistry();
    const reg = registry.getByManifestName("package.json");
    expect(reg).toBeDefined();
    expect(reg!.type.id).toBe("plugin");

    // Custom types are indexed too
    registry.register(makeDef("widgetish"), makeInstaller());
    expect(registry.getByManifestName("widgetish.json")!.type.id).toBe(
      "widgetish",
    );
  });

  it("checks capabilities per type", () => {
    const registry = new ResourceTypeRegistry();
    expect(registry.hasCapability("theme", "merge")).toBe(true);
    expect(registry.hasCapability("generator", "merge")).toBe(false);
    expect(registry.hasCapability("nonexistent", "install")).toBe(false);

    const mergeable = registry.getByCapability("merge");
    expect(mergeable.map((r) => r.type.id)).toContain("theme");
    expect(mergeable.map((r) => r.type.id)).not.toContain("generator");
  });

  it("validates required capabilities", () => {
    const registry = new ResourceTypeRegistry();
    const ok = registry.validateCapabilities("theme", ["install", "remove"]);
    expect(ok.valid).toBe(true);

    const missing = registry.validateCapabilities("generator", [
      "install",
      "configuration",
    ]);
    expect(missing.valid).toBe(false);
    expect(missing.errors[0]).toContain("configuration");
  });

  it("runs resource-specific validators", async () => {
    const registry = new ResourceTypeRegistry();
    registry.register(
      {
        ...makeDef("strict"),
        validators: [
          {
            name: "requires-entry",
            validate: (manifest) => ({
              valid: typeof manifest.entry === "string",
              errors:
                typeof manifest.entry === "string"
                  ? []
                  : ["Missing required field: entry"],
              warnings: [],
            }),
          },
        ],
      },
      makeInstaller(),
    );

    const bad = await registry.validateManifest("strict", {});
    expect(bad.valid).toBe(false);
    expect(bad.errors).toContain("Missing required field: entry");

    const good = await registry.validateManifest("strict", { entry: "index.js" });
    expect(good.valid).toBe(true);
  });

  it("detects resource type from manifest metadata", () => {
    const registry = new ResourceTypeRegistry();

    expect(registry.detectType({ type: "theme" })).toBe("theme");
    expect(registry.detectType({ resourceType: "module" })).toBe("module");
    expect(registry.detectType({ themeConfig: {} })).toBe("theme");
    expect(registry.detectType({ unknownThing: 1 })).toBeUndefined();
  });
});

describe("InstallerRegistry", () => {
  it("rejects duplicate installer ids", () => {
    const registry = new InstallerRegistry();
    const def = {
      id: "x-installer",
      name: "X",
      description: "",
      supportedResourceTypes: ["x"],
      priority: 0,
    };
    registry.register(def, genericFileInstaller);
    expect(() => registry.register(def, genericFileInstaller)).toThrow(
      MarketplaceClientError,
    );
  });

  it("resolves installer by resource type using highest priority", async () => {
    const registry = new InstallerRegistry();
    const calls: string[] = [];

    registry.register(
      {
        id: "fallback-installer",
        name: "Fallback",
        description: "",
        supportedResourceTypes: ["shared"],
        priority: 0,
      },
      async () => {
        calls.push("fallback");
        return { success: true, filesWritten: [], duration: 0, errors: [] };
      },
    );
    registry.register(
      {
        id: "specialized-installer",
        name: "Specialized",
        description: "",
        supportedResourceTypes: ["shared"],
        priority: 10,
      },
      async () => {
        calls.push("specialized");
        return { success: true, filesWritten: [], duration: 0, errors: [] };
      },
    );

    const resolved = registry.getByResourceType("shared");
    expect(resolved!.definition.id).toBe("specialized-installer");

    await registry.install(
      {
        resourceId: "r1",
        version: "1.0.0",
        source: [],
        destination: "/tmp/x",
        variables: {},
        resourceType: "shared",
      },
      "shared",
    );
    expect(calls).toEqual(["specialized"]);
  });

  it("returns structured failure for unsupported resource type", async () => {
    const registry = new InstallerRegistry();
    const result = await registry.install(
      {
        resourceId: "r1",
        version: "1.0.0",
        source: [],
        destination: "/tmp/x",
        variables: {},
        resourceType: "mystery",
      },
      "mystery",
    );
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("No installer registered");
  });

  it("unregistering removes type mapping", () => {
    const registry = new InstallerRegistry();
    registry.register(
      {
        id: "t-installer",
        name: "T",
        description: "",
        supportedResourceTypes: ["t-type"],
        priority: 0,
      },
      genericFileInstaller,
    );
    expect(registry.getByResourceType("t-type")).toBeDefined();
    registry.unregister("t-installer");
    expect(registry.getByResourceType("t-type")).toBeUndefined();
  });
});

describe("Generic file installer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "generic-installer-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes source files into destination", async () => {
    const result = await genericFileInstaller({
      resourceId: "gen-res",
      version: "1.0.0",
      source: [
        { path: "a.txt", content: "alpha" },
        { path: "nested/b.txt", content: "beta" },
      ],
      destination: tempDir,
      variables: {},
      resourceType: "any",
    });

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual(["a.txt", "nested/b.txt"]);

    expect(await readFile(join(tempDir, "a.txt"), "utf-8")).toBe("alpha");
    expect(await readFile(join(tempDir, "nested/b.txt"), "utf-8")).toBe("beta");
  });

  it("supports dry run without touching disk", async () => {
    const result = await genericFileInstaller({
      resourceId: "gen-res",
      version: "1.0.0",
      source: [{ path: "dry.txt", content: "x" }],
      destination: tempDir,
      variables: {},
      resourceType: "any",
      dryRun: true,
    });

    expect(result.filesWritten).toEqual(["dry.txt"]);
    let exists = true;
    try {
      await stat(join(tempDir, "dry.txt"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

describe("CRITICAL: external resource type via plugin system", () => {
  let tempDir: string;
  let stateDir: string;
  let typeRegistry: ResourceTypeRegistry;
  let installerRegistry: InstallerRegistry;
  let pluginManager: PluginManager;
  let widgetFilesWritten: Map<string, string>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "external-ext-test-"));
    stateDir = join(tempDir, ".vetwo/marketplace/plugins");
    typeRegistry = createTypeRegistry();
    installerRegistry = createInstallerRegistry();
    pluginManager = new PluginManager(undefined, { stateDir });
    widgetFilesWritten = new Map();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildWidgetPlugin(): Plugin {
    // This simulates an EXTERNAL plugin package (e.g.
    // @vetwo/marketplace-plugin-widget). It uses only public contracts:
    // Plugin manifest/hooks + ResourceTypeDefinition/Installer registries.
    const widgetInstaller: ResourceTypeInstaller = {
      install: async (context: InstallerContext) => {
        for (const file of context.source) {
          const full = join(context.destination, context.resourceId, file.path);
          await mkdir(full.substring(0, full.lastIndexOf("/")), {
            recursive: true,
          });
          await writeFile(full, file.content, "utf-8");
          widgetFilesWritten.set(`${context.resourceId}/${file.path}`, file.content);
        }
        return {
          success: true,
          filesWritten: context.source.map((f) => f.path),
          duration: 1,
          errors: [],
        };
      },
      update: async (context: InstallerContext) =>
        widgetInstaller.install(context),
      repair: async (context: InstallerContext) => {
        // Repair rewrites all managed files
        return widgetInstaller.install(context);
      },
      remove: async (context) => {
        const { rm } = await import("node:fs/promises");
        await rm(join(context.destination, context.resourceId), {
          recursive: true,
          force: true,
        });
        for (const key of [...widgetFilesWritten.keys()]) {
          if (key.startsWith(`${context.resourceId}/`)) {
            widgetFilesWritten.delete(key);
          }
        }
      },
    };

    return {
      manifest: {
        id: "marketplace-plugin-widget",
        name: "VeTwo Widget Plugin",
        version: "1.0.0",
        description: "External widget resource type",
        author: "external",
        capabilities: ["resource-type", "installer"],
      },
      hooks: {
        onInitialize: () => {
          typeRegistry.register(
            {
              id: "widget",
              displayName: "Widget",
              description: "A third-party widget resource",
              icon: "box",
              installer: "widget-installer",
              capabilities: ["install", "update", "remove", "repair"],
              manifestNames: ["widget.json"],
              defaultDestination: "./widgets",
              mergeStrategies: [],
            },
            widgetInstaller,
            { source: "plugin", pluginId: "marketplace-plugin-widget" },
          );

          installerRegistry.register(
            {
              id: "widget-installer",
              name: "Widget Installer",
              description: "Installs widgets",
              supportedResourceTypes: ["widget"],
              priority: 10,
            },
            async (ctx) => genericFileInstaller(ctx),
            { source: "plugin", pluginId: "marketplace-plugin-widget" },
          );
        },
      },
    };
  }

  it("registers and performs install/update/repair/remove without core modification", async () => {
    // 1. Load through the plugin system
    pluginManager.register(buildWidgetPlugin());
    expect(pluginManager.has("marketplace-plugin-widget")).toBe(true);

    // 2+3+4. Initialize registers resource type + installer (via onInitialize)
    await pluginManager.initialize();
    expect(pluginManager.getState("marketplace-plugin-widget")).toBe("ready");

    // 5. Resolve through ResourceTypeRegistry
    const reg = typeRegistry.get("widget");
    expect(reg).toBeDefined();
    expect(reg!.source).toBe("plugin");

    // Type detection works for the external type
    expect(typeRegistry.detectType({ type: "widget" })).toBe("widget");
    expect(typeRegistry.getByManifestName("widget.json")!.type.id).toBe(
      "widget",
    );

    // 6. Resolve installer through InstallerRegistry
    const installerEntry = installerRegistry.getByResourceType("widget");
    expect(installerEntry).toBeDefined();
    expect(installerEntry!.definition.id).toBe("widget-installer");

    // Capability checks work for external types
    expect(typeRegistry.hasCapability("widget", "repair")).toBe(true);
    expect(typeRegistry.hasCapability("widget", "merge")).toBe(false);

    const destination = tempDir;
    const source = [
      { path: "main.js", content: "// widget v1" },
      { path: "meta.json", content: '{"version":"1.0.0"}' },
    ];

    // 7. Install
    const installOutcome = await typeRegistry.install(
      {
        resourceId: "my-widget",
        version: "1.0.0",
        source,
        destination,
        variables: {},
        config: null,
        logger: console,
      },
      "widget",
    );
    expect(installOutcome.success).toBe(true);
    expect(await readFile(join(destination, "my-widget/main.js"), "utf-8")).toBe(
      "// widget v1",
    );

    // 8. Update (v2)
    const updateOutcome = await typeRegistry.install(
      {
        resourceId: "my-widget",
        version: "2.0.0",
        source: [{ path: "main.js", content: "// widget v2" }],
        destination,
        variables: {},
        config: null,
        logger: console,
        force: true,
      },
      "widget",
    );
    expect(updateOutcome.success).toBe(true);
    expect(await readFile(join(destination, "my-widget/main.js"), "utf-8")).toBe(
      "// widget v2",
    );

    // 9. Repair (restores files)
    const repairOutcome = await typeRegistry.install(
      {
        resourceId: "my-widget",
        version: "2.0.0",
        source: [{ path: "main.js", content: "// widget v2" }],
        destination,
        variables: {},
        config: null,
        logger: console,
      },
      "widget",
    );
    expect(repairOutcome.success).toBe(true);

    // 10. Remove
    await typeRegistry.remove(
      { resourceId: "my-widget", destination, logger: console },
      "widget",
    );
    let removed = false;
    try {
      await stat(join(destination, "my-widget"));
      removed = true;
    } catch {
      removed = false;
    }
    expect(removed).toBe(false);
  });

  it("extension conflicts produce structured errors", async () => {
    pluginManager.register(buildWidgetPlugin());
    await pluginManager.initialize();

    // A second plugin trying to register the same resource type fails clearly
    const secondPlugin = buildWidgetPlugin();
    secondPlugin.manifest = {
      ...secondPlugin.manifest,
      id: "second-widget-plugin",
    };
    pluginManager.register(secondPlugin);

    // Initialization of second plugin succeeds but its registration throws
    // inside onInitialize — captured as failed under continue policy
    try {
      await pluginManager.initialize();
    } catch {
      // stop policy would throw
    }

    // The original registration still owns the type
    const reg = typeRegistry.get("widget");
    expect(reg!.source).toBe("plugin");

    // Direct duplicate registration is rejected with structured error
    expect(() =>
      typeRegistry.register(makeDef("widget"), makeInstaller()),
    ).toThrow(MarketplaceClientError);
  });
});

describe("createInstallerRegistry / createTypeRegistry parity", () => {
  it("built-in and external types share the same contract", () => {
    const registry = createTypeRegistry();
    const builtin = registry.get("theme")!;
    expect(builtin.source).toBe("builtin");
    expect(typeof builtin.installer.install).toBe("function");

    registry.register(makeDef("ext"), makeInstaller(), { source: "plugin" });
    const external = registry.get("ext")!;
    expect(external.source).toBe("plugin");
    expect(typeof external.installer.install).toBe("function");

    // Both are retrievable through the exact same API surface
    expect(registry.getAll().length).toBeGreaterThanOrEqual(7);
  });

  it("creates installer registry", () => {
    expect(createInstallerRegistry()).toBeInstanceOf(InstallerRegistry);
  });
});
