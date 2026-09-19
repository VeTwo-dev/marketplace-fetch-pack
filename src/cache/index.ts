import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CacheEntry, CacheStats } from "../types/cache.js";
import type { ResolvedCacheConfig } from "../types/config.js";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256 } from "../utils/index.js";

const CACHE_MANIFEST_FILE = "cache-manifest.json";

interface CacheManifest {
  readonly entries: ReadonlyArray<CacheManifestEntry>;
}

interface CacheManifestEntry {
  readonly key: string;
  readonly filePath: string;
  readonly cachedAt: string;
  readonly expiresAt: string;
  readonly size: number;
  readonly category: string;
}

export class Cache {
  private _config: ResolvedCacheConfig;
  private readonly _logger: Logger;
  private _manifest: CacheManifest;
  private _hits = 0;
  private _misses = 0;

  constructor(config: ResolvedCacheConfig, logger?: Logger) {
    this._config = config;
    this._logger = logger ?? createLogger({ prefix: "cache" });
    this._manifest = { entries: [] };
  }

  get enabled(): boolean {
    return this._config.enabled;
  }

  async initialize(): Promise<void> {
    if (!this._config.enabled) return;

    const cacheDir = this._getCacheDir();
    await mkdir(cacheDir, { recursive: true });

    const manifestPath = join(cacheDir, CACHE_MANIFEST_FILE);
    try {
      const content = await readFile(manifestPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (this._isCacheManifest(parsed)) {
        this._manifest = parsed;
      }
    } catch {
      this._manifest = { entries: [] };
    }

    if (this._config.autoClean) {
      await this._cleanExpired();
    }
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    if (!this._config.enabled) {
      this._misses++;
      return null;
    }

    const entry = this._manifest.entries.find((e) => e.key === key);
    if (entry === undefined) {
      this._misses++;
      this._logger.debug(`Cache miss: ${key}`);
      return null;
    }

    const expiresAt = new Date(entry.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt < new Date()) {
      this._misses++;
      this._logger.debug(`Cache expired: ${key}`);
      return null;
    }

    try {
      const filePath = this._getEntryPath(entry);
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content) as T;
      this._hits++;
      this._logger.debug(`Cache hit: ${key}`);
      return {
        key,
        data,
        cachedAt: entry.cachedAt,
        expiresAt: entry.expiresAt,
        size: entry.size,
      };
    } catch {
      this._misses++;
      this._logger.warn(`Cache read error for key: ${key}`);
      return null;
    }
  }

  async set<T>(
    key: string,
    data: T,
    category: string = "general",
  ): Promise<void> {
    if (!this._config.enabled) return;

    const content = JSON.stringify(data);
    const size = Buffer.byteLength(content, "utf-8");

    if (size > this._config.maxSize) {
      this._logger.warn(`Cache entry too large: ${key} (${size} bytes)`);
      return;
    }

    const cacheDir = this._getCacheDir();
    const categoryDir = join(cacheDir, category);
    await mkdir(categoryDir, { recursive: true });

    const filePath = join(categoryDir, `${this._hashKey(key)}.json`);
    await writeFile(filePath, content, "utf-8");

    const now = new Date();
    // Defensive: invalid/unset TTL must never corrupt cache metadata
    const ttlMs =
      typeof this._config.ttl === "number" && Number.isFinite(this._config.ttl)
        ? this._config.ttl
        : 3600_000;
    const expiresAt = new Date(now.getTime() + ttlMs);

    const existingIndex = this._manifest.entries.findIndex(
      (e) => e.key === key,
    );
    const newEntry: CacheManifestEntry = {
      key,
      filePath,
      cachedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      size,
      category,
    };

    if (existingIndex >= 0) {
      const old = this._manifest.entries[existingIndex]!;
      const oldPath = this._getEntryPath(old);
      try {
        await rm(oldPath, { force: true });
      } catch {
        // ignore
      }
      this._manifest = {
        entries: [
          ...this._manifest.entries.slice(0, existingIndex),
          newEntry,
          ...this._manifest.entries.slice(existingIndex + 1),
        ],
      };
    } else {
      this._manifest = {
        entries: [...this._manifest.entries, newEntry],
      };
    }

    await this._saveManifest();
    this._logger.debug(`Cache set: ${key} (${size} bytes)`);
  }

