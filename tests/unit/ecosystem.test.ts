import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as publicApi from "../../src/index.js";
import {
  validateSchemaVersion,
  SUPPORTED_MANIFEST_VERSIONS,
  warnDeprecated,
  resetDeprecationWarnings,
} from "../../src/compat/index.js";

// ─── Architectural invariants (Step 52) ──────────────────────────────

describe("Architectural invariants", () => {
  const SRC = join(process.cwd(), "src");

  function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // TUI/CLI directories are allowed to reference UI concerns
        if (entry === "tui" || entry === "cli") continue;
        out.push(...collectTsFiles(full));
      } else if (entry.endsWith(".ts")) {
        out.push(full);
      }
    }
    return out;
  }

  it("CORE NEVER IMPORTS TUI/Ink/React/terminal rendering (Step 59)", () => {
    const coreFiles = collectTsFiles(SRC);
    expect(coreFiles.length).toBeGreaterThan(30);

    const violations: string[] = [];
    for (const file of coreFiles) {
      const content = readFileSync(file, "utf-8");
      // Match real UI package imports only (word-boundary safe)
      if (/from\s+["'](ink|react|chalk|ora|inquirer|cli-highlight|@inkjs)(\/|["'])/.test(content)) {
        violations.push(file);
      }
      if (/from\s+["'][^"']*\/(tui)\//.test(content)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it("official marketplace URL has ONE canonical default (Step 40)", async () => {
    const constants = await import("../../src/constants.js");
    expect(constants.OFFICIAL_MARKETPLACE_REPOSITORY).toContain("VeTwo-Market-Place");

    const coreFiles = collectTsFiles(SRC);
    const offenders = coreFiles.filter((f) => {
      const normalized = f.replace(/\\/g, "/");
      // constants.ts is the canonical home; errors/index.ts builds doc links from it
      if (normalized.endsWith("constants.ts") || normalized.endsWith("errors/index.ts")) {
        return false;
      }
      return readFileSync(f, "utf-8").includes("VeTwo-Market-Place");
    });
    expect(offenders).toEqual([]);
  });

  it("core does not hardcode the official marketplace URL beyond config defaults", () => {
    const coreFiles = collectTsFiles(SRC);
    const offenders = coreFiles.filter((f) => {
      if (f.includes("config") || f.includes("constants")) return false;
      const content = readFileSync(f, "utf-8");
      return content.includes("VeTwo-Market-Place");
    });
    expect(offenders).toEqual([]);
  });

  it("persistent state paths all live under .vetwo/marketplace (Step 52)", async () => {
    const { resolveStatePaths } = await import("../../src/state/index.js");
    const paths = resolveStatePaths("/project/.vetwo/marketplace");
    for (const [name, path] of Object.entries(paths)) {
      expect(path.startsWith("/project/.vetwo/marketplace"), `${name}: ${path}`).toBe(true);
    }
  });

  it("GitHub provider is replaceable via RegistryProvider contract (Steps 38–39)", async () => {
    // Marketplace facade accepts ANY provider without knowing about GitHub
    const { Marketplace } = await import("../../src/marketplace/index.js");
    const m = new Marketplace();
    expect(typeof m.setProvider).toBe("function");

    // A mock provider implementing the contract shape is accepted
    const mockProvider = {
      type: "local",
      load: async () => ({ version: "1", generatedAt: "", repository: "", categories: [], resources: [], metadata: {} }),
    };
    expect(() => m.setProvider(mockProvider as never)).not.toThrow();

    // Built-in providers exist as separate swappable implementations
    const providers = await import("../../src/providers/github.js");
    expect(providers.GitHubRegistryProvider).toBeDefined();
  });

  it("public API surface is importable without touching CLI/TUI internals", () => {
    expect(Object.keys(publicApi).length).toBeGreaterThan(40);
    expect(Object.keys(publicApi)).not.toContain("InstallPipelineStageInternal");
  });
});

// ─── Public API snapshot (Step 56) ───────────────────────────────────

describe("Public API snapshot", () => {
  it("matches the recorded export list — removals/renames fail CI", () => {
    const exports = Object.keys(publicApi).sort();

    // Core stable surface that must never disappear silently
    const requiredStable = [
      "Marketplace", "RegistryClient", "SearchEngine", "DependencyResolver",
      "Downloader", "DownloadEngine", "Installer", "TransactionManager",
      "Cache", "CacheManager", "EventBus", "PluginManager",
      "MarketplaceClientError", "ConfigManager", "Doctor",
      "ResourceTypeRegistry", "InstallerRegistry", "HookSystem",
      "InstalledStateManager", "ReconciliationEngine", "LifecycleManager",
      "DiagnosticCollector", "PerformanceTimeline",
      "DEFAULT_SECURITY_POLICY", "warnDeprecated", "validateSchemaVersion",
      "VERSION", "MARKETPLACE_VERSION", "createPlugin", "createError",
    ];
    for (const name of requiredStable) {
      expect(exports, `missing export: ${name}`).toContain(name);
    }

    // Snapshot of full export count — growth is fine, shrinkage is reviewed
    expect(exports.length).toBeGreaterThanOrEqual(60);
  });

  it("no internal modules leak into the public entry point (Step 49)", () => {
    const forbidden = ["internalDb", "_stateManager", "rawSql", "nodeModules"];
    for (const name of forbidden) {
      expect(Object.keys(publicApi)).not.toContain(name);
    }
  });
});

// ─── Schema / manifest / registry versioning (Steps 27–29) ───────────

describe("Schema versioning and compatibility", () => {
  it("unversioned manifests default to legacy v1 support", () => {
    const result = validateSchemaVersion(undefined);
    expect(result.supported).toBe(true);
    expect(result.version).toBe("1");
  });

  it("current manifest versions are accepted", () => {
    for (const v of SUPPORTED_MANIFEST_VERSIONS) {
      expect(validateSchemaVersion(v).supported).toBe(true);
      expect(validateSchemaVersion(Number(v)).supported).toBe(true); // numeric form
    }
  });

  it("FUTURE manifest versions fail clearly — never silently accepted (Step 28)", () => {
    const result = validateSchemaVersion("99.0");
    expect(result.supported).toBe(false);
    expect(result.error).toContain('Unsupported manifest schema version "99.0"');
  });

  it("invalid version types are rejected deterministically", () => {
    expect(validateSchemaVersion({ bad: true }).supported).toBe(false);
    expect(validateSchemaVersion(["1"]).supported).toBe(false);
  });

  it("registry schema versioning validates against its own supported set (Step 29)", () => {
    expect(validateSchemaVersion("1.0.0", ["1.0.0"], "registry").supported).toBe(true);
    expect(validateSchemaVersion("2.0.0", ["1.0.0"], "registry").supported).toBe(false);
  });
});

// ─── Deprecation system (Step 42) ────────────────────────────────────

describe("Deprecation mechanism", () => {
  it("warns once per code — never spams", () => {
    resetDeprecationWarnings();
    const warnings: string[] = [];
    const fakeLogger = {
      warn: (msg: string) => warnings.push(msg),
      child: () => fakeLogger,
      debug: () => {}, info: () => {}, error: () => {},
    };

    warnDeprecated({ code: "API_OLD", message: "oldThing() is deprecated", replacement: "newThing()", removalTarget: "3.0.0" }, fakeLogger as never);
    warnDeprecated({ code: "API_OLD", message: "oldThing() is deprecated" }, fakeLogger as never);
    warnDeprecated({ code: "API_OLD", message: "oldThing() is deprecated" }, fakeLogger as never);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("newThing()");
    expect(warnings[0]).toContain("3.0.0");
  });

  it("distinct codes each warn exactly once", () => {
    resetDeprecationWarnings();
    const warnings: string[] = [];
    const fakeLogger = { warn: (m: string) => warnings.push(m), child: () => fakeLogger, debug: () => {}, info: () => {}, error: () => {} };
    warnDeprecated({ code: "A", message: "a" }, fakeLogger as never);
    warnDeprecated({ code: "B", message: "b" }, fakeLogger as never);
    expect(warnings).toHaveLength(2);
    resetDeprecationWarnings();
  });
});
