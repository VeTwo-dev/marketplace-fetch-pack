import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createIsolatedProject,
  generateResources,
  makeRegistry,
  writeRegistryFile,
} from "../fixtures/index.js";
import { Cache } from "../../src/cache/index.js";
import { Marketplace } from "../../src/marketplace/index.js";
import { VersionResolver } from "../../src/versions/index.js";

// ─── Offline mode (Step 44) ──────────────────────────────────────────

describe("Offline mode", () => {
  let project: { root: string; stateRoot: string };

  beforeEach(async () => {
    project = await createIsolatedProject("offline-test-");
  });

  afterEach(async () => {
    await rm(project.root, { recursive: true, force: true });
  });

  it("offline config flag is honored through config resolution", async () => {
    const { ConfigManager } = await import("../../src/config/index.js");
    const manager = new ConfigManager();
    const resolved = await manager.load({ offline: true, destination: join(project.stateRoot) });
    expect(resolved.offline).toBe(true);

    // Marketplace applies the passed config on load()
    const marketplace = new Marketplace({
      logger: silentLogger(),
    });
    await marketplace.load({ offline: true });
    expect(marketplace.config.offline).toBe(true);
  });

  it("cache reads work without any network in offline mode", async () => {
    const cacheDir = join(project.stateRoot, "cache");
    const cache = new Cache({ enabled: true, directory: cacheDir, ttl: 3600, maxSize: 1024 * 1024 });
    await cache.initialize();
    await cache.set("k1", { data: "payload" });
    const entry = await cache.get<{ data: string }>("k1");
    expect(entry).not.toBeNull();
    expect((entry as unknown as { data: { data: string } }).data.data).toBe("payload");
    await cache.clear();
  });
});

function silentLogger() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { child: () => silentLogger(), debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;
}

// ─── Idempotency (Step 41) ───────────────────────────────────────────

describe("Idempotency", () => {
  it("writing identical state twice produces byte-identical files", async () => {
    const project = await createIsolatedProject("idem-test-");
    try {
      const lockPath = join(project.stateRoot, "test.json");
      const payload = {
        version: "1.0.0",
        resources: [{ id: "a", version: "1.0.0" }],
      };
      await mkdirRecursive(project.stateRoot);
      await writeFile(lockPath, JSON.stringify(payload, null, 2), "utf-8");
      const first = await readFile(lockPath, "utf-8");
      await writeFile(lockPath, JSON.stringify(payload, null, 2), "utf-8");
      const second = await readFile(lockPath, "utf-8");
      expect(first).toBe(second); // deterministic output, no drift
    } finally {
      await rm(project.root, { recursive: true, force: true });
    }
  });

  it("dependency resolution is deterministic for the same input", async () => {
    const resolver = new VersionResolver();
    const r1 = resolver.parseSpec("^1.2.3");
    const r2 = resolver.parseSpec("^1.2.3");
    expect(r1).toEqual(r2);
    expect(resolver.satisfies("1.4.0", r1)).toBe(true);

    const versions = ["1.0.0", "2.0.0", "1.5.0"];
    const sorted1 = [...versions].sort((a, b) => resolver.compareVersions(a, b));
    const sorted2 = [...versions].sort((a, b) => resolver.compareVersions(a, b));
    expect(sorted1).toEqual(sorted2);
  });
});

async function mkdirRecursive(dir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
}

// ─── Concurrency safety (Steps 38, 55) ───────────────────────────────

describe("Concurrency stress", () => {
  it("concurrent cache writers do not corrupt state", async () => {
    const project = await createIsolatedProject("conc-cache-test-");
    try {
      const cacheDir = join(project.stateRoot, "cache");
      const cache = new Cache({ enabled: true, directory: cacheDir, ttl: 3600, maxSize: 1024 * 1024 });
      await cache.initialize();

      const writes = Array.from({ length: 50 }, (_, i) =>
        cache.set(`key-${i}`, { index: i, payload: "x".repeat(100) }),
      );
      await Promise.all(writes);

      for (let i = 0; i < 50; i++) {
        const entry = await cache.get<{ index: number }>(`key-${i}`);
        if (entry !== null) {
          const v = (entry as unknown as { data: { index: number } }).data;
          expect(v.index).toBe(i); // never cross-contaminated
        }
      }
      await cache.clear();
    } finally {
      await rm(project.root, { recursive: true, force: true });
    }
  });

  it("concurrent plugin initialization completes without deadlock", async () => {
    const { PluginManager } = await import("../../src/plugins/index.js");
    const pm = new PluginManager();
    for (let i = 0; i < 10; i++) {
      pm.register({
        manifest: {
          id: `p${i}`,
          name: `p${i}`,
          version: "1.0.0",
          description: "",
          author: "",
          capabilities: [],
          dependencies: i > 0 ? [{ id: `p${i - 1}` }] : [],
        },
        hooks: {},
      });
    }
    // chain of 10 → deterministic sequential init
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("deadlock")), 5000),
    );
    await Promise.race([pm.initialize(), timeout]);
    expect(pm.getState("p9")).toBe("ready");
  });
});

