import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateArchiveEntries,
  extractArchiveEntries,
  type ArchiveEntryWithContent,
} from "../../src/security/archive.js";
import { DEFAULT_SECURITY_POLICY, type SecurityPolicy } from "../../src/security/index.js";
import { PluginManager } from "../../src/plugins/index.js";
import { PluginStateStore } from "../../src/plugins/state-store.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

function policy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
  return { ...DEFAULT_SECURITY_POLICY, ...overrides };
}

// ─── Archive safety (Phase 17 Step 9) ────────────────────────────────

describe("Archive safety", () => {
  const base = [
    { path: "lib/main.js", type: "file" as const, sizeBytes: 10, content: "// ok" },
    { path: "readme.md", type: "file" as const, sizeBytes: 5, content: "hello" },
  ];

  it("allows benign archives end to end", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "archive-ok-"));
    try {
      const result = validateArchiveEntries(base, policy());
      expect(result.allowed).toHaveLength(2);
      expect(result.rejected).toHaveLength(0);

      const extraction = await extractArchiveEntries(result.allowed as ArchiveEntryWithContent[], tempDir, policy());
      expect(extraction.written.sort()).toEqual(["lib/main.js", "readme.md"]);
      expect(await readFile(join(tempDir, "lib/main.js"), "utf-8")).toBe("// ok");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  const malicious: Array<[string, ArchiveEntryWithContent]> = [
    ["zip-slip parent traversal", { path: "../escape.js", type: "file", sizeBytes: 1, content: "x" }],
    ["absolute path entry", { path: "/etc/passwd", type: "file", sizeBytes: 1, content: "x" }],
    ["windows drive path", { path: "C:\\evil.js", type: "file", sizeBytes: 1, content: "x" }],
    ["symlink to outside", { path: "link", type: "symlink", sizeBytes: 0, target: "/etc/passwd" }],
    ["relative symlink escape", { path: "link2", type: "symlink", sizeBytes: 0, target: "../../../out" }],
    ["fifo/special file", { path: "pipe", type: "special", sizeBytes: 0 }],
    ["oversized entry", { path: "big.bin", type: "file", sizeBytes: DEFAULT_SECURITY_POLICY.maxFileSizeBytes + 1, content: "" }],
  ];

  for (const [name, entry] of malicious) {
    it(`rejects: ${name}`, () => {
      const result = validateArchiveEntries([entry], policy());
      expect(result.allowed).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.reason).toBeTruthy();
    });
  }

  it("permits only internal relative symlinks when policy explicitly allows them", () => {
    const p = policy({ allowSymlinks: true });
    const entries: ArchiveEntryWithContent[] = [
      { path: "a/real.txt", type: "file", sizeBytes: 1, content: "x" },
      { path: "b/link", type: "symlink", sizeBytes: 0, target: "../a/real.txt" },
    ];
    const result = validateArchiveEntries(entries, p);
    expect(result.rejected).toHaveLength(0);
    expect(result.allowed).toHaveLength(2);
  });

  it("rejects decompression bombs via total size limit", () => {
    // Entries each pass the per-file check but collectively exceed the
    // total extracted size limit.
    const bomb: ArchiveEntryWithContent[] = Array.from({ length: 4 }, (_, i) => ({
      path: `f${i}.bin`,
      type: "file" as const,
      sizeBytes: 100,
      content: "",
    }));
    const tinyTotal = policy({ maxFileSizeBytes: 200, maxTotalSizeBytes: 250 });
    expect(() => validateArchiveEntries(bomb, tinyTotal)).toThrow(/decompression bomb|total extracted size/i);

    // Same entries pass under an adequate total budget
    expect(() =>
      validateArchiveEntries(bomb, policy({ maxFileSizeBytes: 200, maxTotalSizeBytes: 1000 })),
    ).not.toThrow();
  });

  it("rejects excessive file counts", () => {
    const tinyPolicy = policy({ maxFileCount: 2 });
    const many: ArchiveEntryWithContent[] = Array.from({ length: 5 }, (_, i) => ({
      path: `f${i}.txt`,
      type: "file",
      sizeBytes: 1,
      content: "x",
    }));
    expect(() => validateArchiveEntries(many, tinyPolicy)).toThrow(/maximum file count/i);
  });

  it("extraction never writes outside the destination root", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "archive-escape-"));
    try {
      const sneaky: ArchiveEntryWithContent[] = [
        { path: "../../outside.txt", type: "file", sizeBytes: 1, content: "pwned" },
        { path: "safe.txt", type: "file", sizeBytes: 1, content: "ok" },
      ];
      const extraction = await extractArchiveEntries(sneaky, tempDir, policy());
      expect(extraction.written).toEqual(["safe.txt"]);
      expect(extraction.skipped.some((s) => s.includes("../.."))).toBe(true);

      let escapedExists = false;
      try {
        await access(join(tempDir, "..", "..", "outside.txt"));
        escapedExists = true;
      } catch { /* good */ }
      expect(escapedExists).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ─── Plugin permission enforcement (Phase 17 Step 17) ─────────────────

describe("Plugin permission enforcement", () => {
  let tempDir: string;
  let pluginsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "perm-test-"));
    pluginsDir = join(tempDir, ".vetwo", "marketplace", "plugins");
    await mkdir(pluginsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makePluginWithPermission(id: string, permissions?: string[]): any {
    return {
      manifest: {
        id,
        name: id,
        version: "1.0.0",
        description: "",
        author: "",
        capabilities: [],
        ...(permissions !== undefined ? { permissions } : {}),
      },
      hooks: {},
    };
  }

  it("plugin WITHOUT filesystem-write gets ephemeral state — nothing touches disk", async () => {
    const pm = new PluginManager(undefined, { stateDir: pluginsDir });
    pm.register(makePluginWithPermission("no-perm"));

    // Initialize writes plugin context; simulate lifecycle hook using state
    pm.register({
      manifest: { id: "ephemeral-plugin", name: "e", version: "1.0.0", description: "", author: "", capabilities: [] },
      hooks: {
        onInitialize: (ctx) => {
          ctx.state.set("secret", "value");
        },
      },
    });
    await pm.initialize();

    // In-memory state worked...
    const store = new PluginStateStore(pluginsDir);
    expect(store.load("ephemeral-plugin")).toEqual({});

    // ...and nothing was persisted
    let files: string[] = [];
    try {
      files = await readdir(join(pluginsDir));
    } catch { /* dir empty */ }
    expect(files).not.toContain("ephemeral-plugin");
  });

  it("plugin WITH filesystem-write persists state to disk", async () => {
    const pm = new PluginManager(undefined, { stateDir: pluginsDir });
    pm.register({
      manifest: {
        id: "trusted-plugin",
        name: "t",
        version: "1.0.0",
        description: "",
        author: "",
        capabilities: [],
        permissions: ["filesystem-write"],
      },
      hooks: {
        onInitialize: (ctx) => {
          ctx.state.set("persisted", true);
        },
      },
    });

    await pm.initialize();
    await pm.dispose(); // dispose flushes pending writes

    const content = JSON.parse(
      await readFile(join(pluginsDir, "trusted-plugin", "state.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(content.persisted).toBe(true);
  }, 15000);

  it("requirePermission throws structured error for undeclared permission", () => {
    const pm = new PluginManager();
    pm.register(makePluginWithPermission("limited", ["registry-access"]));

    expect(() => pm.requirePermission("limited", "network")).toThrow(MarketplaceClientError);
    expect(() => pm.requirePermission("limited", "registry-access")).not.toThrow();

    try {
      pm.requirePermission("limited", "process-execution");
    } catch (error) {
      const err = error as { code: string; context?: Record<string, unknown> };
      expect(err.code).toBe("PERMISSION_DENIED");
      expect(err.context?.requiredPermission).toBe("process-execution");
    }
  });

  it("dangerous permissions are visible in the public API surface", () => {
    const pm = new PluginManager();
    pm.register(makePluginWithPermission("inspector", ["filesystem-write", "network", "environment-read"]));
    expect(pm.getPermissions("inspector")).toEqual(["filesystem-write", "network", "environment-read"]);
  });
});
