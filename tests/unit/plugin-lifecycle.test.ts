import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PluginManager,
  createFallbackPluginContext,
} from "../../src/plugins/index.js";
import {
  PluginDiscovery,
  isPluginShape,
} from "../../src/plugins/discovery.js";
import { PluginStateStore } from "../../src/plugins/state-store.js";
import type { Plugin, PluginManifest, PluginHooks } from "../../src/types/plugin.js";
import type { SearchQuery, SearchResult } from "../../src/types/search.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

function makePlugin(
  id: string,
  hooks: PluginHooks = {},
  overrides: Partial<PluginManifest> = {},
): Plugin {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      description: `Plugin ${id}`,
      author: "test",
      capabilities: [],
      ...overrides,
    },
    hooks,
  };
}

describe("Plugin version compatibility", () => {
  it("accepts plugin compatible with current marketplace", () => {
    const pm = new PluginManager();
    pm.register(makePlugin("p1", {}, { marketplaceVersion: ">=1.0.0 <2.0.0" }));
    expect(pm.has("p1")).toBe(true);
  });

  it("rejects plugin requiring newer marketplace", () => {
    const pm = new PluginManager();
    expect(() =>
      pm.register(makePlugin("p2", {}, { marketplaceVersion: ">=99.0.0" })),
    ).toThrow(MarketplaceClientError);
    expect(pm.has("p2")).toBe(false);
  });

  it("rejects plugin with caret requirement on different major", () => {
    const pm = new PluginManager();
    expect(() =>
      pm.register(makePlugin("p3", {}, { marketplaceVersion: "^9.0.0" })),
    ).toThrow(MarketplaceClientError);
  });
});

describe("Plugin priority ordering", () => {
  it("initializes higher-priority plugins first (deps still first)", async () => {
    const pm = new PluginManager();
    const order: string[] = [];

    pm.register(makePlugin("low", {
      onInitialize: () => {
        order.push("low");
      },
    }), { priority: 0 });
    pm.register(makePlugin("high", {
      onInitialize: () => {
        order.push("high");
      },
    }), { priority: 10 });

    await pm.initialize();
    expect(order).toEqual(["high", "low"]);
  });

  it("dependency ordering wins over priority", async () => {
    const pm = new PluginManager();
    const order: string[] = [];

    pm.register(makePlugin("dependent", {
      onInitialize: () => {
        order.push("dependent");
      },
    }), { priority: 100 });
    pm.register(makePlugin("base", {
      onInitialize: () => {
        order.push("base");
      },
    }, {
      dependencies: undefined,
    }));

    // Make dependent depend on base
    pm.unregister("dependent");
    pm.register(makePlugin("dependent2", {
      onInitialize: () => {
        order.push("dependent2");
      },
    }, {
      dependencies: [{ id: "base" }],
    }), { priority: 100 });

    await pm.initialize();
    // base must come before dependent2 despite lower priority
    expect(order.indexOf("base")).toBeLessThan(order.indexOf("dependent2"));
  });
});