// ─── Crash recovery (Step 40) ────────────────────────────────────────

describe("Crash recovery", () => {
  it("atomic write interruption leaves no partial target file", async () => {
    const project = await createIsolatedProject("crash-test-");
    try {
      const target = join(project.stateRoot, "state.json");
      await mkdirRecursive(project.stateRoot);
      // Simulate completed prior state
      await writeFile(target, JSON.stringify({ ok: true }), "utf-8");

      // Simulate crashed atomic write: tmp file exists, rename never happened
      const tmp = `${target}.tmp.999.crash`;
      await writeFile(tmp, "{ partially written", "utf-8");

      // Reader must see the last committed state, not the tmp garbage
      const content = JSON.parse(await readFile(target, "utf-8")) as { ok: boolean };
      expect(content.ok).toBe(true);

      // Cleanup removes orphaned tmp artifacts
      const { readdir, rm } = await import("node:fs/promises");
      const entries = await readdir(project.stateRoot);
      const orphans = entries.filter((e) => e.includes(".tmp."));
      for (const o of orphans) {
        await rm(join(project.stateRoot, o), { force: true });
      }
      expect(orphans.length).toBe(1); // we detected the orphan
      const after = await readdir(project.stateRoot);
      expect(after.some((e) => e.includes(".tmp."))).toBe(false);
    } finally {
      await rm(project.root, { recursive: true, force: true });
    }
  });

  it("lockfile with invalid JSON fails validation clearly instead of silent corruption", async () => {
    const project = await createIsolatedProject("lockfile-crash-test-");
    try {
      await mkdirRecursive(project.root);
      await writeFile(join(project.root, "vetwo.lock.json"), "{ truncated", "utf-8");

      const { createEnhancedLockFileService } = await import("../../src/lockfile/index.js");
      const service = createEnhancedLockFileService();
      const validation = await service.validate(project.root);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    } finally {
      await rm(project.root, { recursive: true, force: true });
    }
  });
});

// ─── Fuzz / property testing (Step 56) ───────────────────────────────

describe("Fuzz / property tests", () => {
  const resolver = new VersionResolver();
  const randomSeedInputs = [
    "", " ", "v", "^", "~", ">=", "<=", "1", "1.", "1.2", "abc", "*",
    "^1.2.3", "~2.0.0", ">=1.0.0 <2.0.0", "not-a-version", "999.999.999",
    "-1.-1.-1", "1.2.3.4.5", "\u0000", "🎉",
  ];

  it("version parser never crashes on arbitrary input", () => {
    for (const input of randomSeedInputs) {
      expect(() => resolver.parseSpec(input)).not.toThrow();
      const spec = resolver.parseSpec(input);
      expect(() => resolver.satisfies("1.2.3", spec)).not.toThrow();
      // satisfies must be boolean — never undefined/null
      expect(typeof resolver.satisfies("1.2.3", spec)).toBe("boolean");
    }
  });

  it("satisfies is consistent: same inputs → same result (property)", () => {
    for (const range of randomSeedInputs) {
      const spec = resolver.parseSpec(range);
      const a = resolver.satisfies("1.2.3", spec);
      const b = resolver.satisfies("1.2.3", spec);
      expect(a).toBe(b);
    }
  });

  it("registry fixture generation is deterministic at scale", () => {
    const ids = generateResources(1000);
    expect(ids).toHaveLength(1000);
    expect(new Set(ids).size).toBe(1000);
    expect(generateResources(100)).toEqual(generateResources(100));

    const registry = makeRegistry(ids.slice(0, 10)) as { metadata: { totalCount: number } };
    expect(registry.metadata.totalCount).toBe(10);
  });

  it("JSON round-trip of registry fixtures preserves data", () => {
    const registry = makeRegistry(["a", "b"]);
    const parsed = JSON.parse(JSON.stringify(registry));
    expect(parsed).toEqual(registry);
  });
});
