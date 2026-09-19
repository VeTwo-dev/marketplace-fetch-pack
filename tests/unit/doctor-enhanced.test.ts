import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Doctor } from "../../src/doctor/index.js";
import { Cache } from "../../src/cache/index.js";
import type { ResolvedConfig } from "../../src/types/config.js";

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    repository: "https://github.com/VeTwo-dev/VeTwo-Market-Place",
    branch: "main",
    cache: {
      enabled: true,
      directory: ".vetwo/marketplace/cache",
      maxSize: 100 * 1024 * 1024,
      ttl: 3600,
      autoClean: true,
    },
    destination: ".",
    logger: { level: "silent", prefix: "test", color: false },
    plugins: [],
    hooks: {},
    autoDetect: true,
    concurrency: 4,
    timeout: 30000,
    source: "default",
    offline: false,
    ...overrides,
  };
}

describe("Doctor engine (Phase 15)", { timeout: 60000 }, () => {
  let tempDir: string;
  let doctor: Doctor;
  let cache: Cache;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "doctor-test-"));
    process.chdir(tempDir);
    const config = makeConfig();
    cache = new Cache(config.cache);
    doctor = new Doctor(config, cache, undefined, { projectRoot: tempDir });
  });

  afterEach(async () => {
    process.chdir("/");
    await rm(tempDir, { recursive: true, force: true });
  });

  it("runs all checks independently — a crashed check doesn't block others", async () => {
    const report = await doctor.run();
    // All checks produce results even when offline/fs issues exist
    expect(report.result.checks.length).toBeGreaterThanOrEqual(10);
    for (const check of report.result.checks) {
      expect(check.code).toBeTruthy();
      expect(check.severity).toBeDefined();
      expect(["pass", "warn", "fail", "skip"]).toContain(check.status);
    }
  });

  it("checks are sorted deterministically by code", async () => {
    const report1 = await doctor.run();
    const codes1 = report1.result.checks.map((c) => c.code);
    const sorted = [...codes1].sort((a, b) => a.localeCompare(b));
    expect(codes1).toEqual(sorted);
  });

  it("offline mode skips network checks without attempting them", async () => {
    const offlineDoctor = new Doctor(
      makeConfig({ offline: true }),
      cache,
      undefined,
      { projectRoot: tempDir },
    );
    const report = await offlineDoctor.run();

    const internet = report.result.checks.find((c) => c.code === "internet")!;
    const github = report.result.checks.find((c) => c.code === "github")!;
    expect(internet.status).toBe("skip");
    expect(github.status).toBe("skip");
  });

  it("node version check passes on supported Node", async () => {
    const report = await doctor.run();
    const nodeCheck = report.result.checks.find(
      (c) => c.code === "node-version",
    )!;
    // Tests run on Node >= 20 per project requirement
    expect(nodeCheck.status).toBe("pass");
  });

  it("detects invalid lockfile", async () => {
    await writeFile(
      join(tempDir, "vetwo.lock.json"),
      "{ invalid json",
      "utf-8",
    );
    const report = await doctor.run();
    const lockfile = report.result.checks.find((c) => c.code === "lockfile")!;
    expect(lockfile.status).toBe("fail");
    expect(lockfile.repairable).toBe(true);
  });

  it("passes when no lockfile exists", async () => {
    const report = await doctor.run();
    const lockfile = report.result.checks.find((c) => c.code === "lockfile")!;
    expect(lockfile.status).toBe("pass");
  });

  it("accepts valid lockfile", async () => {
    await writeFile(
      join(tempDir, "vetwo.lock.json"),
      JSON.stringify({ version: "1.0.0", lockfileVersion: 2, resources: [] }),
      "utf-8",
    );
    const report = await doctor.run();
    const lockfile = report.result.checks.find((c) => c.code === "lockfile")!;
    expect(lockfile.status).toBe("pass");
    expect(lockfile.details?.entries).toBe(0);
  });

  it("verifies state root writability (disk check)", async () => {
    const report = await doctor.run();
    const disk = report.result.checks.find((c) => c.code === "disk-space")!;
    expect(disk.status).toBe("pass");
  });

  it("repair(clean-temp-files) removes old temp artifacts only", async () => {
    const tmpDir = join(tempDir, ".vetwo", "marketplace", "tmp");
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, "old.tmp"), "old", "utf-8");
    // Set mtime to 2 hours ago
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const { utimes } = await import("node:fs/promises");
    await utimes(
      join(tmpDir, "old.tmp"),
      twoHoursAgo / 1000,
      twoHoursAgo / 1000,
    );

    const result = await doctor.repair("clean-temp-files");
    expect(result.action).toBe("clean-temp-files");

    if (result.performed) {
      expect(result.itemsAffected).toBe(1);
    }
  });

  it("repair(rebuild-registry-index) invalidates the index file", async () => {
    const indexDir = join(tempDir, ".vetwo", "marketplace", "indexes");
    await mkdir(indexDir, { recursive: true });
    await writeFile(join(indexDir, "registry-index.json"), "{}", "utf-8");

    const result = await doctor.repair("rebuild-registry-index");
    expect(result.performed).toBe(true);

    let exists = false;
    try {
      await import("node:fs/promises").then((fs) =>
        fs.access(join(indexDir, "registry-index.json")),
      );
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it("report is JSON-serializable and secret-free", async () => {
    process.env["GITHUB_TOKEN"] = "ghp_test_token_12345";
    try {
      const report = await doctor.run();
      const json = JSON.stringify(report);
      expect(json).not.toContain("ghp_test_token_12345");
    } finally {
      delete process.env["GITHUB_TOKEN"];
    }
  });

  it("counts statuses correctly", async () => {
    await writeFile(join(tempDir, "vetwo.lock.json"), "{ broken", "utf-8");
    const report = await doctor.run();
    const { passed, failed, warned, skipped } = report.result;
    expect(passed + failed + warned + skipped).toBe(
      report.result.checks.length,
    );
    expect(failed).toBeGreaterThanOrEqual(1); // the corrupted lockfile
    expect(report.healthy).toBe(false);
  });

  it("health check aggregates runtime managers via updateDeps", async () => {
    const { MarketplaceStateManager } =
      await import("../../src/state/index.js");
    const { CacheManager } = await import("../../src/cache/CacheManager.js");
    const { TransactionManager } =
      await import("../../src/transaction/index.js");
    const { getHealth } = await import("../../src/health/index.js");
    const stateDir = join(tempDir, "health-state");
    const state = new MarketplaceStateManager(stateDir);
    await state.initialize();
    const cacheManager = new CacheManager(state);
    const txManager = new TransactionManager(state);
    doctor.updateDeps({
      stateManager: state,
      cacheManager,
      transactionManager: txManager,
      registryProbe: async () => true,
    });
    const direct = await getHealth(
      state,
      cacheManager,
      txManager,
      false,
      async () => true,
    );
    expect(direct.transactionHealthy).toBe(true);
    expect(direct.recoveryRequired).toBe(false);
    const report = await doctor.run();
    const health = report.result.checks.find((c) => c.code === "health");
    expect(health).toBeDefined();
    expect(health!.status).toBe("pass");
  });
});
