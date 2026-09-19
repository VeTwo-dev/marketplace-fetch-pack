import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type Logger } from "../logger/index.js";

/**
 * Schema version of the current state format.
 * Bump when the state layout changes incompatibly.
 */
export const STATE_SCHEMA_VERSION = 1;

export interface MarketplaceStatePaths {
  /** Root: .vetwo/marketplace/ */
  readonly root: string;
  /** .vetwo/marketplace/cache/ */
  readonly cache: string;
  /** .vetwo/marketplace/database/ */
  readonly database: string;
  /** .vetwo/marketplace/snapshots/ */
  readonly snapshots: string;
  /** .vetwo/marketplace/resources/ — installed resources destination */
  readonly resources: string;
  /** .vetwo/marketplace/locks/ */
  readonly locks: string;
  /** .vetwo/marketplace/reports/ */
  readonly reports: string;
  /** .vetwo/marketplace/logs/ */
  readonly logs: string;
  /** .vetwo/marketplace/tmp/ */
  readonly tmp: string;
  /** .vetwo/marketplace/state/ */
  readonly state: string;
  /** .vetwo/marketplace/indexes/ — persistent registry index */
  readonly indexes: string;
  /** .vetwo/marketplace/transactions/ — installation transactions */
  readonly transactions: string;
  /** .vetwo/marketplace/plugins/ — namespaced plugin state */
  readonly plugins: string;
}

/**
 * Resolves the state root relative to a project root.
 * Default: <projectRoot>/.vetwo/marketplace/
 */
export function resolveStateRoot(projectRoot: string): string {
  return join(projectRoot, ".vetwo", "marketplace");
}

/**
 * Builds all derived paths from a state root.
 */
export function resolveStatePaths(stateRoot: string): MarketplaceStatePaths {
  return Object.freeze({
    root: stateRoot,
    cache: join(stateRoot, "cache"),
    database: join(stateRoot, "database"),
    snapshots: join(stateRoot, "snapshots"),
    resources: join(stateRoot, "resources"),
    locks: join(stateRoot, "locks"),
    reports: join(stateRoot, "reports"),
    logs: join(stateRoot, "logs"),
    tmp: join(stateRoot, "tmp"),
    state: join(stateRoot, "state"),
    indexes: join(stateRoot, "indexes"),
    transactions: join(stateRoot, "transactions"),
    plugins: join(stateRoot, "plugins"),
  });
}

/**
 * Central Marketplace State Manager.
 *
 * Provides:
 * - Typed path resolution for all Marketplace runtime state
 * - Idempotent directory initialization
 * - Atomic file writes (write-to-temp → rename)
 * - File locking foundation
 * - State version metadata
 */
export class MarketplaceStateManager {
  readonly paths: MarketplaceStatePaths;
  private readonly _logger: Logger;
  private _initialized = false;

  constructor(projectRoot: string, logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "state" });
    this.paths = resolveStatePaths(resolveStateRoot(projectRoot));
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Initialize the state root directory and all subdirectories.
   * Safe to call multiple times (idempotent).
   * Does NOT create directories that the caller doesn't need yet.
   * Only creates the root directory.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    await this._ensureDir(this.paths.root);
    this._initialized = true;
    this._logger.debug("State manager initialized", {
      root: this.paths.root,
    });
  }

  /**
   * Ensure a specific subdirectory exists.
   * Call this when a subsystem needs its directory.
   */
  async ensureSubdir(
    subdir: keyof Omit<MarketplaceStatePaths, "root">,
  ): Promise<string> {
    const dir = this.paths[subdir];
    await this._ensureDir(dir);
    return dir;
  }

  /**
   * Write a file atomically: write to a temp file in the same directory,
   * then rename. Prevents partial writes on crash.
   */
  async writeAtomic(filePath: string, data: string): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    await this._ensureDir(dir);

    const tmpPath = join(
      this.paths.tmp,
      `${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );

    try {
      await this._ensureDir(this.paths.tmp);
      await writeFile(tmpPath, data, "utf-8");
      await rename(tmpPath, filePath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tmpPath).catch(() => {});
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Acquire an exclusive file lock.
   * Returns a release function. Throws if lock cannot be acquired.
   */
  async acquireLock(
    name: string,
    timeoutMs: number = 10_000,
  ): Promise<() => Promise<void>> {
    const lockDir = await this.ensureSubdir("locks");
    const lockFile = join(lockDir, `${name}.lock`);
    const lockContent = `${process.pid}\n${new Date().toISOString()}`;

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        await writeFile(lockFile, lockContent, { flag: "wx" });
        return async () => {
          try {
            const { unlink } = await import("node:fs/promises");
            await unlink(lockFile);
          } catch {
            // ignore — lock may already be gone
          }
        };
      } catch {
        // Lock exists — check if stale
        if (await this._isStaleLock(lockFile)) {
          try {
            const { unlink } = await import("node:fs/promises");
            await unlink(lockFile);
          } catch {
            // another process may have acquired it
          }
          continue;
        }
        // Wait and retry
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    throw new Error(`Could not acquire lock "${name}" after ${timeoutMs}ms`);
  }

  /**
   * Read the state metadata file.
   */
  async readMeta(): Promise<StateMeta | null> {
    const metaPath = join(this.paths.state, "meta.json");
    try {
      const content = await readFile(metaPath, "utf-8");
      return JSON.parse(content) as StateMeta;
    } catch {
      return null;
    }
  }

  /**
   * Write the state metadata file.
   */
  async writeMeta(meta: StateMeta): Promise<void> {
    const metaPath = join(this.paths.state, "meta.json");
    await this.writeAtomic(metaPath, JSON.stringify(meta, null, 2));
  }

  /**
   * Ensure state meta exists with the current schema version.
   */
  async ensureMeta(): Promise<StateMeta> {
    let meta = await this.readMeta();
    if (meta === null) {
      meta = {
        schemaVersion: STATE_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.writeMeta(meta);
      return meta;
    }
    if (meta.schemaVersion !== STATE_SCHEMA_VERSION) {
      // Simple migration: bump version, preserve timestamps, do not crash
      const migrated: StateMeta = {
        schemaVersion: STATE_SCHEMA_VERSION,
        createdAt: meta.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await this.writeMeta(migrated);
      this._logger.info("Migrated state schema", {
        from: meta.schemaVersion,
        to: STATE_SCHEMA_VERSION,
      });
      return migrated;
    }
    return meta;
  }

  private async _ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private async _isStaleLock(lockFile: string): Promise<boolean> {
    try {
      const content = await readFile(lockFile, "utf-8");
      const pid = parseInt(content.split("\n")[0] ?? "", 10);
      if (isNaN(pid)) return true;

      // Check if process is still alive
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    } catch {
      return true;
    }
  }
}

export interface StateMeta {
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Convenience factory.
 */
export function createStateManager(
  projectRoot: string,
  logger?: Logger,
): MarketplaceStateManager {
  return new MarketplaceStateManager(projectRoot, logger);
}
