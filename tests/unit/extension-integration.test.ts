import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus } from "../../src/events/index.js";
import {
  PluginManager,
  createFallbackPluginContext,
} from "../../src/plugins/index.js";
import {
  ResourceTypeRegistry,
  createTypeRegistry,
} from "../../src/resource-types/index.js";
import {
  InstallerRegistry,
  createInstallerRegistry,
} from "../../src/installer-registry/index.js";
import {
  createTransformStage,
  createMergeStage,
} from "../../src/pipeline/stages/index.js";
import { createTransformRegistry } from "../../src/transform/index.js";
import { Marketplace } from "../../src/marketplace/index.js";
import { sha256 } from "../../src/utils/index.js";
import type { Plugin } from "../../src/types/plugin.js";
import type {
  PipelineContext,
  PipelineFile,
} from "../../src/types/pipeline.js";
import type { MarketplaceEventData } from "../../src/types/events.js";

function makePlugin(id: string): Plugin {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      description: "",
      author: "",
      capabilities: [],
    },
    hooks: {},
  };
}

describe("Gap 1: extension observability events", () => {
  let events: EventBus;

  beforeEach(() => {
    events = new EventBus();
  });

  it("emits plugin lifecycle events through EventBus", async () => {
    const seen: string[] = [];
    events.on("pluginDiscovered", (d) => seen.push(`discovered:${d.pluginId}`));
    events.on("pluginLoaded", (d) => seen.push(`loaded:${d.pluginId}`));
    events.on("pluginInitialized", (d) =>
      seen.push(`initialized:${d.pluginId}`),
    );
    events.on("pluginDisposed", (d) => seen.push(`disposed:${d.pluginId}`));

    const pm = new PluginManager(undefined, { events });
    pm.register({
      manifest: {
        id: "evt-plugin",
        name: "evt-plugin",
        version: "1.0.0",
        description: "",
        author: "",
        capabilities: [],
      },
      hooks: {
        onInitialize: () => {},
        onDispose: () => {},
      },
    });

    await pm.initialize();
    await pm.dispose();

    expect(seen).toContain("discovered:evt-plugin");
    expect(seen).toContain("loaded:evt-plugin");
    expect(seen).toContain("initialized:evt-plugin");
    expect(seen).toContain("disposed:evt-plugin");
  });

  it("emits pluginFailed when initialization fails", async () => {
    const failures: Array<MarketplaceEventData["pluginFailed"]> = [];
    events.on("pluginFailed", (d) => failures.push(d));

    const pm = new PluginManager(undefined, { events });
    const bad = makePlugin("bad-plugin");
    (bad as { hooks: Record<string, unknown> }).hooks = {
      onInitialize: () => {
        throw new Error("boom");
      },
    };
    pm.register(bad);

    await pm.initialize();
    expect(failures).toHaveLength(1);
    expect(failures[0]!.pluginId).toBe("bad-plugin");
    expect(failures[0]!.phase).toBe("initialize");
  });

  it("emits resourceType and installer registration events", async () => {
    const typeEvents: string[] = [];
    const installerEvents: string[] = [];

    events.on("resourceTypeRegistered", (d) =>
      typeEvents.push(`${d.typeId}:${d.source}`),
    );
    events.on("resourceTypeUnregistered", (d) =>
      typeEvents.push(`unreg:${d.typeId}`),
    );
    events.on("installerRegistered", (d) =>
      installerEvents.push(d.installerId),
    );

    const registry = new ResourceTypeRegistry(undefined, events);
    expect(typeEvents.filter((t) => t.endsWith("builtin"))).toHaveLength(6);

    registry.register(
      {
        id: "ext-type",
        displayName: "Ext",
        description: "",
        icon: "",
        installer: "ext-installer",
        capabilities: ["install"],
        manifestNames: [],
        defaultDestination: ".",
        mergeStrategies: [],
      },
      {
        install: async () => ({
          success: true,
          filesWritten: [],
          duration: 0,
          errors: [],
        }),
      },
      { source: "plugin", pluginId: "p" },
    );
    expect(typeEvents).toContain("ext-type:plugin");

    registry.unregister("ext-type");
    expect(typeEvents).toContain("unreg:ext-type");

    const ir = new InstallerRegistry(undefined, events);
    ir.register(
      {
        id: "my-installer",
        name: "My",
        description: "",
        supportedResourceTypes: ["x"],
        priority: 0,
      },
      async () => ({
        success: true,
        filesWritten: [],
        duration: 0,
        errors: [],
      }),
    );
    expect(installerEvents).toContain("my-installer");
  });

  it("emits extensionConflict on duplicate registration", async () => {
    const conflicts: Array<MarketplaceEventData["extensionConflict"]> = [];
    events.on("extensionConflict", (d) => conflicts.push(d));

    const registry = new ResourceTypeRegistry(undefined, events);
    const def = {
      id: "plugin",
      displayName: "Plugin",
      description: "",
      icon: "",
      installer: "i",
      capabilities: ["install" as const],
      manifestNames: [],
      defaultDestination: ".",
      mergeStrategies: [],
    };

    expect(() =>
      registry.register(def, {
        install: async () => ({
          success: true,
          filesWritten: [],
          duration: 0,
          errors: [],
        }),
      }),
    ).toThrow();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("resource-type");
    expect(conflicts[0]!.id).toBe("plugin");
  });
});

