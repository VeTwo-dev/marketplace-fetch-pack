import { describe, it, expect } from "vitest";
import {
  wizardReducer,
  INITIAL_WIZARD_DATA,
  filterByCategory,
  filterByQuery,
  DEFAULT_INSTALL_CONFIG,
} from "../../src/cli/tui/state.js";
import type { WizardData, WizardAction } from "../../src/cli/tui/state.js";
import type { RegistryResource, RegistryCategory } from "../../src/types/registry.js";

function makeResource(overrides: Partial<RegistryResource> = {}): RegistryResource {
  return {
    id: overrides.id ?? "test-resource",
    name: overrides.name ?? "test-resource",
    displayName: overrides.displayName ?? "Test Resource",
    description: overrides.description ?? "A test resource",
    version: overrides.version ?? "1.0.0",
    category: overrides.category ?? "plugins",
    tags: overrides.tags ?? ["test"],
    author: overrides.author ?? { name: "Test Author" },
    manifestPath: overrides.manifestPath ?? "vetwo.json",
    manifestHash: overrides.manifestHash ?? "abc123",
    dependencies: overrides.dependencies ?? [],
    compatibility: overrides.compatibility,
    repository: overrides.repository,
    homepage: overrides.homepage,
    license: overrides.license ?? "MIT",
    keywords: overrides.keywords ?? [],
  };
}

function makeCategory(overrides: Partial<RegistryCategory> = {}): RegistryCategory {
  return {
    id: overrides.id ?? "plugins",
    name: overrides.name ?? "Plugins",
    description: overrides.description ?? "Plugin resources",
    resourceCount: overrides.resourceCount ?? 10,
  };
}

