import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  unlink,
  stat,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createLogger, type Logger } from "../logger/index.js";

export interface StorageManagerConfig {
  readonly root: string;
  readonly maxCacheSize?: number;
  readonly maxCacheEntries?: number;
  readonly tmpTtlMs?: number;
}

export interface StoragePaths {
  readonly root: string;
  readonly cache: string;
  readonly tmp: string;
  readonly snapshots: string;
  readonly database: string;
  readonly reports: string;
  readonly logs: string;
  readonly locks: string;
  readonly state: string;
}

export interface DirectoryStats {
  readonly sizeBytes: number;
  readonly fileCount: number;
}

export interface StorageStats {
  readonly root: string;
  readonly totalSizeBytes: number;
  readonly directories: Readonly<
    Record<keyof Omit<StoragePaths, "root">, DirectoryStats>
  >;
}

interface CacheEntryMeta {
  readonly key: string;
  readonly filePath: string;
  readonly cachedAt: string;
  readonly lastAccessedAt: string;
  readonly size: number;
}

interface CacheManifest {
  readonly version: number;
  readonly entries: ReadonlyArray<CacheEntryMeta>;
}

const CACHE_MANIFEST_VERSION = 1;
const CACHE_MANIFEST_FILE = "cache-manifest.json";

const DEFAULT_MAX_CACHE_SIZE = 100 * 1024 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 1000;
const DEFAULT_TMP_TTL_MS = 60 * 60 * 1000;

/**
 * Centralized storage manager for all `.vetwo/marketplace/` state.
 *
 * Provides:
 * - Typed path resolution for every managed subdirectory
 * - Idempotent directory initialization
 * - LRU cache eviction by access time and count
 * - Automatic cleanup of stale tmp/ files
 * - Atomic file writes (write-to-temp then rename)
 * - Per-directory size and entry tracking
 */
export class StorageManager {
  readonly paths: StoragePaths;
  private readonly _logger: Logger;
  private readonly _maxCacheSize: number;
  private readonly _maxCacheEntries: number;
  private readonly _tmpTtlMs: number;
  private _initialized = false;

