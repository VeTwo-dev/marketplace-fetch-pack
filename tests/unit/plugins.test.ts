import { describe, it, expect, vi } from "vitest";
import {
  PluginManager,
  createPlugin,
  createFallbackPluginContext,
} from "../../src/plugins/index.js";
import type { Plugin, PluginManifest, PluginHooks } from "../../src/types/plugin.js";
import type { SearchQuery, SearchResult } from "../../src/types/search.js";
import type { InstallOptions, InstallResult } from "../../src/types/install.js";
import type { DownloadOptions, DownloadResult } from "../../src/types/download.js";
import type { Registry } from "../../src/types/registry.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

function makePlugin(name: string, hooks: PluginHooks = {}): Plugin {
  return {
    manifest: {
      id: name,
      name,
      version: "1.0.0",
      description: `Test plugin ${name}`,
      author: "test",
      capabilities: [],
    },
    hooks,
  };
}

describe("PluginManager", () => {
  describe("register()", () => {
    it("registers a plugin", () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1"));
      expect(pm.list()).toHaveLength(1);
      expect(pm.list()[0]!.name).toBe("p1");
    });

    it("rejects duplicate plugin id", () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1"));
      expect(() => pm.register(makePlugin("p1"))).toThrow(MarketplaceClientError);
    });

    it("rejects manifest without id", () => {
      const pm = new PluginManager();
      const bad = makePlugin("");
      expect(() => pm.register(bad)).toThrow(MarketplaceClientError);
    });
  });

  describe("unregister()", () => {
    it("removes a plugin by id", () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1"));
      expect(pm.unregister("p1")).toBe(true);
      expect(pm.list()).toHaveLength(0);
    });

    it("returns false for unknown id", () => {
      const pm = new PluginManager();
      expect(pm.unregister("unknown")).toBe(false);
    });
  });

  describe("enable/disable()", () => {
    it("disables and enables a plugin", () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1"));
      expect(pm.disable("p1")).toBe(true);
      expect(pm.getEnabled()).toHaveLength(0);
      expect(pm.enable("p1")).toBe(true);
      expect(pm.getEnabled()).toHaveLength(1);
    });

    it("returns false for unknown plugin", () => {
      const pm = new PluginManager();
      expect(pm.disable("unknown")).toBe(false);
      expect(pm.enable("unknown")).toBe(false);
    });
  });

  describe("list()/has()/getState()", () => {
    it("returns manifests for all plugins", () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1"));
      pm.register(makePlugin("p2"));
      const list = pm.list();
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.id)).toEqual(["p1", "p2"]);
    });

    it("reports has() and state", () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1"));
      expect(pm.has("p1")).toBe(true);
      expect(pm.has("nope")).toBe(false);
      expect(pm.getState("p1")).toBe("discovered");
    });
  });

  describe("getByCapability()", () => {
    it("filters by capability and enabled state", () => {
      const pm = new PluginManager();
      pm.register({
        manifest: {
          id: "cap1",
          name: "cap1",
          version: "1.0.0",
          description: "",
          author: "",
          capabilities: ["search"],
        },
        hooks: {},
      });
      pm.register({
        manifest: {
          id: "cap2",
          name: "cap2",
          version: "1.0.0",
          description: "",
          author: "",
          capabilities: ["search", "installer"],
        },
        hooks: {},
      });
      pm.disable("cap2");

      const searchPlugins = pm.getByCapability("search");
      expect(searchPlugins.map((p) => p.manifest.id)).toEqual(["cap1"]);
      expect(pm.getByCapability("installer")).toHaveLength(0);
      expect(pm.getCapabilities("cap2")).toEqual(["search", "installer"]);
    });
  });

  describe("initialize()", () => {
    it("initializes plugins and marks ready", async () => {
      const pm = new PluginManager();
      const init = vi.fn();
      pm.register(makePlugin("p1", { onInitialize: init }));
      await pm.initialize();
      expect(init).toHaveBeenCalledOnce();
      expect(pm.getState("p1")).toBe("ready");
    });

    it("initializes dependencies before dependents", async () => {
      const pm = new PluginManager();
      const order: string[] = [];
      pm.register({
        manifest: {
          id: "dependent",
          name: "dependent",
          version: "1.0.0",
          description: "",
          author: "",
          capabilities: [],
          dependencies: [{ id: "base" }],
        },
        hooks: {
          onInitialize: () => {
            order.push("dependent");
          },
        },
      });
      pm.register({
        manifest: {
          id: "base",
          name: "base",
          version: "1.0.0",
          description: "",
          author: "",
          capabilities: [],
        },
        hooks: {
          onInitialize: () => {
            order.push("base");
          },
        },
      });

      await pm.initialize();
      expect(order).toEqual(["base", "dependent"]);
    });

    it("detects circular dependencies", async () => {
      const pm = new PluginManager();
      pm.register(makePluginWithDep("a", "b"));
      pm.register(makePluginWithDep("b", "a"));
      await expect(pm.initialize()).rejects.toThrow(MarketplaceClientError);
    });

    it("fails when dependency is missing", async () => {
      const pm = new PluginManager();
      pm.register(makePluginWithDep("a", "missing"));
      await expect(pm.initialize()).rejects.toThrow(MarketplaceClientError);
    });

    it("continues on failure with continue policy", async () => {
      const pm = new PluginManager();
      pm.register(makePlugin("bad", {
        onInitialize: () => {
          throw new Error("boom");
        },
      }));
      pm.register(makePlugin("good"));
      await pm.initialize();
      expect(pm.getState("bad")).toBe("failed");
      expect(pm.getState("good")).toBe("ready");
    });

    it("throws on failure with stop policy", async () => {
      const pm = new PluginManager();
      pm.register(makePlugin("bad", {
        onInitialize: () => {
          throw new Error("boom");
        },
      }), { failurePolicy: "stop" });
      await expect(pm.initialize()).rejects.toThrow(MarketplaceClientError);
      expect(pm.getState("bad")).toBe("failed");
    });

    it("skips disabled plugins during initialization", async () => {
      const pm = new PluginManager();
      const init = vi.fn();
      pm.register(makePlugin("p1", { onInitialize: init }), { enabled: false });
      await pm.initialize();
      expect(init).not.toHaveBeenCalled();
      expect(pm.getState("p1")).toBe("discovered");
    });
  });

  describe("dispose()", () => {
    it("calls onDispose and unregisters hooks", async () => {
      const pm = new PluginManager();
      const dispose = vi.fn();
      pm.register(makePlugin("p1", { onDispose: dispose, search: (_q, r) => r }));
      await pm.initialize();
      expect(pm.hookSystem.has("search")).toBe(true);
      await pm.dispose();
      expect(dispose).toHaveBeenCalledOnce();
      expect(pm.getState("p1")).toBe("disposed");
      expect(pm.hookSystem.has("search")).toBe(false);
    });

    it("does not dispose uninitialized plugins", async () => {
      const pm = new PluginManager();
      const dispose = vi.fn();
      pm.register(makePlugin("p1", { onDispose: dispose }));
      await pm.dispose();
      expect(dispose).not.toHaveBeenCalled();
    });
  });

  describe("executeSearchHook()", () => {
    it("runs search hook on enabled plugin", async () => {
      const pm = new PluginManager();
      const hook = vi.fn((_q: SearchQuery, r: SearchResult) => ({
        ...r,
        total: 99,
      }));
      pm.register(makePlugin("p1", { search: hook }));

      const query: SearchQuery = { keyword: "test" };
      const result: SearchResult = { items: [], total: 0, query, duration: 0 };
      const output = await pm.executeSearchHook(query, result);
      expect(hook).toHaveBeenCalledOnce();
      expect(output.total).toBe(99);
    });

    it("skips disabled plugin hooks", async () => {
      const pm = new PluginManager();
      const hook = vi.fn();
      pm.register(makePlugin("p1", { search: hook }));
      pm.disable("p1");

      const query: SearchQuery = { keyword: "test" };
      const result: SearchResult = { items: [], total: 0, query, duration: 0 };
      await pm.executeSearchHook(query, result);
      expect(hook).not.toHaveBeenCalled();
    });

    it("throws PLUGIN_HOOK_ERROR on hook failure", async () => {
      const pm = new PluginManager();
      pm.register(
        makePlugin("p1", {
          search: () => {
            throw new Error("boom");
          },
        }),
      );

      const query: SearchQuery = {};
      const result: SearchResult = { items: [], total: 0, query, duration: 0 };
      await expect(pm.executeSearchHook(query, result)).rejects.toThrow(
        MarketplaceClientError,
      );
    });

    it("chains multiple plugin hooks in registration order", async () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1", {
        search: (_q, r) => ({ ...r, total: r.total + 1 }),
      }));
      pm.register(makePlugin("p2", {
        search: (_q, r) => ({ ...r, total: r.total + 10 }),
      }));

      const query: SearchQuery = {};
      const result: SearchResult = { items: [], total: 0, query, duration: 0 };
      const output = await pm.executeSearchHook(query, result);
      expect(output.total).toBe(11);
    });

    it("returns input unchanged when no hooks registered", async () => {
      const pm = new PluginManager();
      const query: SearchQuery = {};
      const result: SearchResult = { items: [], total: 7, query, duration: 3 };
      const output = await pm.executeSearchHook(query, result);
      expect(output).toBe(result);
    });
  });

  describe("executeInstallHook()", () => {
    it("runs install hook", async () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1", {
        install: (_o, r) => ({ ...r, success: true }),
      }));

      const opts: InstallOptions = { id: "test" };
      const result: InstallResult = makeInstallResult(false);
      const output = await pm.executeInstallHook(opts, result);
      expect(output.success).toBe(true);
    });
  });

  describe("executeDownloadHook()", () => {
    it("runs download hook", async () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1", {
        download: (_o, r) => ({ ...r, cached: true }),
      }));

      const opts: DownloadOptions = { url: "https://example.com", destination: "/tmp" };
      const result: DownloadResult = {
        success: true, files: [], totalSize: 0, duration: 0, cached: false,
      };
      const output = await pm.executeDownloadHook(opts, result);
      expect(output.cached).toBe(true);
    });
  });

  describe("executeRegistryHook()", () => {
    it("runs registry hook", async () => {
      const pm = new PluginManager();
      pm.register(makePlugin("p1", {
        registry: (r: Registry) => ({ ...r, version: "2.0.0" }),
      }));

      const registry: Registry = makeRegistry();
      const output = await pm.executeRegistryHook(registry);
      expect(output.version).toBe("2.0.0");
    });
  });

  describe("multiple plugins interacting simultaneously", () => {
    it("chains across different hook types", async () => {
      const pm = new PluginManager();
      pm.register(makePlugin("searcher", {
        search: (_q, r) => ({ ...r, total: r.total + 5 }),
      }));
      pm.register(makePlugin("downloader", {
        download: (_o, r) => ({ ...r, cached: true }),
      }));

      const query: SearchQuery = {};
      const searchOut = await pm.executeSearchHook(query, {
        items: [], total: 0, query, duration: 0,
      });
      expect(searchOut.total).toBe(5);

      const downloadOut = await pm.executeDownloadHook(
        { url: "u", destination: "d" },
        { success: true, files: [], totalSize: 0, duration: 0, cached: false },
      );
      expect(downloadOut.cached).toBe(true);
    });
  });
});

