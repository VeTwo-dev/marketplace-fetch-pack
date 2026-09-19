import { describe, it, expect } from "vitest";
import { createTransformRegistry } from "../../src/transform/index.js";
import { createMergeRegistry } from "../../src/merge/index.js";
import { createTypeRegistry } from "../../src/resource-types/index.js";
import { createInstallerRegistry } from "../../src/installer-registry/index.js";
import { genericFileInstaller, genericFilePreviewer } from "../../src/installer-registry/generic.js";
import { GitHubRegistryProvider } from "../../src/providers/github.js";
import { LocalRegistryProvider } from "../../src/providers/local.js";
import type { MergeContext } from "../../src/types/merge.js";

/**
 * Phase 18 Step 53 — reusable contract suites.
 * Any third-party implementation of these contracts must also pass.
 */

// ─── Transform contract ──────────────────────────────────────────────

function assertTransformContract(
  registry: ReturnType<typeof createTransformRegistry>,
  names: ReadonlyArray<string>,
) {
  for (const name of names) {
    const def = registry.get(name);
    expect(def, `transform ${name} must be registered`).toBeDefined();
    expect(typeof def!.transform).toBe("function");
    expect(["content", "filename", "path", "metadata"]).toContain(def!.target);
    expect(typeof def!.order).toBe("number");
  }
}

describe("Contract: Transform", () => {
  const transforms = createTransformRegistry();

  it("all built-in transforms satisfy the transform contract", () => {
    assertTransformContract(transforms, transforms.getAll().map((t) => t.name));
  });

  it("transforms are deterministic — same input, same output", async () => {
    const names = transforms.getAll().map((t) => t.name);
    const input = "const x = process.env.FOO;";
    const vars = { "package-json-patch": "{}" };
    const a = await transforms.apply(input, "f.ts", names, vars);
    const b = await transforms.apply(input, "f.ts", names, vars);
    expect(a).toBe(b); // determinism property
  });
});

// ─── Merge strategy contract ─────────────────────────────────────────

describe("Contract: MergeStrategy", () => {
  const registry = createMergeRegistry();
  const ctx: MergeContext = {
    filePath: "test.json",
    variables: {},
    resource: null,
  };

  it("built-in strategies are registered and typed", () => {
    for (const strategy of registry.getAll()) {
      expect(strategy.name).toBeTruthy();
      expect(typeof strategy.merge).toBe("function");
      expect(typeof strategy.description).toBe("string");
    }
  });

  it("strategies are deterministic — identical inputs give identical outputs", () => {
    for (const name of ["copy", "replace", "append", "prepend"] as const) {
      const s = registry.get(name as never)!;
      if (s === undefined) continue;
      const a = s.merge("existing\n", "incoming\n", ctx);
      const b = s.merge("existing\n", "incoming\n", ctx);
      expect(a.content).toBe(b.content);
    }
  });

  it("copy strategy produces the incoming content exactly", () => {
    const s = registry.get("copy" as never)!;
    const result = s.merge("old", "new content", ctx);
    expect(result.content).toBe("new content");
  });
});

// ─── ResourceType + Installer contract ───────────────────────────────

describe("Contract: ResourceType / Installer", () => {
  const types = createTypeRegistry();

  it("every registered type satisfies the ResourceType contract", () => {
    for (const reg of types.getAll()) {
      expect(reg.type.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(reg.type.displayName.length).toBeGreaterThan(0);
      expect(Array.isArray(reg.type.capabilities)).toBe(true);
      expect(Array.isArray(reg.type.manifestNames)).toBe(true);
      expect(typeof reg.installer.install).toBe("function");
      expect(["builtin", "plugin"]).toContain(reg.source);
    }
  });

  it("installer resolution is total — unknown type gives structured failure, not crash", async () => {
    const installers = createInstallerRegistry();
    const result = await installers.install(
      {
        resourceId: "x",
        version: "1",
        source: [],
        destination: "/tmp/never",
        variables: {},
        resourceType: "nonexistent-type",
      },
      "nonexistent-type",
    );
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("generic installer satisfies the InstallerFunction contract", async () => {
    expect(typeof genericFileInstaller).toBe("function");
    expect(typeof genericFilePreviewer).toBe("function");
  });
});

// ─── Provider contract ───────────────────────────────────────────────

describe("Contract: RegistryProvider", () => {
  it("providers expose type identity and load capability", () => {
    const github = new GitHubRegistryProvider({ repository: "https://github.com/x/y", branch: "main" } as never);
    expect(github.type).toBe("github");

    // Local provider with temp path
    const local = new LocalRegistryProvider("/tmp/does-not-matter");
    expect(local.type).toBeDefined();
  });
});
