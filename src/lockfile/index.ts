import { writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type Logger } from "../logger/index.js";
import { fileExists } from "../utils/index.js";
import type {
  LockFile,
  LockEntry,
  LockFileService,
} from "../types/lockfile.js";

const LOCK_FILE_NAME = "vetwo.lock.json";
const LOCK_FILE_CURRENT_VERSION = 2;

export interface LockFileValidation {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly migratable: boolean;
}

class LockFileServiceImpl implements LockFileService {
  private readonly logger: Logger;

  constructor() {
    this.logger = createLogger({ prefix: "lockfile" });
  }

  async read(destination: string): Promise<LockFile | null> {
    const lockPath = join(destination, LOCK_FILE_NAME);
    if (!(await fileExists(lockPath))) {
      return null;
    }
    try {
      const content = await readFile(lockPath, "utf-8");
      const parsed = JSON.parse(content) as LockFile;
      return parsed;
    } catch {
      this.logger.error("Failed to parse lock file", { destination });
      return null;
    }
  }

  async write(destination: string, lockfile: LockFile): Promise<void> {
    const lockPath = join(destination, LOCK_FILE_NAME);
    const normalized = this._normalize(lockfile);
    const data = {
      ...normalized,
      generatedAt: new Date().toISOString(),
    };
    const content = JSON.stringify(data, null, 2);
    const tmpPath = `${lockPath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, content, "utf-8");
    const { rename } = await import("node:fs/promises");
    await rename(tmpPath, lockPath);
    this.logger.debug("Lock file written atomically", {
      destination,
      resourceCount: data.resources.length,
    });
  }

  async addEntry(destination: string, entry: LockEntry): Promise<void> {
    const existing = await this.read(destination);
    const resources = existing !== null ? [...existing.resources] : [];
    const idx = resources.findIndex((r) => r.id === entry.id);
    if (idx >= 0) {
      resources[idx] = entry;
    } else {
      resources.push(entry);
    }

    const lockfile: LockFile = {
      version: existing?.version ?? "1.0.0",
      generatedAt: new Date().toISOString(),
      lockfileVersion: existing?.lockfileVersion ?? LOCK_FILE_CURRENT_VERSION,
      resources: this._sortResources(resources),
    };

    await this.write(destination, lockfile);
    this.logger.debug("Lock entry added", {
      destination,
      resourceId: entry.id,
    });
  }

  async removeEntry(destination: string, resourceId: string): Promise<void> {
    const existing = await this.read(destination);
    if (existing === null) return;

    const resources = existing.resources.filter((r) => r.id !== resourceId);
    const lockfile: LockFile = {
      ...existing,
      generatedAt: new Date().toISOString(),
      resources: this._sortResources(resources),
    };

    await this.write(destination, lockfile);
    this.logger.debug("Lock entry removed", { destination, resourceId });
  }

  async hasEntry(destination: string, resourceId: string): Promise<boolean> {
    const lockfile = await this.read(destination);
    if (lockfile === null) return false;
    return lockfile.resources.some((r) => r.id === resourceId);
  }

  async getEntry(
    destination: string,
    resourceId: string,
  ): Promise<LockEntry | null> {
    const lockfile = await this.read(destination);
    if (lockfile === null) return null;
    return lockfile.resources.find((r) => r.id === resourceId) ?? null;
  }

  async clear(destination: string): Promise<void> {
    const lockPath = join(destination, LOCK_FILE_NAME);
    if (await fileExists(lockPath)) {
      await rm(lockPath);
      this.logger.info("Lock file cleared", { destination });
    }
  }

  async validate(destination: string): Promise<LockFileValidation> {
    const lockPath = join(destination, LOCK_FILE_NAME);
    if (!(await fileExists(lockPath))) {
      return {
        valid: true,
        errors: [],
        warnings: ["No lock file found"],
        migratable: false,
      };
    }

    let lockfile: LockFile;
    try {
      const content = await readFile(lockPath, "utf-8");
      lockfile = JSON.parse(content) as LockFile;
    } catch {
      return {
        valid: false,
        errors: ["Lock file is not valid JSON"],
        warnings: [],
        migratable: false,
      };
    }

    const errors: Array<string> = [];
    const warnings: Array<string> = [];

    if (typeof lockfile.version !== "string" || lockfile.version === "") {
      errors.push("Missing or invalid version field");
    }

    if (
      typeof lockfile.lockfileVersion !== "number" ||
      lockfile.lockfileVersion < 1
    ) {
      errors.push("Missing or invalid lockfileVersion field");
    }

    if (!Array.isArray(lockfile.resources)) {
      errors.push("Missing or invalid resources array");
    } else {
      const ids = new Set<string>();
      for (const entry of lockfile.resources) {
        if (typeof entry.id !== "string" || entry.id === "") {
          errors.push("Lock entry missing valid id");
        }
        if (ids.has(entry.id)) {
          errors.push(`Duplicate lock entry: ${entry.id}`);
        }
        ids.add(entry.id);

        if (typeof entry.version !== "string" || entry.version === "") {
          errors.push(`Lock entry ${entry.id} missing valid version`);
        }

        if (typeof entry.integrity !== "string") {
          warnings.push(`Lock entry ${entry.id} missing integrity`);
        }

        if (!Array.isArray(entry.dependencies)) {
          warnings.push(`Lock entry ${entry.id} missing dependencies array`);
        }
      }
    }

    const migratable =
      lockfile.lockfileVersion < LOCK_FILE_CURRENT_VERSION &&
      errors.length === 0;

    if (migratable) {
      warnings.push(
        `Lock file version ${lockfile.lockfileVersion} can be migrated to ${LOCK_FILE_CURRENT_VERSION}`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      migratable,
    };
  }

  async migrate(destination: string): Promise<boolean> {
    const lockfile = await this.read(destination);
    if (lockfile === null) return false;

    if (lockfile.lockfileVersion >= LOCK_FILE_CURRENT_VERSION) {
      return false;
    }

    const migrated: LockFile = {
      ...lockfile,
      lockfileVersion: LOCK_FILE_CURRENT_VERSION,
      resources: this._sortResources(lockfile.resources),
    };

    await this.write(destination, migrated);
    this.logger.info("Lock file migrated", {
      from: lockfile.lockfileVersion,
      to: LOCK_FILE_CURRENT_VERSION,
    });
    return true;
  }

  private _sortResources(
    resources: ReadonlyArray<LockEntry>,
  ): ReadonlyArray<LockEntry> {
    return [...resources]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({
        ...r,
        dependencies: r.dependencies
          ? [...r.dependencies].sort((a, b) => a.id.localeCompare(b.id))
          : [],
      }));
  }

  private _normalize(lockfile: LockFile): LockFile {
    return {
      version: lockfile.version,
      generatedAt: lockfile.generatedAt,
      lockfileVersion: lockfile.lockfileVersion,
      resources: this._sortResources(lockfile.resources),
    };
  }
}

export function createLockFileService(): LockFileService {
  return new LockFileServiceImpl();
}

export function createEnhancedLockFileService(): LockFileService & {
  validate(destination: string): Promise<LockFileValidation>;
  migrate(destination: string): Promise<boolean>;
} {
  return new LockFileServiceImpl();
}
