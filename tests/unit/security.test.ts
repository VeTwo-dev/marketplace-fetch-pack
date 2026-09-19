import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_SECURITY_POLICY,
  isSafeRelativePath,
  resolveWithinRoot,
  assertNoSymlinkEscape,
  assertFileSize,
  assertResourceSize,
  assertDependencyLimits,
  validateRemoteUrl,
  mayForwardSensitiveHeaders,
  assertScriptExecutionAllowed,
  type SecurityPolicy,
} from "../../src/security/index.js";
import { genericFileInstaller } from "../../src/installer-registry/generic.js";

function policy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
  return { ...DEFAULT_SECURITY_POLICY, ...overrides };
}

// ─── Path traversal (Step 4 / Matrix) ────────────────────────────────

describe("Path traversal protection", () => {
  const attacks = [
    "../escape.txt",
    "../../etc/passwd",
    "../../../root/.ssh/id_rsa",
    "..\\windows\\system32",
    "foo/../../bar",
    "/etc/passwd",
    "/absolute/path",
    "C:\\Windows\\System32",
    "C:/Users/x",
    "\\\\server\\share\\file",
    "//server/share",
    "%2e%2e/escape",
    "safe/%2e%2e%2fescape",
    "file\u0000.txt",
    "con",
    "aux/nul.txt",
  ];

  for (const attack of attacks) {
    it(`rejects: ${JSON.stringify(attack)}`, () => {
      expect(isSafeRelativePath(attack)).toBe(false);
    });
  }

  const safe = ["file.txt", "dir/file.txt", "a/b/c/deep.json", "./local.txt", "with-dash_and.dot"];
  for (const p of safe) {
    it(`accepts legitimate: ${p}`, () => {
      expect(isSafeRelativePath(p)).toBe(true);
    });
  }

  it("resolveWithinRoot throws structured error on traversal", () => {
    expect(() => resolveWithinRoot("/tmp/root", "../escape")).toThrow(/sandbox|Unsafe/i);
    try {
      resolveWithinRoot("/tmp/root", "../../x");
    } catch (error) {
      expect((error as { code: string }).code).toMatch(/DESTINATION_INVALID/);
      expect((error as { context?: { reason?: string } }).context?.reason).toBeTruthy();
    }
  });

  it("resolveWithinRoot keeps legitimate paths inside root", () => {
    const target = resolveWithinRoot("/tmp/root", "sub/dir/file.txt");
    expect(target.startsWith("/tmp/root")).toBe(true);
  });
});

// ─── Destination sandbox (Step 5) ────────────────────────────────────