  async has(key: string): Promise<boolean> {
    const entry = this._manifest.entries.find((e) => e.key === key);
    if (entry === undefined) return false;
    return new Date(entry.expiresAt) >= new Date();
  }

  async delete(key: string): Promise<boolean> {
    const index = this._manifest.entries.findIndex((e) => e.key === key);
    if (index < 0) return false;

    const entry = this._manifest.entries[index]!;
    const filePath = this._getEntryPath(entry);
    try {
      await rm(filePath, { force: true });
    } catch {
      // ignore
    }

    this._manifest = {
      entries: [
        ...this._manifest.entries.slice(0, index),
        ...this._manifest.entries.slice(index + 1),
      ],
    };

    await this._saveManifest();
    return true;
  }

  async clear(): Promise<void> {
    const cacheDir = this._getCacheDir();
    try {
      await rm(cacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    this._manifest = { entries: [] };
    this._hits = 0;
    this._misses = 0;
    this._logger.info("Cache cleared");
  }

  async stats(): Promise<CacheStats> {
    const entries = this._manifest.entries.length;
    const totalSize = this._manifest.entries.reduce(
      (sum, e) => sum + e.size,
      0,
    );
    const totalRequests = this._hits + this._misses;
    const hitRate = totalRequests > 0 ? this._hits / totalRequests : 0;

    let oldestEntry: string | null = null;
    let newestEntry: string | null = null;
    let registryEntries = 0;
    let manifestEntries = 0;
    let downloadEntries = 0;

    for (const entry of this._manifest.entries) {
      if (oldestEntry === null || entry.cachedAt < oldestEntry) {
        oldestEntry = entry.cachedAt;
      }
      if (newestEntry === null || entry.cachedAt > newestEntry) {
        newestEntry = entry.cachedAt;
      }
      if (entry.category === "registry") registryEntries++;
      else if (entry.category === "manifest") manifestEntries++;
      else if (entry.category === "download") downloadEntries++;
    }

    return {
      entries,
      totalSize,
      hitRate,
      oldestEntry,
      newestEntry,
      registryEntries,
      manifestEntries,
      downloadEntries,
    };
  }

  updateConfig(config: Partial<ResolvedCacheConfig>): void {
    this._config = { ...this._config, ...config };
  }

  private _getCacheDir(): string {
    return this._config.directory;
  }

  private _getEntryPath(entry: CacheManifestEntry): string {
    return entry.filePath;
  }

  private _hashKey(key: string): string {
    return sha256(key).slice(0, 16);
  }

  private async _saveManifest(): Promise<void> {
    const cacheDir = this._getCacheDir();
    const manifestPath = join(cacheDir, CACHE_MANIFEST_FILE);
    try {
      await writeFile(
        manifestPath,
        JSON.stringify(this._manifest, null, 2),
        "utf-8",
      );
    } catch {
      this._logger.warn("Failed to save cache manifest");
    }
  }

  private async _cleanExpired(): Promise<void> {
    const now = new Date();
    const expired = this._manifest.entries.filter(
      (e) => new Date(e.expiresAt) < now,
    );

    for (const entry of expired) {
      try {
        await rm(entry.filePath, { force: true });
      } catch {
        // ignore
      }
    }

    if (expired.length > 0) {
      this._manifest = {
        entries: this._manifest.entries.filter(
          (e) => new Date(e.expiresAt) >= now,
        ),
      };
      await this._saveManifest();
      this._logger.debug(`Cleaned ${expired.length} expired cache entries`);
    }
  }

  private _isCacheManifest(value: unknown): value is CacheManifest {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return Array.isArray(obj["entries"]);
  }
}
