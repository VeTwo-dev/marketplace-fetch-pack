import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createEnhancedLockFileService,
  type LockFileValidation,
} from "../../src/lockfile/index.js";
import { createLogger } from "../../src/logger/index.js";
import type { LockFile } from "../../src/types/lockfile.js";

const logger = createLogger({ prefix: "test-lockfile-enhanced", level: "silent" });

describe("Enhanced LockFileService", () => {
  let tempDir: string;
  const service = createEnhancedLockFileService();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lockfile-enhanced-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes lockfile atomically", async () => {
    const lockfile: LockFile = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 2,
      resources: [
        {
          id: "a",
          version: "1.0.0",
          resolved: "https://example.com",
          integrity: "sha-abc",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
      ],
    };
    await service.write(tempDir, lockfile);
    const read = await service.read(tempDir);
    expect(read).not.toBeNull();
    expect(read!.resources).toHaveLength(1);
  });

  it("validates correct lockfile", async () => {
    const lockfile: LockFile = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 2,
      resources: [
        {
          id: "a",
          version: "1.0.0",
          resolved: "https://example.com",
          integrity: "sha-abc",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
      ],
    };
    await service.write(tempDir, lockfile);
    const validation = await service.validate(tempDir);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("validates missing lockfile", async () => {
    const validation = await service.validate(tempDir);
    expect(validation.valid).toBe(true);
    expect(validation.warnings).toContain("No lock file found");
  });

  it("detects invalid lockfile", async () => {
    const invalidPath = join(tempDir, "vetwo.lock.json");
    await writeFile(invalidPath, "not json", "utf-8");
    const validation = await service.validate(tempDir);
    expect(validation.valid).toBe(false);
  });

  it("detects duplicate resource ids", async () => {
    const lockfile = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 2,
      resources: [
        {
          id: "a",
          version: "1.0.0",
          resolved: "https://example.com",
          integrity: "sha-abc",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
        {
          id: "a",
          version: "2.0.0",
          resolved: "https://example.com",
          integrity: "sha-def",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
      ],
    };
    await service.write(tempDir, lockfile as LockFile);
    const validation = await service.validate(tempDir);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  it("detects migratable version", async () => {
    const lockfile = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 1,
      resources: [],
    };
    await service.write(tempDir, lockfile as LockFile);
    const validation = await service.validate(tempDir);
    expect(validation.migratable).toBe(true);
  });

  it("migrates old lockfile", async () => {
    const lockfile = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 1,
      resources: [
        {
          id: "b",
          version: "1.0.0",
          resolved: "https://example.com",
          integrity: "sha-abc",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
        {
          id: "a",
          version: "2.0.0",
          resolved: "https://example.com",
          integrity: "sha-def",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
      ],
    };
    await service.write(tempDir, lockfile as LockFile);
    const migrated = await service.migrate(tempDir);
    expect(migrated).toBe(true);
    const read = await service.read(tempDir);
    expect(read!.lockfileVersion).toBe(2);
    expect(read!.resources[0]!.id).toBe("a");
    expect(read!.resources[1]!.id).toBe("b");
  });

  it("does not migrate current version", async () => {
    const lockfile: LockFile = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 2,
      resources: [],
    };
    await service.write(tempDir, lockfile);
    const migrated = await service.migrate(tempDir);
    expect(migrated).toBe(false);
  });

  it("sorts resources deterministically", async () => {
    const lockfile = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 2,
      resources: [
        {
          id: "c",
          version: "1.0.0",
          resolved: "https://example.com",
          integrity: "sha-c",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
        {
          id: "a",
          version: "1.0.0",
          resolved: "https://example.com",
          integrity: "sha-a",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
        {
          id: "b",
          version: "1.0.0",
          resolved: "https://example.com",
          integrity: "sha-b",
          dependencies: [],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
      ],
    };
    await service.write(tempDir, lockfile as LockFile);
    const read = await service.read(tempDir);
    expect(read!.resources.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts dependencies deterministically", async () => {
    const lockfile = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: 2,
      resources: [
        {
          id: "a",
          version: "1.0.0",
          resolved: "https://example.com",
          integrity: "sha-a",
          dependencies: [
            { id: "z", version: "1.0.0" },
            { id: "a", version: "1.0.0" },
          ],
          installedAt: new Date().toISOString(),
          source: "registry",
        },
      ],
    };
    await service.write(tempDir, lockfile as LockFile);
    const read = await service.read(tempDir);
    expect(read!.resources[0]!.dependencies.map((d) => d.id)).toEqual([
      "a",
      "z",
    ]);
  });
});