describe("createPlugin", () => {
  it("creates a plugin from manifest and hooks", () => {
    const manifest: PluginManifest = {
      id: "test", name: "test", version: "1.0.0", description: "d", author: "a",
      capabilities: [],
    };
    const hooks: PluginHooks = {};
    const plugin = createPlugin(manifest, hooks);
    expect(plugin.manifest).toBe(manifest);
    expect(plugin.hooks).toBe(hooks);
  });
});

describe("createFallbackPluginContext", () => {
  it("creates a no-op context", () => {
    const ctx = createFallbackPluginContext("x");
    expect(ctx.pluginId).toBe("x");
    expect(ctx.config.get("anything")).toBeUndefined();
    expect(ctx.config.has("anything")).toBe(false);
    expect(ctx.state.get("k")).toBeUndefined();
  });
});

function makePluginWithDep(id: string, depId: string): Plugin {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      description: "",
      author: "",
      capabilities: [],
      dependencies: [{ id: depId }],
    },
    hooks: {},
  };
}

function makeInstallResult(success: boolean): InstallResult {
  return {
    success,
    id: "",
    version: "",
    destination: "",
    filesInstalled: 0,
    dependenciesInstalled: 0,
    duration: 0,
    report: {
      id: "", version: "", installedAt: "", files: [], dependencies: [],
      warnings: [],
      integrity: { verified: false, filesChecked: 0, filesMatched: 0, mismatches: [] },
    },
    dryRun: false,
  };
}

function makeRegistry(): Registry {
  return {
    version: "1.0.0",
    generatedAt: "",
    repository: "",
    categories: [],
    resources: [],
    metadata: { totalCount: 0, categoriesCount: 0, lastUpdated: "" },
  };
}