describe("wizardReducer", () => {
  describe("SET_PROJECT", () => {
    it("sets project", () => {
      const project = {
        rootPath: "/home/user/project",
        frameworks: [{ type: "react" as const, confidence: 0.9 }],
        packageManager: "npm" as const,
        runtime: "node" as const,
        bundler: "vite" as const,
        styling: "tailwind" as const,
        testing: "vitest" as const,
        typescript: true,
        eslint: true,
        prettier: false,
      };
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_PROJECT", project });
      expect(next.detectedProject?.rootPath).toBe("/home/user/project");
    });

    it("returns same reference when unchanged", () => {
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_PROJECT", project: null });
      expect(next).toBe(INITIAL_WIZARD_DATA);
    });
  });

  describe("SET_CATEGORIES", () => {
    it("replaces categories", () => {
      const cats = [makeCategory({ id: "x" })];
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_CATEGORIES", categories: cats });
      expect(next.categories).toHaveLength(1);
      expect(next.categories[0]?.id).toBe("x");
    });
  });

  describe("SET_RESOURCES", () => {
    it("replaces resources", () => {
      const res = [makeResource({ id: "r1" })];
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_RESOURCES", resources: res });
      expect(next.resources).toHaveLength(1);
    });
  });

  describe("BATCH_SET_DATA", () => {
    it("sets all at once", () => {
      const cats = [makeCategory({ id: "a" })];
      const res = [makeResource({ id: "r1" })];
      const project = {
        rootPath: "/test",
        frameworks: [],
        packageManager: "npm" as const,
        runtime: "node" as const,
        bundler: "unknown" as const,
        styling: "unknown" as const,
        testing: "unknown" as const,
        typescript: false,
        eslint: false,
        prettier: false,
      };
      const next = wizardReducer(INITIAL_WIZARD_DATA, {
        type: "BATCH_SET_DATA",
        categories: cats,
        resources: res,
        project,
      });
      expect(next.categories).toBe(cats);
      expect(next.resources).toBe(res);
      expect(next.detectedProject?.rootPath).toBe("/test");
      expect(next.registryStatus).toBe("ready");
    });
  });

  describe("SELECT_CATEGORY", () => {
    it("sets category", () => {
      const cat = makeCategory({ id: "plugins" });
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SELECT_CATEGORY", category: cat });
      expect(next.selectedCategory?.id).toBe("plugins");
    });

    it("clears category", () => {
      const state = { ...INITIAL_WIZARD_DATA, selectedCategory: makeCategory() };
      const next = wizardReducer(state, { type: "SELECT_CATEGORY", category: null });
      expect(next.selectedCategory).toBeNull();
    });

    it("returns same reference when unchanged", () => {
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SELECT_CATEGORY", category: null });
      expect(next).toBe(INITIAL_WIZARD_DATA);
    });
  });

  describe("SELECT_RESOURCE", () => {
    it("sets resource", () => {
      const res = makeResource({ id: "x" });
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SELECT_RESOURCE", resource: res });
      expect(next.selectedResource?.id).toBe("x");
    });

    it("clears resource", () => {
      const state = { ...INITIAL_WIZARD_DATA, selectedResource: makeResource() };
      const next = wizardReducer(state, { type: "SELECT_RESOURCE", resource: null });
      expect(next.selectedResource).toBeNull();
    });

    it("returns same reference when unchanged", () => {
      const res = makeResource({ id: "x" });
      const state = { ...INITIAL_WIZARD_DATA, selectedResource: res };
      const next = wizardReducer(state, { type: "SELECT_RESOURCE", resource: res });
      expect(next).toBe(state);
    });
  });

  describe("SET_SEARCH_QUERY", () => {
    it("updates query", () => {
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_SEARCH_QUERY", query: "react" });
      expect(next.searchQuery).toBe("react");
    });

    it("returns same reference when unchanged", () => {
      const state = { ...INITIAL_WIZARD_DATA, searchQuery: "test" };
      const next = wizardReducer(state, { type: "SET_SEARCH_QUERY", query: "test" });
      expect(next).toBe(state);
    });
  });

  describe("SET_SEARCH_RESULTS", () => {
    it("sets results", () => {
      const res = [makeResource()];
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_SEARCH_RESULTS", results: res });
      expect(next.searchResults).toHaveLength(1);
    });
  });

  describe("SET_INSTALL_CONFIG", () => {
    it("updates config field", () => {
      const next = wizardReducer(INITIAL_WIZARD_DATA, {
        type: "SET_INSTALL_CONFIG",
        config: { overwrite: true },
      });
      expect(next.installConfig.overwrite).toBe(true);
      expect(next.installConfig.destination).toBe(DEFAULT_INSTALL_CONFIG.destination);
    });

    it("updates multiple fields", () => {
      const next = wizardReducer(INITIAL_WIZARD_DATA, {
        type: "SET_INSTALL_CONFIG",
        config: { overwrite: true, dryRun: true },
      });
      expect(next.installConfig.overwrite).toBe(true);
      expect(next.installConfig.dryRun).toBe(true);
    });
  });

  describe("SET_INSTALL_RESULT", () => {
    it("sets result", () => {
      const result = {
        success: true,
        message: "Installed",
        filesInstalled: 10,
        dependenciesInstalled: 3,
        duration: 1500,
      };
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_INSTALL_RESULT", result });
      expect(next.installResult?.success).toBe(true);
    });

    it("clears result", () => {
      const state = {
        ...INITIAL_WIZARD_DATA,
        installResult: { success: true, message: "", filesInstalled: 0, dependenciesInstalled: 0, duration: 0 },
      };
      const next = wizardReducer(state, { type: "SET_INSTALL_RESULT", result: null });
      expect(next.installResult).toBeNull();
    });
  });

  describe("SET_REGISTRY_STATUS", () => {
    it("updates status", () => {
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_REGISTRY_STATUS", status: "ready" });
      expect(next.registryStatus).toBe("ready");
    });

    it("returns same reference when unchanged", () => {
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_REGISTRY_STATUS", status: "loading" });
      expect(next).toBe(INITIAL_WIZARD_DATA);
    });
  });

  describe("SET_DOCTOR_REPORT", () => {
    it("sets report", () => {
      const report = {
        system: [{ name: "OS", status: "pass" as const, message: "Linux" }],
        github: [],
        cache: [],
        node: [],
        registry: [],
        network: [],
      };
      const next = wizardReducer(INITIAL_WIZARD_DATA, { type: "SET_DOCTOR_REPORT", report });
      expect(next.doctorReport).toBe(report);
    });
  });

  describe("RESET_INSTALL", () => {
    it("resets install config and result", () => {
      const state: WizardData = {
        ...INITIAL_WIZARD_DATA,
        installConfig: { destination: "/custom", overwrite: true, optionalDeps: false, dryRun: true },
        installResult: { success: true, message: "ok", filesInstalled: 5, dependenciesInstalled: 2, duration: 1000 },
      };
      const next = wizardReducer(state, { type: "RESET_INSTALL" });
      expect(next.installConfig).toEqual(DEFAULT_INSTALL_CONFIG);
      expect(next.installResult).toBeNull();
    });
  });

  describe("initial state", () => {
    it("has correct defaults", () => {
      expect(INITIAL_WIZARD_DATA.detectedProject).toBeNull();
      expect(INITIAL_WIZARD_DATA.categories).toHaveLength(0);
      expect(INITIAL_WIZARD_DATA.resources).toHaveLength(0);
      expect(INITIAL_WIZARD_DATA.selectedCategory).toBeNull();
      expect(INITIAL_WIZARD_DATA.selectedResource).toBeNull();
      expect(INITIAL_WIZARD_DATA.searchQuery).toBe("");
      expect(INITIAL_WIZARD_DATA.searchResults).toHaveLength(0);
      expect(INITIAL_WIZARD_DATA.installConfig).toEqual(DEFAULT_INSTALL_CONFIG);
      expect(INITIAL_WIZARD_DATA.installResult).toBeNull();
      expect(INITIAL_WIZARD_DATA.registryStatus).toBe("loading");
      expect(INITIAL_WIZARD_DATA.doctorReport).toBeNull();
    });
  });
});

