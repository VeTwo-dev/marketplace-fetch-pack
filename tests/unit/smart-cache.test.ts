import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, utimes, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyEntry,
  categoryTtl,
  CATEGORY_TTL_MS,
  GENERAL_TTL_MS,
  buildNamespacedKey,
  parseNamespacedKey,
  withStampedeGuard,
  collectCacheGarbage,
  promoteAtomically,
} from "../../src/cache/smart.js";

describe("Cache entry states (Step 33)", () => {
  it("classifies fresh/stale/expired by category TTL", () => {
    const now = Date.now();
    const registryTtl = CATEGORY_TTL_MS.registry!;
    expect(classifyEntry(now - 1000, "registry", now)).toBe("fresh");
    expect(classifyEntry(now - registryTtl * 2, "registry", now)).toBe("stale");
    expect(classifyEntry(now - registryTtl * 6, "registry", now)).toBe("expired");
  });

  it("different categories have different TTL policies (Step 37)", () => {
    expect(categoryTtl("registry")).toBeLessThan(categoryTtl("manifests"));
    expect(categoryTtl("manifests")).toBeLessThan(categoryTtl("downloads"));
    // Unknown categories fall back to a sane default — never NaN/0
    expect(categoryTtl("unknown-category")).toBe(GENERAL_TTL_MS);
  });
});

describe("Namespaced keys (Step 31)", () => {
  it("embed provider/repo/ref context — round-trips", () => {
    const key = buildNamespacedKey({
      provider: "github",
      repository: "VeTwo-dev/VeTwo-Market-Place",
      ref: "main",
      label: "registry",
    });
    expect(key.startsWith("github::")).toBe(true);
    const parsed = parseNamespacedKey(key)!;
    expect(parsed.provider).toBe("github");
    expect(parsed.repository).toBe("VeTwo-dev/VeTwo-Market-Place");
    expect(parsed.ref).toBe("main");
  });

  it("returns null for malformed keys instead of misattributing data", () => {
    expect(parseNamespacedKey("no-delimiters")).toBeNull();
  });
});

// ─── Stampede prevention (Step 36) ───────────────────────────────────

describe("Cross-process stampede guard", () => {
  let tempDir: string;
  let lockDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stampede-test-"));
    lockDir = join(tempDir, "locks");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("one leader executes; concurrent callers are identified as followers", async () => {
    let executions = 0;

    const run = () =>
      withStampedeGuard({ lockDir, key: "registry-refresh" }, async () => {
        executions++;
        await new Promise((r) => setTimeout(r, 30));
        return "result";
      });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => run()),
    );

    // Exactly one leader; followers waited for lock release
    const leaders = results.filter((r) => r.leader).length;
    expect(leaders).toBe(1);
    expect(results.every((r) => r.value === "result")).toBe(true);

    // Lock is released after completion
    const { readdir } = await import("node:fs/promises");
    const remaining = (await readdir(lockDir)).filter((f) => f.endsWith(".lock"));
    expect(remaining).toHaveLength(0);
  });

  it("takes over locks abandoned by crashed processes", async () => {
    // Simulate a crashed leader: stale lock file
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      join(lockDir, "orphaned.lock"),
      JSON.stringify({ pid: 999999, at: Date.now() - 60_000 }),
      "utf-8",
    );

    const result = await withStampedeGuard(
      { lockDir, key: "orphaned", maxAgeMs: 10_000 },
      async () => "recovered",
    );
    expect(result.leader).toBe(true);
    expect(result.value).toBe("recovered");
  });
});

// ─── Cache GC (Steps 57–58) ──────────────────────────────────────────

describe("Cache garbage collection", () => {
  let tempDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gc-test-"));
    cacheDir = join(tempDir, "cache");
    await mkdir(cacheDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("removes expired entries and preserves recent ones", async () => {
    const oldFile = join(cacheDir, "old-entry.json");
    const newFile = join(cacheDir, "new-entry.json");
    await writeFile(oldFile, "{}", "utf-8");
    await writeFile(newFile, "{}", "utf-8");

    // Age the old file to 3 hours ago
    const oldTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await utimes(oldFile, oldTime, oldTime);

    const result = await collectCacheGarbage(cacheDir, {
      maxAgeMs: 60 * 60 * 1000,
      preserveRecentMs: 1000,
    });

    expect(result.removedEntries).toBe(1);
    expect(result.preservedEntries).toBe(1);
    expect(result.reclaimedBytes).toBeGreaterThan(0);

    let oldExists = true;
    try {
      await import("node:fs/promises").then((fs) => fs.access(oldFile));
    } catch {
      oldExists = false;
    }
    expect(oldExists).toBe(false); // collected

    const stillThere = await readFile(newFile, "utf-8");
    expect(stillThere).toBe("{}"); // preserved
  });

  it("is bounded — huge caches cannot freeze the CLI (Step 58)", async () => {
    for (let i = 0; i < 20; i++) {
      await writeFile(join(cacheDir, `e${i}.json`), "{}", "utf-8");
    }
    const start = Date.now();
    const result = await collectCacheGarbage(cacheDir, {
      maxAgeMs: 1000,
      preserveRecentMs: 0,
      maxEntriesScanned: 5, // deliberately tiny bound
    });
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(5000);
    expect(result.removedEntries + result.preservedEntries).toBeLessThanOrEqual(5);
  });

  it("handles empty and missing directories safely", async () => {
    const r1 = await collectCacheGarbage(cacheDir, { maxAgeMs: 1000 });
    expect(r1.removedEntries).toBe(0);

    const r2 = await collectCacheGarbage(join(tempDir, "does-not-exist"), {
      maxAgeMs: 1000,
    });
    expect(r2.removedEntries).toBe(0);
  });
});

// ─── Atomic promotion (Step 45) ──────────────────────────────────────

describe("Verified cache promotion", () => {
  it("promotes content atomically — no partial reads possible", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "promo-test-"));
    try {
      const target = join(tempDir, "nested", "snapshot.json");
      await promoteAtomically(target, '{"verified":true}');

      const raw = await readFile(target, "utf-8");
      expect(JSON.parse(raw)).toEqual({ verified: true });

      // No tmp residue left behind
      const files = await readdir(join(tempDir, "nested"));
      expect(files.every((f) => !f.includes(".tmp."))).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("overwrites previous snapshots atomically", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "promo2-test-"));
    try {
      const target = join(tempDir, "snap.json");
      await promoteAtomically(target, '{"v":1}');
      await promoteAtomically(target, '{"v":2}');
      expect(JSON.parse(await readFile(target, "utf-8"))).toEqual({ v: 2 });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