describe("Gap 2: per-plugin configuration", () => {
  it("resolves plugin's own options before shared config", async () => {
    const pm = new PluginManager();
    pm.setPluginConfigs([
      { name: "configured", options: { apiKey: "secret-123", retries: 5 } },
    ]);

    const observed: Record<string, unknown> = {};
    const plugin = makePlugin("configured");
    (plugin as { hooks: Record<string, unknown> }).hooks = {
      onInitialize: (ctx) => {
        observed.apiKey = ctx.config.get<string>("apiKey");
        observed.retries = ctx.config.get<number>("retries");
        observed.missing = ctx.config.get("missing");
        observed.hasApiKey = ctx.config.has("apiKey");
        observed.hasMissing = ctx.config.has("missing");
      },
    };
    pm.register(plugin);

    await pm.initialize();
    expect(observed.apiKey).toBe("secret-123");
    expect(observed.retries).toBe(5);
    expect(observed.missing).toBeUndefined();
    expect(observed.hasApiKey).toBe(true);
    expect(observed.hasMissing).toBe(false);
  });

  it("unconfigured plugins get no own options", async () => {
    const pm = new PluginManager();
    pm.setPluginConfigs([{ name: "other", options: { x: 1 } }]);

    const observed: Record<string, unknown> = {};
    const plugin = makePlugin("unconfigured");
    (plugin as { hooks: Record<string, unknown> }).hooks = {
      onInitialize: (ctx) => {
        observed.x = ctx.config.get("x");
      },
    };
    pm.register(plugin);

    await pm.initialize();
    expect(observed.x).toBeUndefined();
  });

  it("matches config by plugin name as well as id", async () => {
    const pm = new PluginManager();
    pm.setPluginConfigs([{ name: "Display Name", options: { level: 10 } }]);

    const observed: Record<string, unknown> = {};
    const plugin: Plugin = {
      manifest: {
        id: "by-name",
        name: "Display Name",
        version: "1.0.0",
        description: "",
        author: "",
        capabilities: [],
      },
      hooks: {
        onInitialize: (ctx) => {
          observed.level = ctx.config.get<number>("level");
        },
      },
    };
    pm.register(plugin);

    await pm.initialize();
    expect(observed.level).toBe(10);
  });
});

describe("Gap 3: resource-type version compatibility", () => {
  function makeDef(marketplaceVersion?: string) {
    return {
      id: "compat-type",
      displayName: "Compat",
      description: "",
      icon: "",
      installer: "i",
      capabilities: ["install" as const],
      manifestNames: [],
      defaultDestination: ".",
      mergeStrategies: [],
      ...(marketplaceVersion !== undefined ? { marketplaceVersion } : {}),
    };
  }

  const installer = {
    install: async () => ({
      success: true,
      filesWritten: [],
      duration: 0,
      errors: [],
    }),
  };

  it("accepts compatible resource types", () => {
    const registry = createTypeRegistry();
    registry.register(makeDef(">=1.0.0 <2.0.0"), installer);
    expect(registry.has("compat-type")).toBe(true);
  });

  it("rejects incompatible resource types with structured error", () => {
    const registry = createTypeRegistry();
    expect(() => registry.register(makeDef(">=99.0.0"), installer)).toThrow(
      /requires marketplace >=99\.0\.0/,
    );
    expect(registry.has("compat-type")).toBe(false);
  });

  it("registers without compat requirement", () => {
    const registry = createTypeRegistry();
    registry.register(makeDef(), installer);
    expect(registry.has("compat-type")).toBe(true);
  });
});