describe("filterByCategory", () => {
  const resources = [
    makeResource({ id: "a", category: "plugins" }),
    makeResource({ id: "b", category: "themes" }),
    makeResource({ id: "c", category: "plugins" }),
  ];

  it("filters by category", () => {
    expect(filterByCategory(resources, "plugins")).toHaveLength(2);
  });

  it("returns empty for no match", () => {
    expect(filterByCategory(resources, "nonexistent")).toHaveLength(0);
  });

  it("returns empty for empty input", () => {
    expect(filterByCategory([], "plugins")).toHaveLength(0);
  });
});

describe("filterByQuery", () => {
  const resources = [
    makeResource({ id: "react-router", description: "React routing", tags: ["router"] }),
    makeResource({ id: "vue-utils", description: "Vue utilities", tags: ["vue"] }),
    makeResource({ id: "react-hooks", description: "React hooks", tags: ["react"] }),
  ];

  it("returns all when empty query", () => {
    expect(filterByQuery(resources, "")).toHaveLength(3);
  });

  it("returns same reference when empty query", () => {
    expect(filterByQuery(resources, "")).toBe(resources);
  });

  it("filters by name", () => {
    const result = filterByQuery(resources, "react");
    expect(result).toHaveLength(2);
  });

  it("filters by description", () => {
    const result = filterByQuery(resources, "routing");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("react-router");
  });

  it("filters by tags", () => {
    const result = filterByQuery(resources, "vue");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("vue-utils");
  });

  it("is case-insensitive", () => {
    const result = filterByQuery(resources, "REACT");
    expect(result).toHaveLength(2);
  });

  it("returns empty for no match", () => {
    expect(filterByQuery(resources, "nonexistent")).toHaveLength(0);
  });
});

describe("stress: wizard reducer idempotency", () => {
  it("1000 SET_SEARCH_QUERY cycles stay bounded", () => {
    let state = INITIAL_WIZARD_DATA;
    for (let i = 0; i < 1000; i++) {
      state = wizardReducer(state, { type: "SET_SEARCH_QUERY", query: `query-${i}` });
    }
    expect(state.searchQuery).toBe("query-999");
  });

  it("rapid SELECT_CATEGORY does not leak", () => {
    let state = INITIAL_WIZARD_DATA;
    const cats = [makeCategory({ id: "a" }), makeCategory({ id: "b" })];
    for (let i = 0; i < 500; i++) {
      state = wizardReducer(state, { type: "SELECT_CATEGORY", category: cats[i % 2]! });
    }
    expect(state.selectedCategory).toBeDefined();
  });

  it("rapid SET_INSTALL_CONFIG accumulates correctly", () => {
    let state = INITIAL_WIZARD_DATA;
    for (let i = 0; i < 100; i++) {
      state = wizardReducer(state, { type: "SET_INSTALL_CONFIG", config: { overwrite: i % 2 === 0 } });
    }
    expect(state.installConfig.overwrite).toBe(false);
  });

  it("RESET_INSTALL always returns clean state", () => {
    let state = INITIAL_WIZARD_DATA;
    for (let i = 0; i < 100; i++) {
      state = wizardReducer(state, { type: "SET_INSTALL_CONFIG", config: { dryRun: true } });
      state = wizardReducer(state, { type: "RESET_INSTALL" });
    }
    expect(state.installConfig).toEqual(DEFAULT_INSTALL_CONFIG);
    expect(state.installResult).toBeNull();
  });
});