describe("Destination sandbox enforcement in installer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sandbox-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("blocks a resource attempting to escape via ../ and aborts the install", async () => {
    const result = await genericFileInstaller({
      resourceId: "evil",
      version: "1.0.0",
      source: [
        { path: "legit.txt", content: "ok" },
        { path: "../escaped.txt", content: "PWNED" },
        { path: "after.txt", content: "should not be written" },
      ],
      destination: tempDir,
      variables: {},
      resourceType: "any",
    });

    expect(result.success).toBe(false);
    // The traversal attempt is reported
    expect(result.errors.some((e) => e.includes("../escaped.txt"))).toBe(true);

    // Nothing escaped outside the destination
    let escapedExists = false;
    try {
      await readFile(join(tempDir, "..", "escaped.txt"));
      escapedExists = true;
    } catch { /* good */ }
    expect(escapedExists).toBe(false);
  });

  it("enforces file count limit (resource bomb guard)", async () => {
    const tiny = policy({ maxFileCount: 3 });
    const result = await genericFileInstaller(
      {
        resourceId: "bomb",
        version: "1.0.0",
        source: Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.txt`, content: "x" })),
        destination: tempDir,
        variables: {},
        resourceType: "any",
      },
      tiny,
    );
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("limit");
  });

  it("enforces total size limit", async () => {
    const tiny = policy({ maxTotalSizeBytes: 10 });
    const result = await genericFileInstaller(
      {
        resourceId: "big",
        version: "1.0.0",
        source: [{ path: "big.txt", content: "x".repeat(1000) }],
        destination: tempDir,
        variables: {},
        resourceType: "any",
      },
      tiny,
    );
    expect(result.success).toBe(false);
  });

  it("dry run does not validate against disk but still counts limits", async () => {
    const tiny = policy({ maxFileCount: 1 });
    const result = await genericFileInstaller(
      {
        resourceId: "d",
        version: "1.0.0",
        source: [{ path: "a.txt", content: "x" }],
        destination: tempDir,
        variables: {},
        resourceType: "any",
        dryRun: true,
      },
      tiny,
    );
    expect(result.filesWritten).toEqual(["a.txt"]);
  });
});

// ─── Symlink safety (Step 6) ─────────────────────────────────────────

describe("Symlink protection", () => {
  let tempDir: string;
  let root: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "symlink-test-"));
    root = join(tempDir, "dest");
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects symlink escape when policy denies symlinks", async () => {
    const secret = join(tempDir, "secret.txt");
    await writeFile(secret, "top secret");
    const linkPath = join(root, "innocent");
    await symlink(secret, linkPath);

    await expect(
      assertNoSymlinkEscape(root, linkPath, policy({ allowSymlinks: false })),
    ).rejects.toThrow(/symlink/i);
  });

  it("rejects even allowed symlinks that point outside the root", async () => {
    const secret = join(tempDir, "secret2.txt");
    await writeFile(secret, "s");
    const linkPath = join(root, "out");
    await symlink(secret, linkPath);

    await expect(
      assertNoSymlinkEscape(root, linkPath, policy({ allowSymlinks: true })),
    ).rejects.toThrow(/escapes destination root/i);
  });

  it("allows compliant paths without symlinks", async () => {
    const plain = join(root, "plain.txt");
    await writeFile(plain, "fine");
    await expect(
      assertNoSymlinkEscape(root, plain, policy()),
    ).resolves.toBeUndefined();
  });
});

// ─── Limits API (Step 8) ─────────────────────────────────────────────

describe("Resource limit guards", () => {
  it("assertFileSize rejects oversized files", () => {
    const p = policy({ maxFileSizeBytes: 100 });
    expect(() => assertFileSize(50, p, "small")).not.toThrow();
    expect(() => assertFileSize(200, p, "huge")).toThrow(/exceeds maximum size/);
  });

  it("assertResourceSize rejects bombs", () => {
    const p = policy({ maxTotalSizeBytes: 1000, maxFileCount: 5 });
    expect(() => assertResourceSize(500, 3, p)).not.toThrow();
    expect(() => assertResourceSize(5000, 3, p)).toThrow(/total size/);
    expect(() => assertResourceSize(100, 50, p)).toThrow(/file count/);
  });

  it("assertDependencyLimits rejects explosion", () => {
    const p = policy({ maxDependencyCount: 10, maxDependencyDepth: 5 });
    expect(() => assertDependencyLimits(5, 3, p)).not.toThrow();
    expect(() => assertDependencyLimits(20, 3, p)).toThrow(/count/);
    expect(() => assertDependencyLimits(5, 30, p)).toThrow(/depth/);
  });
});

// ─── URL validation & SSRF (Steps 19–20) ─────────────────────────────

describe("URL validation and redirect security", () => {
  it("accepts https URLs", () => {
    expect(validateRemoteUrl("https://github.com/VeTwo-dev/VeTwo-Market-Place").valid).toBe(true);
  });

  it("rejects non-https protocols by default", () => {
    expect(validateRemoteUrl("http://example.com/f").reason).toContain("protocol");
    expect(validateRemoteUrl("ftp://example.com").valid).toBe(false);
    expect(validateRemoteUrl("file:///etc/passwd").valid).toBe(false);
  });

  it("blocks SSRF targets (localhost/private ranges/metadata)", () => {
    for (const url of [
      "https://localhost/admin",
      "https://127.0.0.1/x",
      "https://10.0.0.5/internal",
      "https://192.168.1.1/router",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.local/",
    ]) {
      expect(validateRemoteUrl(url).valid, url).toBe(false);
    }
  });

  it("allows private networks only when explicitly configured", () => {
    const permissive = policy({ blockPrivateNetworks: false, allowedProtocols: ["https:", "http:"] });
    expect(validateRemoteUrl("https://localhost/x", permissive).valid).toBe(true);
  });

  it("rejects credentials embedded in URLs", () => {
    expect(validateRemoteUrl("https://user:pass@example.com/f").valid).toBe(false);
  });

  it("does not forward sensitive headers across origins on redirect", () => {
    expect(mayForwardSensitiveHeaders(
      "https://github.com/a/b",
      "https://github.com/a/c",   // same origin → may forward
    )).toBe(true);
    expect(mayForwardSensitiveHeaders(
      "https://github.com/a/b",
      "https://evil.example.com/payload", // different origin → must NOT forward
    )).toBe(false);
  });
});

// ─── Script execution policy (Step 14) ───────────────────────────────

describe("Script execution policy", () => {
  it("denies all script execution under default policy", () => {
    expect(() =>
      assertScriptExecutionAllowed("rm -rf /", DEFAULT_SECURITY_POLICY),
    ).toThrow(/denied by security policy/i);
    expect(() =>
      assertScriptExecutionAllowed("npm install", DEFAULT_SECURITY_POLICY),
    ).toThrow();
  });

  it("allow-registered still requires explicit opt-in", () => {
    const permissive = policy({ scriptExecution: "allow-all" });
    expect(() => assertScriptExecutionAllowed("node x.js", permissive)).not.toThrow();
  });
});

// ─── Wired enforcement (Phase 17/18 integration) ─────────────────────

describe("Enforcement wiring in core subsystems", () => {
  it("ManifestParser rejects future schema versions at parse time (Step 28)", async () => {
    const { ManifestParser } = await import("../../src/manifest/index.js");
    const parser = new ManifestParser();
    expect(() =>
      parser.parse(
        { name: "x", version: "1.0.0", description: "d", author: "a", category: "c", schemaVersion: "99.0" },
        "resource.json",
        "x/resource.json",
      ),
    ).toThrow(/Unsupported manifest schema version/);

    // Unversioned manifests still parse fine (legacy default)
    const ok = parser.parse(
      { name: "y", version: "1.0.0", description: "d", author: "a", category: "c" },
      "resource.json",
      "y/resource.json",
    );
    expect(ok.name).toBe("y");
  });

  it("DependencyResolver enforces the dependency depth security limit (Step 21)", async () => {
    // Build a synthetic chain deeper than the limit via a self-referential
    // registry resource set; resolver must throw the depth error, not hang.
    const { DependencyResolver } = await import("../../src/dependencies/index.js");
    const resolver = new DependencyResolver();
    const deep = 200; // exceeds maxDependencyDepth (128)
    const resources = Array.from({ length: deep }, (_, i) => ({
      id: `chain-${i}`,
      name: `chain-${i}`,
      displayName: "",
      description: "",
      version: "1.0.0",
      category: "c",
      tags: [],
      author: { name: "" },
      manifestPath: "",
      manifestHash: "",
      dependencies:
        i < deep - 1
          ? [{ id: `chain-${i + 1}`, requirement: "*" }]
          : [],
      keywords: [],
    })) as never[];
    resolver.setResources(resources);

    await expect(resolver.resolve("chain-0")).rejects.toThrow(/depth.*exceeds|exceeds security limit/i);
  });

  it("plugin permissions are inspectable (Phase 17 Step 17)", async () => {
    const { PluginManager } = await import("../../src/plugins/index.js");
    const pm = new PluginManager();
    pm.register({
      manifest: {
        id: "risky",
        name: "risky",
        version: "1.0.0",
        description: "",
        author: "",
        capabilities: [],
        permissions: ["filesystem-write", "network"],
      },
      hooks: {},
    });
    pm.register({
      manifest: {
        id: "safe",
        name: "safe",
        version: "1.0.0",
        description: "",
        author: "",
        capabilities: [],
      },
      hooks: {},
    });

    expect(pm.getPermissions("risky")).toEqual(["filesystem-write", "network"]);
    expect(pm.hasPermission("risky", "network")).toBe(true);
    expect(pm.hasPermission("risky", "process-execution")).toBe(false);
    expect(pm.getPermissions("safe")).toEqual([]);
  });
});