describe("Gap 4: per-type transforms and merge strategies in pipeline", () => {
  function makeContext(
    files: Array<PipelineFile>,
    resourceType?: string,
  ): PipelineContext & { resourceType?: string } {
    return {
      resourceId: "r1",
      version: "1.0.0",
      destination: "/tmp",
      variables: {},
      options: {
        force: false,
        dryRun: false,
        skipDependencies: false,
        skipTransforms: false,
        skipMerge: false,
        skipValidation: false,
        concurrency: 4,
      },
      manifest: null,
      resourceType,
      files,
      snapshot: null,
      errors: [],
      warnings: [],
      metadata: {
        startTime: Date.now(),
        stagesCompleted: [],
        filesProcessed: 0,
        bytesWritten: 0,
      },
    };
  }

  function makeFile(overrides: Partial<PipelineFile> = {}): PipelineFile {
    const content = overrides.content ?? "hello";
    return {
      sourcePath: "/src/hello.txt",
      relativePath: "hello.txt",
      content,
      sha: sha256(content),
      size: content.length,
      action: "create",
      ...overrides,
    };
  }

  it("applies only the transforms declared by the resource type", async () => {
    const transforms = createTransformRegistry();
    transforms.register({
      name: "upper",
      description: "Uppercase",
      target: "content",
      order: 10,
      transform: async (input) => ({
        ...input,
        content: input.content.toUpperCase(),
      }),
    });
    transforms.register({
      name: "unused",
      description: "Not declared",
      target: "content",
      order: 20,
      transform: async (input) => ({
        ...input,
        content: input.content + "-UNUSED",
      }),
    });

    const types = createTypeRegistry();
    types.register(
      {
        id: "loud",
        displayName: "Loud",
        description: "",
        icon: "",
        installer: "i",
        capabilities: ["transform"],
        manifestNames: [],
        defaultDestination: ".",
        mergeStrategies: [],
        transformNames: ["upper"],
      },
      {
        install: async () => ({
          success: true,
          filesWritten: [],
          duration: 0,
          errors: [],
        }),
      },
    );

    const stage = createTransformStage(undefined, {
      transformRegistry: transforms,
      typeRegistry: types,
    });

    const result = await stage.execute(makeContext([makeFile()], "loud"));
    expect(result.files[0]!.content).toBe("HELLO");
    expect(result.files[0]!.content).not.toContain("UNUSED");
    expect(result.files[0]!.sha).toBe(sha256("HELLO"));
  });

  it("is a no-op for types that declare no transforms", async () => {
    const types = createTypeRegistry();
    const stage = createTransformStage(undefined, {
      transformRegistry: createTransformRegistry(),
      typeRegistry: types,
    });

    const ctx = makeContext([makeFile({ content: "keep" })], "theme");
    const result = await stage.execute(ctx);
    expect(result.files[0]!.content).toBe("keep");
  });

  it("keeps merge actions untouched when the type declares no strategies", async () => {
    const types = createTypeRegistry();
    // Built-in "theme" declares mergeStrategies: [] — meaning no per-type
    // restriction; legacy behavior applies (strategy handled downstream).
    const stage = createMergeStage(undefined, { typeRegistry: types });

    const ctx = makeContext(
      [makeFile({ action: "merge", mergeStrategy: "append" })],
      "theme",
    );
    const result = await stage.execute(ctx);
    expect(result.files[0]!.action).toBe("merge");
  });

  it("enforces declared strategies and falls back for undeclared ones", async () => {
    const types = createTypeRegistry();
    types.register(
      {
        id: "mergy",
        displayName: "Mergy",
        description: "",
        icon: "",
        installer: "i",
        capabilities: ["merge"],
        manifestNames: [],
        defaultDestination: ".",
        mergeStrategies: ["append", "prepend"],
      },
      {
        install: async () => ({
          success: true,
          filesWritten: [],
          duration: 0,
          errors: [],
        }),
      },
    );

    const stage = createMergeStage(undefined, { typeRegistry: types });
    const ctx = makeContext(
      [
        makeFile({ action: "merge", mergeStrategy: "append" }),
        makeFile({
          relativePath: "b.txt",
          action: "merge",
          mergeStrategy: "patch",
        }),
      ],
      "mergy",
    );
    const result = await stage.execute(ctx);

    // "append" IS declared by mergy → left intact for downstream handling
    expect(result.files[0]!.action).toBe("merge");
    // "patch" is NOT declared → falls back to safe overwrite
    expect(result.files[1]!.action).toBe("overwrite");
  });

  it(
    "works end-to-end via Marketplace getTypeRegistry accessors",
    { timeout: 20000 },
    async () => {
      const m = new Marketplace();
      expect(m.getTypeRegistry()).not.toBeNull();
      expect(m.getInstallerRegistry()).not.toBeNull();
    },
  );
});