describe("Plugin state store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "plugin-state-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores state under namespaced plugin directory", async () => {
    const store = new PluginStateStore(join(tempDir, ".vetwo/marketplace/plugins"));
    store.save("my-plugin", { counter: 42 });
    await store.flush();

    const statePath = join(
      tempDir,
      ".vetwo/marketplace/plugins/my-plugin/state.json",
    );
    const content = JSON.parse(await readFile(statePath, "utf-8")) as Record<string, unknown>;
    expect(content.counter).toBe(42);
  });

  it("sanitizes plugin ids to prevent path traversal", async () => {
    const store = new PluginStateStore(tempDir);
    const dir = store.pluginDir("../../evil");
    expect(dir.startsWith(tempDir)).toBe(true);
    expect(dir).not.toContain("..");
  });

  it("loads persisted state back", async () => {
    const pluginsDir = join(tempDir, "plugins");
    await mkdir(join(pluginsDir, "persisted"), { recursive: true });
    await writeFile(
      join(pluginsDir, "persisted", "state.json"),
      JSON.stringify({ key: "value" }),
      "utf-8",
    );

    const store = new PluginStateStore(pluginsDir);
    const loaded = store.load("persisted");
    expect(loaded.key).toBe("value");
  });

  it("returns empty state for missing plugin", () => {
    const store = new PluginStateStore(tempDir);
    expect(store.load("nonexistent")).toEqual({});
  });

  it("integrates with PluginManager context", async () => {
    const pluginsDir = join(tempDir, "plugins");
    const pm = new PluginManager(undefined, { stateDir: pluginsDir });

    let observed: unknown;
    pm.register(makePlugin("stateful", {
      onInitialize: (ctx) => {
        ctx.state.set("initialized", true);
        ctx.state.set("count", 3);
        observed = ctx.state.get("count");
      },
    }));
    // Persistence to disk requires explicit filesystem-write permission
    // (Phase 17 permission enforcement).
    (pm.getEntry("stateful")!.plugin.manifest as { permissions?: string[] }).permissions = ["filesystem-write"];
    pm.unregister("stateful");
    pm.register({
      manifest: {
        id: "stateful",
        name: "stateful",
        version: "1.0.0",
        description: "",
        author: "",
        capabilities: [],
        permissions: ["filesystem-write"],
      },
      hooks: {
        onInitialize: (ctx) => {
          ctx.state.set("initialized", true);
          ctx.state.set("count", 3);
          observed = ctx.state.get("count");
        },
      },
    });

    await pm.initialize();
    expect(observed).toBe(3);

    const content = JSON.parse(
      await readFile(join(pluginsDir, "stateful", "state.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(content.initialized).toBe(true);
    expect(content.count).toBe(3);
  });
});

describe("isPluginShape validation", () => {
  it("accepts valid plugin shape", () => {
    expect(isPluginShape(makePlugin("valid"))).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isPluginShape(null)).toBe(false);
    expect(isPluginShape("string")).toBe(false);
    expect(isPluginShape(42)).toBe(false);
  });

  it("rejects missing manifest or hooks", () => {
    expect(isPluginShape({ hooks: {} })).toBe(false);
    expect(isPluginShape({ manifest: makePlugin("x").manifest })).toBe(false);
  });

  it("rejects invalid manifest fields", () => {
    const bad = makePlugin("bad");
    const broken = {
      manifest: { ...bad.manifest, id: "" },
      hooks: {},
    };
    expect(isPluginShape(broken)).toBe(false);

    const noCaps = {
      manifest: { ...bad.manifest, capabilities: undefined },
      hooks: {},
    };
    expect(isPluginShape(noCaps)).toBe(false);
  });
});

describe("PluginDiscovery", () => {
  let tempDir: string;
  let discovery: PluginDiscovery;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "plugin-discovery-test-"));
    discovery = new PluginDiscovery(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fails clearly for a module that does not exist", async () => {
    await expect(discovery.discoverOne("./does-not-exist.js")).rejects.toThrow(
      MarketplaceClientError,
    );
  });

  it("fails clearly for a module that is not a plugin", async () => {
    await writeFile(
      join(tempDir, "not-a-plugin.mjs"),
      "export default { hello: true };",
      "utf-8",
    );
    await expect(discovery.discoverOne("./not-a-plugin.mjs")).rejects.toThrow(
      MarketplaceClientError,
    );
  });

  it("discovers and validates a local file plugin", async () => {
    const searchHook = (q: SearchQuery, r: SearchResult) => ({
      ...r,
      total: r.total + 1,
    });
    const pluginCode = `
      export default {
        manifest: {
          id: "local-plugin",
          name: "local-plugin",
          version: "1.0.0",
          description: "Local test plugin",
          author: "test",
          capabilities: ["search"],
        },
        hooks: {
          search: (query, result) => ({ ...result, total: result.total + 1 }),
        },
      };
    `;
    await writeFile(join(tempDir, "local-plugin.mjs"), pluginCode, "utf-8");

    const { plugin, source } = await discovery.discoverOne("./local-plugin.mjs");
    expect(source).toBe("./local-plugin.mjs");
    expect(plugin.manifest.id).toBe("local-plugin");

    // Register into manager and run hook
    const pm = new PluginManager();
    pm.register(plugin);
    const query: SearchQuery = {};
    const out = await pm.executeSearchHook(query, {
      items: [],
      total: 0,
      query,
      duration: 0,
    });
    expect(out.total).toBe(1);
    void searchHook;
  });

  it("discoverAll skips broken entries but continues", async () => {
    await writeFile(
      join(tempDir, "good.mjs"),
      `export default {
        manifest: { id: "g", name: "g", version: "1.0.0", description: "", author: "", capabilities: [] },
        hooks: {},
      };`,
      "utf-8",
    );

    const found = await discovery.discoverAll([
      { name: "./missing.mjs" },
      { name: "./good.mjs" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.plugin.manifest.id).toBe("g");
  });
});

describe("createFallbackPluginContext", () => {
  it("provides isolated no-op accessors per plugin", () => {
    const ctx = createFallbackPluginContext("plugin-a");
    expect(ctx.pluginId).toBe("plugin-a");
    expect(() => ctx.logger.info("hello")).not.toThrow();
    expect(ctx.state.set("k", 1)).toBeUndefined();
    expect(() => ctx.events.emit("evt", {})).not.toThrow();
  });
});