  constructor(config: StorageManagerConfig, logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "storage" });
    this._maxCacheSize = config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
    this._maxCacheEntries = config.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    this._tmpTtlMs = config.tmpTtlMs ?? DEFAULT_TMP_TTL_MS;

    this.paths = {
      root: config.root,
      cache: join(config.root, "cache"),
      tmp: join(config.root, "tmp"),
      snapshots: join(config.root, "snapshots"),
      database: join(config.root, "database"),
      reports: join(config.root, "reports"),
      logs: join(config.root, "logs"),
      locks: join(config.root, "locks"),
      state: join(config.root, "state"),
    };
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;

    await this._ensureDir(this.paths.root);
    await this._ensureDir(this.paths.tmp);
    await this._cleanStaleTmpFiles();

    this._initialized = true;
    this._logger.debug("Storage manager initialized", {
      root: this.paths.root,
    });
  }

  async ensureSubdir(name: keyof Omit<StoragePaths, "root">): Promise<string> {
    const dir = this.paths[name];
    await this._ensureDir(dir);
    return dir;
  }

  // ── Atomic Writes ─────────────────────────────────────────────────

  async writeAtomic(filePath: string, data: string): Promise<void> {
    const lastSlash = filePath.lastIndexOf("/");
    const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash) : ".";
    await this._ensureDir(dir);

    const tmpName = `${Date.now()}-${Math.random().toString(36).slice(2)}.atomic`;
    const tmpPath = join(this.paths.tmp, tmpName);

    try {
      await writeFile(tmpPath, data, "utf-8");
      await rename(tmpPath, filePath);
    } catch (error) {
      await unlink(tmpPath).catch(() => {});
      throw error;
    }
  }

  // ── Cache Operations (LRU) ────────────────────────────────────────

  async cacheGet<T>(category: string, key: string): Promise<T | null> {
    const categoryDir = join(this.paths.cache, category);
    const manifest = await this._readCacheManifest(categoryDir);
    const entry = manifest.entries.find((e) => e.key === key);
    if (entry === undefined) return null;

    try {
      const content = await readFile(entry.filePath, "utf-8");
      await this.cacheTouch(category, key);
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async cacheSet(
    category: string,
    key: string,
    data: unknown,
  ): Promise<string> {
    const content = JSON.stringify(data);
    const size = Buffer.byteLength(content, "utf-8");
    const filePath = await this._cacheAcquire(category, key, size);
    await writeFile(filePath, content, "utf-8");
    return filePath;
  }

  async cacheTouch(category: string, key: string): Promise<void> {
    const categoryDir = join(this.paths.cache, category);
    const manifest = await this._readCacheManifest(categoryDir);
    const idx = manifest.entries.findIndex((e) => e.key === key);
    if (idx < 0) return;

    const entry = manifest.entries[idx]!;
    const updatedEntry: CacheEntryMeta = {
      ...entry,
      lastAccessedAt: new Date().toISOString(),
    };

    const updatedManifest: CacheManifest = {
      version: CACHE_MANIFEST_VERSION,
      entries: [
        ...manifest.entries.slice(0, idx),
        updatedEntry,
        ...manifest.entries.slice(idx + 1),
      ],
    };

    await this._writeCacheManifest(categoryDir, updatedManifest);
  }

  async cacheEvict(category: string, key: string): Promise<boolean> {
    const categoryDir = join(this.paths.cache, category);
    const manifest = await this._readCacheManifest(categoryDir);
    const idx = manifest.entries.findIndex((e) => e.key === key);
    if (idx < 0) return false;

    const entry = manifest.entries[idx]!;
    await unlink(entry.filePath).catch(() => {});

    const updatedManifest: CacheManifest = {
      version: CACHE_MANIFEST_VERSION,
      entries: [
        ...manifest.entries.slice(0, idx),
        ...manifest.entries.slice(idx + 1),
      ],
    };

    await this._writeCacheManifest(categoryDir, updatedManifest);
    return true;
  }

  async cacheHas(
    category: string,
    key: string,
  ): Promise<{ exists: boolean; filePath: string | null }> {
    const categoryDir = join(this.paths.cache, category);
    const manifest = await this._readCacheManifest(categoryDir);
    const entry = manifest.entries.find((e) => e.key === key);
    if (entry === undefined) return { exists: false, filePath: null };
    return { exists: true, filePath: entry.filePath };
  }

  async cacheClear(): Promise<void> {
    try {
      await rm(this.paths.cache, { recursive: true, force: true });
    } catch {
      // ignore
    }
    this._logger.info("Cache cleared");
  }

  async cacheStats(): Promise<{
    totalEntries: number;
    totalSizeBytes: number;
    categories: ReadonlyArray<{
      name: string;
      entries: number;
      sizeBytes: number;
    }>;
  }> {
    let cacheDir: string[];
    try {
      cacheDir = await readdir(this.paths.cache);
    } catch {
      return { totalEntries: 0, totalSizeBytes: 0, categories: [] };
    }

    let totalEntries = 0;
    let totalSizeBytes = 0;
    const categories: Array<{
      name: string;
      entries: number;
      sizeBytes: number;
    }> = [];

    for (const cat of cacheDir) {
      const catDir = join(this.paths.cache, cat);
      try {
        const s = await stat(catDir);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const manifest = await this._readCacheManifest(catDir);
      let catSize = 0;
      for (const entry of manifest.entries) {
        catSize += entry.size;
      }
      totalEntries += manifest.entries.length;
      totalSizeBytes += catSize;
      categories.push({
        name: cat,
        entries: manifest.entries.length,
        sizeBytes: catSize,
      });
    }

    return { totalEntries, totalSizeBytes, categories };
  }

  // ── Tmp Management ────────────────────────────────────────────────

  async createTmpDir(prefix: string): Promise<string> {
    const dirName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dirPath = join(this.paths.tmp, dirName);
    await this._ensureDir(dirPath);
    return dirPath;
  }

  async createTmpFile(
    prefix: string,
    data: string,
  ): Promise<{ tmpPath: string; cleanup: () => Promise<void> }> {
    const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tmpPath = join(this.paths.tmp, fileName);
    await writeFile(tmpPath, data, "utf-8");

    return {
      tmpPath,
      cleanup: async () => {
        await unlink(tmpPath).catch(() => {});
      },
    };
  }

  async moveTmpToTarget(tmpPath: string, targetPath: string): Promise<void> {
    const lastSlash = targetPath.lastIndexOf("/");
    const dir = lastSlash >= 0 ? targetPath.substring(0, lastSlash) : ".";
    await this._ensureDir(dir);
    await rename(tmpPath, targetPath);
  }

  async cleanTmpDir(): Promise<number> {
    return this._cleanStaleTmpFiles();
  }

  // ── Stats & Diagnostics ───────────────────────────────────────────

  async directoryStats(dirPath: string): Promise<DirectoryStats> {
    let sizeBytes = 0;
    let fileCount = 0;

    try {
      const entries = await readdir(dirPath);
      for (const entry of entries) {
        try {
          const s = await stat(join(dirPath, entry));
          if (s.isFile()) {
            sizeBytes += s.size;
            fileCount++;
          }
        } catch {
          // ignore individual entry errors
        }
      }
    } catch {
      // directory doesn't exist
    }

    return { sizeBytes, fileCount };
  }

  async stats(): Promise<StorageStats> {
    const dirNames = [
      "cache",
      "tmp",
      "snapshots",
      "database",
      "reports",
      "logs",
      "locks",
      "state",
    ] as const;

    const dirStats: Record<string, DirectoryStats> = {};
    let totalSizeBytes = 0;

    for (const name of dirNames) {
      const ds = await this.directoryStats(this.paths[name]);
      dirStats[name] = ds;
      totalSizeBytes += ds.sizeBytes;
    }

    return {
      root: this.paths.root,
      totalSizeBytes,
      directories: dirStats as Readonly<
        Record<keyof Omit<StoragePaths, "root">, DirectoryStats>
      >,
    };
  }

  async destroy(): Promise<void> {
    try {
      await rm(this.paths.root, { recursive: true, force: true });
      this._initialized = false;
      this._logger.info("Storage destroyed", { root: this.paths.root });
    } catch (error) {
      this._logger.error("Failed to destroy storage", {
        root: this.paths.root,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ── Private Helpers ───────────────────────────────────────────────

  private async _ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private _hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
  }

  private async _readCacheManifest(
    categoryDir: string,
  ): Promise<CacheManifest> {
    const manifestPath = join(categoryDir, CACHE_MANIFEST_FILE);
    try {
      const content = await readFile(manifestPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "entries" in parsed &&
        Array.isArray((parsed as Record<string, unknown>).entries)
      ) {
        return parsed as CacheManifest;
      }
    } catch {
      // Missing or corrupt manifest
    }
    return { version: CACHE_MANIFEST_VERSION, entries: [] };
  }

  private async _writeCacheManifest(
    categoryDir: string,
    manifest: CacheManifest,
  ): Promise<void> {
    const manifestPath = join(categoryDir, CACHE_MANIFEST_FILE);
    await this._ensureDir(categoryDir);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  private async _cacheAcquire(
    category: string,
    key: string,
    size: number,
  ): Promise<string> {
    const categoryDir = join(this.paths.cache, category);
    await this._ensureDir(categoryDir);

    const manifest = await this._readCacheManifest(categoryDir);
    const hashedName = this._hashKey(key);
    const filePath = join(categoryDir, `${hashedName}.json`);

    const now = new Date().toISOString();
    const existing = manifest.entries.find((e) => e.key === key);
    const entry: CacheEntryMeta = {
      key,
      filePath,
      cachedAt: existing?.cachedAt ?? now,
      lastAccessedAt: now,
      size,
    };

    const withoutEntry = manifest.entries.filter((e) => e.key !== key);
    let updatedManifest: CacheManifest = {
      version: CACHE_MANIFEST_VERSION,
      entries: [...withoutEntry, entry],
    };

    if (updatedManifest.entries.length > this._maxCacheEntries) {
      updatedManifest = await this._evictLruByCount(updatedManifest);
    }

    const totalSize = updatedManifest.entries.reduce(
      (sum, e) => sum + e.size,
      0,
    );
    if (totalSize > this._maxCacheSize) {
      updatedManifest = await this._evictLruBySize(updatedManifest);
    }

    await this._writeCacheManifest(categoryDir, updatedManifest);
    return filePath;
  }

  private _sortByLru(manifest: CacheManifest): Array<CacheEntryMeta> {
    return [...manifest.entries].sort(
      (a, b) =>
        new Date(a.lastAccessedAt).getTime() -
        new Date(b.lastAccessedAt).getTime(),
    );
  }

  private async _evictLruByCount(
    manifest: CacheManifest,
  ): Promise<CacheManifest> {
    const sorted = this._sortByLru(manifest);
    const toEvict = sorted.slice(0, sorted.length - this._maxCacheEntries);

    for (const entry of toEvict) {
      await unlink(entry.filePath).catch(() => {});
      this._logger.debug("LRU eviction (count)", { key: entry.key });
    }

    const evictedKeys = new Set(toEvict.map((e) => e.key));
    return {
      version: CACHE_MANIFEST_VERSION,
      entries: manifest.entries.filter((e) => !evictedKeys.has(e.key)),
    };
  }

  private async _evictLruBySize(
    manifest: CacheManifest,
  ): Promise<CacheManifest> {
    let currentTotal = manifest.entries.reduce((sum, e) => sum + e.size, 0);
    const sorted = this._sortByLru(manifest);
    const toEvict: CacheEntryMeta[] = [];

    for (const entry of sorted) {
      if (currentTotal <= this._maxCacheSize) break;
      toEvict.push(entry);
      currentTotal -= entry.size;
    }

    for (const entry of toEvict) {
      await unlink(entry.filePath).catch(() => {});
      this._logger.debug("LRU eviction (size)", {
        key: entry.key,
        size: entry.size,
      });
    }

    const evictedKeys = new Set(toEvict.map((e) => e.key));
    return {
      version: CACHE_MANIFEST_VERSION,
      entries: manifest.entries.filter((e) => !evictedKeys.has(e.key)),
    };
  }

  private async _cleanStaleTmpFiles(): Promise<number> {
    let files: string[];
    try {
      files = await readdir(this.paths.tmp);
    } catch {
      return 0;
    }

    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = join(this.paths.tmp, file);
      try {
        const s = await stat(filePath);
        if (!s.isFile()) continue;

        const age = now - s.mtimeMs;
        if (age > this._tmpTtlMs) {
          await unlink(filePath);
          cleaned++;
        }
      } catch {
        // ignore individual file errors
      }
    }

    if (cleaned > 0) {
      this._logger.debug(`Cleaned ${cleaned} stale tmp files`);
    }

    return cleaned;
  }
}

export function createStorageManager(
  config: StorageManagerConfig,
  logger?: Logger,
): StorageManager {
  return new StorageManager(config, logger);
}
