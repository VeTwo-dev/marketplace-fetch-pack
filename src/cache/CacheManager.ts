import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { MarketplaceStateManager } from "../state/index.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256 } from "../utils/index.js";
import {
  CACHE_MANIFEST_VERSION,
  type CacheEntryMeta,
  type CacheEntryState,
  type CacheLayer,
  type CacheLayerConfig,
  type CacheManagerConfig,
  type CacheManagerStats,
  type CacheManifestV2,
  type ContentAddressableRef,
} from "./types.js";

const MANIFEST_FILENAME = "cache-manifest.json";
const CAS_DIR = "cas";

const DEFAULT_LAYER_CONFIGS: Readonly<Record<CacheLayer, CacheLayerConfig>> = {
  metadata: {
    ttl: 60 * 60 * 1000,
    staleTtl: 15 * 60 * 1000,
    maxEntries: 1000,
    maxSizeBytes: 50 * 1024 * 1024,
  },
  content: {
    ttl: 60 * 60 * 24 * 1000,
    staleTtl: 60 * 60 * 1000,
    maxEntries: 500,
    maxSizeBytes: 500 * 1024 * 1024,
  },
  artifacts: {
    ttl: 60 * 60 * 24 * 7 * 1000,
    staleTtl: 60 * 60 * 24 * 1000,
    maxEntries: 200,
    maxSizeBytes: 1024 * 1024 * 1024,
  },
};

const DEFAULT_CONFIG: CacheManagerConfig = {
  metadata: DEFAULT_LAYER_CONFIGS.metadata,
  content: DEFAULT_LAYER_CONFIGS.content,
  artifacts: DEFAULT_LAYER_CONFIGS.artifacts,
  maxTotalSizeBytes: 2 * 1024 * 1024 * 1024,
  autoClean: true,
  enabled: true,
};

export interface CacheGetResult<T> {
  readonly data: T;
  readonly entry: CacheEntryMeta;
}

export interface CacheSetOptions {
  readonly contentType?: string;
  readonly source?: string;
  readonly repository?: string;
  readonly revision?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly ttlOverride?: number;
}

export class CacheManager {
  private readonly _state: MarketplaceStateManager;
  private readonly _logger: Logger;
  private _config: CacheManagerConfig;
  private _manifest: CacheManifestV2;
  private readonly _casIndex: Map<string, ContentAddressableRef>;
  private readonly _stats: {
    hits: number;
    misses: number;
    staleHits: number;
    expiredEntries: number;
    writes: number;
    invalidations: number;
    evictions: number;
    bytesRead: number;
    bytesWritten: number;
  };

  private readonly _events?: import("../events/index.js").EventBus;
  private readonly _verified = new Set<string>();
  private _touchCount = 0;
  private _manifestSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    state: MarketplaceStateManager,
    config?: Partial<CacheManagerConfig>,
    logger?: Logger,
    events?: import("../events/index.js").EventBus,
  ) {
    this._state = state;
    this._logger = logger ?? createLogger({ prefix: "cache" });
    this._events = events;
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._manifest = { version: CACHE_MANIFEST_VERSION, entries: [], cas: [] };
    this._casIndex = new Map();
    this._stats = {
      hits: 0,
      misses: 0,
      staleHits: 0,
      expiredEntries: 0,
      writes: 0,
      invalidations: 0,
      evictions: 0,
      bytesRead: 0,
      bytesWritten: 0,
    };
  }

  private _scheduleManifestSave(): void {
    if (this._manifestSaveTimer !== null) return;
    this._manifestSaveTimer = setTimeout(() => {
      this._manifestSaveTimer = null;
      this._saveManifest().catch(() => {});
    }, 200);
    this._manifestSaveTimer.unref?.();
  }

  /** Flush any pending coalesced manifest writes */
  async flush(): Promise<void> {
    if (this._manifestSaveTimer !== null) {
      clearTimeout(this._manifestSaveTimer);
      this._manifestSaveTimer = null;
    }
    await this._saveManifest();
  }

  get enabled(): boolean {
    return this._config.enabled;
  }

  get stats(): CacheManagerStats {
    return {
      hits: this._stats.hits,
      misses: this._stats.misses,
      staleHits: this._stats.staleHits,
      expiredEntries: this._stats.expiredEntries,
      writes: this._stats.writes,
      invalidations: this._stats.invalidations,
      evictions: this._stats.evictions,
      bytesRead: this._stats.bytesRead,
      bytesWritten: this._stats.bytesWritten,
      entries: this._manifest.entries,
    };
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (!this._config.enabled) return;

    await this._ensureLayerDir("metadata");
    await this._ensureLayerDir("content");
    await this._ensureLayerDir("artifacts");

    const casDir = join(this._state.paths.cache, CAS_DIR);
    await mkdir(casDir, { recursive: true });

    await this._loadManifest();
    await this._rebuildCasIndex();

    if (this._config.autoClean) {
      await this.clearExpired();
    }

    this._logger.debug("CacheManager initialized", {
      entries: this._manifest.entries.length,
      casRefs: this._casIndex.size,
    });
  }

  // ---------------------------------------------------------------------------
  // Core get / set
  // ---------------------------------------------------------------------------

  async get<T = unknown>(
    key: string,
    layer: CacheLayer,
  ): Promise<CacheGetResult<T> | null> {
    if (!this._config.enabled) {
      this._stats.misses++;
      await this._events?.emit("cacheMiss", { key }).catch(() => {});
      return null;
    }

    const entry = this._findEntry(key, layer);
    if (entry === undefined) {
      this._stats.misses++;
      this._logger.debug("Cache miss", { key, layer });
      await this._events?.emit("cacheMiss", { key }).catch(() => {});
      return null;
    }

    const state = this._entryState(entry);

    if (state === "missing") {
      this._stats.misses++;
      this._logger.debug("Cache entry missing", { key, layer });
      await this._events?.emit("cacheMiss", { key }).catch(() => {});
      return null;
    }

    if (state === "expired") {
      this._stats.misses++;
      this._stats.expiredEntries++;
      this._logger.debug("Cache entry expired", { key, layer });
      await this._events?.emit("cacheMiss", { key }).catch(() => {});
      return null;
    }

    const filePath = this._entryFilePath(entry);
    try {
      const raw = await readFile(filePath, "utf-8");

      // Validate JSON + checksum before trusting
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        await this._events
          ?.emit("cacheCorrupt", { key, layer, error: String(e) })
          .catch(() => {});
        await this._removeEntryFile(entry);
        this._stats.misses++;
        return null;
      }
      // Recompute checksum only if not recently verified
      const verifiedKey = `${layer}:${key}`;
      if (entry.checksum !== undefined && !this._verified.has(verifiedKey)) {
        const { sha256 } = await import("../utils/index.js");
        if (entry.checksum !== sha256(raw)) {
          await this._events
            ?.emit("cacheCorrupt", { key, layer, error: "checksum-mismatch" })
            .catch(() => {});
          await this._removeEntryFile(entry);
          this._stats.misses++;
          return null;
        }
      }

      this._stats.bytesRead += Buffer.byteLength(raw, "utf-8");

      // Mark verified for 5 min to skip re-hash
      if (!this._verified.has(verifiedKey)) {
        this._verified.add(verifiedKey);
        setTimeout(
          () => this._verified.delete(verifiedKey),
          5 * 60 * 1000,
        ).unref?.();
      }

      const touched = this._touchEntry(entry);
      this._replaceEntry(touched);
      // Coalesce manifest writes: batch touch updates, flush on next tick / every 10 hits
      this._touchCount++;
      if (this._touchCount % 10 === 0) await this._saveManifest();
      else this._scheduleManifestSave();

      if (state === "stale") {
        this._stats.staleHits++;
        this._logger.debug("Cache stale hit", { key, layer });
      } else {
        this._stats.hits++;
        this._logger.debug("Cache hit", { key, layer });
      }
      const age = Date.now() - new Date(entry.createdAt).getTime();
      await this._events?.emit("cacheHit", { key, age }).catch(() => {});

      const data = parsed as T;
      return { data, entry: touched };
    } catch (error) {
      this._stats.misses++;
      this._logger.warn("Cache read error", {
        key,
        layer,
        error: String(error),
      });
      await this._events
        ?.emit("cacheCorrupt", { key, layer, error: String(error) })
        .catch(() => {});
      return null;
    }
  }

  async set<T = unknown>(
    key: string,
    data: T,
    layer: CacheLayer,
    options?: CacheSetOptions,
  ): Promise<void> {
    if (!this._config.enabled) return;

    const content = JSON.stringify(data);
    const size = Buffer.byteLength(content, "utf-8");
    const checksum = sha256(content);
    const now = new Date().toISOString();
    const layerConfig = this._getLayerConfig(layer);
    const ttlMs = options?.ttlOverride ?? layerConfig.ttl;

    const filePath = this._layerFilePath(layer, `${this._hashKey(key)}.json`);

    const existingEntry = this._findEntry(key, layer);
    if (existingEntry !== undefined) {
      await this._removeEntryFile(existingEntry);
    }

    await this._atomicWrite(filePath, content);

    const entry: CacheEntryMeta = {
      key,
      layer,
      contentType: options?.contentType ?? "application/json",
      size,
      checksum,
      source: options?.source ?? "cache-manager",
      repository: options?.repository,
      revision: options?.revision,
      etag: options?.etag,
      lastModified: options?.lastModified,
      createdAt: now,
      accessedAt: now,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      metadata: options?.metadata,
    };

    this._replaceEntry(entry);
    await this._saveManifest();

    this._stats.writes++;
    this._stats.bytesWritten += size;

    this._logger.debug("Cache set", { key, layer, size, checksum });
    await this._events?.emit("cacheSet", { key, layer, size }).catch(() => {});

    await this._enforceLimits(layer);
  }

  async setRaw(
    key: string,
    content: Buffer,
    layer: CacheLayer,
    options?: CacheSetOptions,
  ): Promise<void> {
    if (!this._config.enabled) return;

    const size = content.length;
    const checksum = sha256(content);
    const now = new Date().toISOString();
    const layerConfig = this._getLayerConfig(layer);
    const ttlMs = options?.ttlOverride ?? layerConfig.ttl;

    const ext = options?.contentType === "application/gzip" ? ".gz" : ".bin";
    const filePath = this._layerFilePath(layer, `${this._hashKey(key)}${ext}`);

    const existingEntry = this._findEntry(key, layer);
    if (existingEntry !== undefined) {
      await this._removeEntryFile(existingEntry);
    }

    await this._atomicWriteBuffer(filePath, content);

    const entry: CacheEntryMeta = {
      key,
      layer,
      contentType: options?.contentType ?? "application/octet-stream",
      size,
      checksum,
      source: options?.source ?? "cache-manager",
      repository: options?.repository,
      revision: options?.revision,
      etag: options?.etag,
      lastModified: options?.lastModified,
      createdAt: now,
      accessedAt: now,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      metadata: options?.metadata,
    };

    this._replaceEntry(entry);
    await this._saveManifest();

    this._stats.writes++;
    this._stats.bytesWritten += size;

    this._logger.debug("Cache setRaw", { key, layer, size, checksum });

    await this._enforceLimits(layer);
  }

  async getRaw(key: string, layer: CacheLayer): Promise<Buffer | null> {
    if (!this._config.enabled) {
      this._stats.misses++;
      return null;
    }

    const entry = this._findEntry(key, layer);
    if (entry === undefined) {
      this._stats.misses++;
      return null;
    }

    const state = this._entryState(entry);
    if (state === "missing" || state === "expired") {
      this._stats.misses++;
      if (state === "expired") this._stats.expiredEntries++;
      return null;
    }

    const filePath = this._entryFilePath(entry);
    try {
      const buffer = await readFile(filePath);
      this._stats.bytesRead += buffer.length;

      const touched = this._touchEntry(entry);
      this._replaceEntry(touched);
      await this._saveManifest();

      if (state === "stale") {
        this._stats.staleHits++;
      } else {
        this._stats.hits++;
      }

      return buffer;
    } catch (error) {
      this._stats.misses++;
      this._logger.warn("Cache raw read error", {
        key,
        layer,
        error: String(error),
      });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  has(key: string, layer: CacheLayer): boolean {
    const entry = this._findEntry(key, layer);
    if (entry === undefined) return false;
    const state = this._entryState(entry);
    return state === "fresh" || state === "stale";
  }

  getState(key: string, layer: CacheLayer): CacheEntryState {
    const entry = this._findEntry(key, layer);
    if (entry === undefined) return "missing";
    return this._entryState(entry);
  }

  // ---------------------------------------------------------------------------
  // Invalidation
  // ---------------------------------------------------------------------------

  async invalidate(key: string): Promise<boolean> {
    const index = this._manifest.entries.findIndex((e) => e.key === key);
    if (index === -1) return false;

    const entry = this._manifest.entries[index]!;
    await this._removeEntryFile(entry);

    this._manifest = {
      ...this._manifest,
      entries: [
        ...this._manifest.entries.slice(0, index),
        ...this._manifest.entries.slice(index + 1),
      ],
    };

    this._stats.invalidations++;
    await this._saveManifest();

    this._logger.debug("Cache invalidated", { key, layer: entry.layer });
    await this._events
      ?.emit("cacheInvalidate", { key, layer: entry.layer, reason: "manual" })
      .catch(() => {});
    return true;
  }

  async invalidateLayer(layer: CacheLayer): Promise<number> {
    const layerEntries = this._manifest.entries.filter(
      (e) => e.layer === layer,
    );

    for (const entry of layerEntries) {
      await this._removeEntryFile(entry);
    }

    this._manifest = {
      ...this._manifest,
      entries: this._manifest.entries.filter((e) => e.layer !== layer),
    };

    this._stats.invalidations += layerEntries.length;
    await this._saveManifest();

    this._logger.debug("Cache layer invalidated", {
      layer,
      count: layerEntries.length,
    });
    return layerEntries.length;
  }

  async invalidateResource(resourceId: string): Promise<number> {
    const matched = this._manifest.entries.filter(
      (e) =>
        e.repository === resourceId ||
        e.key.includes(resourceId) ||
        (e.metadata !== undefined &&
          (e.metadata as Record<string, unknown>)["resourceId"] === resourceId),
    );

    for (const entry of matched) {
      await this._removeEntryFile(entry);
    }

    const matchedKeys = new Set(matched.map((e) => `${e.key}:${e.layer}`));
    this._manifest = {
      ...this._manifest,
      entries: this._manifest.entries.filter(
        (e) => !matchedKeys.has(`${e.key}:${e.layer}`),
      ),
    };

    this._stats.invalidations += matched.length;
    await this._saveManifest();

    this._logger.debug("Cache resource invalidated", {
      resourceId,
      count: matched.length,
    });
    return matched.length;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async clearExpired(): Promise<number> {
    const now = Date.now();
    const expired = this._manifest.entries.filter(
      (e) => new Date(e.expiresAt).getTime() < now,
    );

    for (const entry of expired) {
      await this._removeEntryFile(entry);
    }

    const expiredKeys = new Set(expired.map((e) => `${e.key}:${e.layer}`));
    this._manifest = {
      ...this._manifest,
      entries: this._manifest.entries.filter(
        (e) => !expiredKeys.has(`${e.key}:${e.layer}`),
      ),
    };

    if (expired.length > 0) {
      await this._saveManifest();
      this._logger.debug("Cleared expired entries", {
        count: expired.length,
      });
    }

    return expired.length;
  }

  async clearAll(): Promise<void> {
    const layers: CacheLayer[] = ["metadata", "content", "artifacts"];
    for (const layer of layers) {
      const dir = this._layerDir(layer);
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      await this._ensureLayerDir(layer);
    }

    const casDir = join(this._state.paths.cache, CAS_DIR);
    try {
      await rm(casDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await mkdir(casDir, { recursive: true });

    this._manifest = {
      version: CACHE_MANIFEST_VERSION,
      entries: [],
      cas: [],
    };
    this._casIndex.clear();
    await this._saveManifest();

    this._logger.info("Cache cleared completely");
  }

  // ---------------------------------------------------------------------------
  // getOrSet (cache-through)
  // ---------------------------------------------------------------------------

  async getOrSet<T = unknown>(
    key: string,
    factory: () => Promise<T>,
    layer: CacheLayer,
    options?: CacheSetOptions,
  ): Promise<CacheGetResult<T>> {
    // Fast path
    const existing = await this.get<T>(key, layer);
    if (existing !== null) {
      return existing;
    }

    // Stampede guard: only one process populates, others wait
    const { withStampedeGuard } = await import("./smart.js");
    const stampedeKey = `${layer}:${key}`;
    const lockDir = join(this._state.paths.locks, "cache-stampede");
    const { value: data } = await withStampedeGuard(
      { lockDir, key: stampedeKey, maxAgeMs: 30_000 },
      async () => {
        const recheck = await this.get<T>(key, layer);
        if (recheck !== null) return recheck.data;
        return factory();
      },
    );
    const after = await this.get<T>(key, layer);
    if (after !== null) return after;
    await this.set(key, data as T, layer, options);

    const entry = this._findEntry(key, layer);
    if (entry === undefined) {
      throw new MarketplaceClientError("CACHE_WRITE_ERROR", {
        context: { key, layer },
      });
    }

    return { data, entry };
  }

  // ---------------------------------------------------------------------------
  // Content-Addressable Storage
  // ---------------------------------------------------------------------------

  async storeContentAddressable(
    content: Buffer,
    layer: CacheLayer,
  ): Promise<ContentAddressableRef> {
    const hash = sha256(content);
    const size = content.length;

    const existing = this._casIndex.get(hash);
    if (existing !== undefined) {
      const updated: ContentAddressableRef = {
        ...existing,
        refCount: existing.refCount + 1,
      };
      this._casIndex.set(hash, updated);
      await this._saveCasIndex();
      this._logger.debug("CAS ref incremented", {
        sha256: hash,
        refCount: updated.refCount,
      });
      return updated;
    }

    const casDir = join(this._state.paths.cache, CAS_DIR);
    const filePath = join(casDir, `${hash}.bin`);
    await this._atomicWriteBuffer(filePath, content);

    const ref: ContentAddressableRef = {
      sha256: hash,
      size,
      refCount: 1,
    };
    this._casIndex.set(hash, ref);
    await this._saveCasIndex();

    this._logger.debug("CAS stored", { sha256: hash, size, layer });
    return ref;
  }

  async getContentAddressable(
    hash: string,
    layer: CacheLayer,
  ): Promise<Buffer | null> {
    if (!this._config.enabled) {
      this._stats.misses++;
      return null;
    }

    const ref = this._casIndex.get(hash);
    if (ref === undefined) {
      this._stats.misses++;
      this._logger.debug("CAS miss", { sha256: hash, layer });
      return null;
    }

    const casDir = join(this._state.paths.cache, CAS_DIR);
    const filePath = join(casDir, `${hash}.bin`);

    try {
      const buffer = await readFile(filePath);
      this._stats.bytesRead += buffer.length;
      this._stats.hits++;
      this._logger.debug("CAS hit", { sha256: hash, layer });
      return buffer;
    } catch (error) {
      this._stats.misses++;
      this._logger.warn("CAS read error", {
        sha256: hash,
        error: String(error),
      });
      return null;
    }
  }

  async releaseContentAddressable(hash: string): Promise<boolean> {
    const ref = this._casIndex.get(hash);
    if (ref === undefined) return false;

    if (ref.refCount <= 1) {
      this._casIndex.delete(hash);
      const casDir = join(this._state.paths.cache, CAS_DIR);
      const filePath = join(casDir, `${hash}.bin`);
      try {
        await rm(filePath, { force: true });
      } catch {
        // ignore
      }
      this._logger.debug("CAS entry removed", { sha256: hash });
    } else {
      const updated: ContentAddressableRef = {
        ...ref,
        refCount: ref.refCount - 1,
      };
      this._casIndex.set(hash, updated);
      this._logger.debug("CAS ref decremented", {
        sha256: hash,
        refCount: updated.refCount,
      });
    }

    await this._saveCasIndex();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Cleanup + orphans
  // ---------------------------------------------------------------------------

  async cleanup(): Promise<{ expired: number; orphans: number }> {
    const expired = await this.clearExpired();
    const orphans = await this._cleanupOrphans();
    return { expired, orphans };
  }

  // ---------------------------------------------------------------------------
  // Private: manifest
  // ---------------------------------------------------------------------------

  private async _loadManifest(): Promise<void> {
    const manifestPath = join(this._state.paths.cache, MANIFEST_FILENAME);
    try {
      const raw = await readFile(manifestPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (!this._isValidManifest(parsed)) {
        this._logger.warn("Invalid cache manifest, starting fresh");
        this._manifest = {
          version: CACHE_MANIFEST_VERSION,
          entries: [],
          cas: [],
        };
        return;
      }

      this._manifest = {
        version: parsed.version,
        entries: parsed.entries ?? [],
        cas: parsed.cas ?? [],
      };
    } catch {
      this._manifest = {
        version: CACHE_MANIFEST_VERSION,
        entries: [],
        cas: [],
      };
    }
  }

  private async _saveManifest(): Promise<void> {
    const manifestPath = join(this._state.paths.cache, MANIFEST_FILENAME);
    const data = JSON.stringify(this._manifest, null, 2);
    try {
      await this._atomicWrite(manifestPath, data);
    } catch (error) {
      this._logger.warn("Failed to save cache manifest", {
        error: String(error),
      });
    }
  }

  private _isValidManifest(value: unknown): value is CacheManifestV2 {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
      obj["version"] === CACHE_MANIFEST_VERSION && Array.isArray(obj["entries"])
    );
  }

  // ---------------------------------------------------------------------------
  // Private: CAS index
  // ---------------------------------------------------------------------------

  private async _rebuildCasIndex(): Promise<void> {
    this._casIndex.clear();

    for (const ref of this._manifest.cas ?? []) {
      this._casIndex.set(ref.sha256, ref);
    }

    const casDir = join(this._state.paths.cache, CAS_DIR);
    try {
      const files = await readdir(casDir);
      for (const file of files) {
        if (!file.endsWith(".bin")) continue;
        const hash = file.replace(/\.bin$/, "");
        if (!this._casIndex.has(hash)) {
          const filePath = join(casDir, file);
          try {
            const fileStat = await stat(filePath);
            const ref: ContentAddressableRef = {
              sha256: hash,
              size: fileStat.size,
              refCount: 0,
            };
            this._casIndex.set(hash, ref);
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // CAS dir may not exist yet
    }
  }

  private async _saveCasIndex(): Promise<void> {
    this._manifest = {
      ...this._manifest,
      cas: Array.from(this._casIndex.values()),
    };
  }

  // ---------------------------------------------------------------------------
  // Private: entry helpers
  // ---------------------------------------------------------------------------

  private _findEntry(
    key: string,
    layer: CacheLayer,
  ): CacheEntryMeta | undefined {
    return this._manifest.entries.find(
      (e) => e.key === key && e.layer === layer,
    );
  }

  private _entryState(entry: CacheEntryMeta): CacheEntryState {
    const now = Date.now();
    const expiresAt = new Date(entry.expiresAt).getTime();
    const staleTtl = this._getLayerConfig(entry.layer).staleTtl ?? 0;
    const staleAt = expiresAt + staleTtl;

    if (now < expiresAt) return "fresh";
    if (now < staleAt) return "stale";
    return "expired";
  }

  private _entryFilePath(entry: CacheEntryMeta): string {
    const filename = `${this._hashKey(entry.key)}.json`;
    return this._layerFilePath(entry.layer, filename);
  }

  private _touchEntry(entry: CacheEntryMeta): CacheEntryMeta {
    return {
      ...entry,
      accessedAt: new Date().toISOString(),
    };
  }

  private _replaceEntry(entry: CacheEntryMeta): void {
    const entries = this._manifest.entries as CacheEntryMeta[];
    const index = entries.findIndex(
      (e) => e.key === entry.key && e.layer === entry.layer,
    );
    if (index >= 0) {
      entries[index] = entry;
    } else {
      entries.push(entry);
    }
  }

  private async _removeEntryFile(entry: CacheEntryMeta): Promise<void> {
    const filePath = this._entryFilePath(entry);
    try {
      await rm(filePath, { force: true });
    } catch {
      // ignore missing files
    }
  }

  // ---------------------------------------------------------------------------
  // Private: path helpers
  // ---------------------------------------------------------------------------

  private _hashKey(key: string): string {
    return sha256(key).slice(0, 16);
  }

  private _layerDir(layer: CacheLayer): string {
    return join(this._state.paths.cache, layer);
  }

  private _layerFilePath(layer: CacheLayer, filename: string): string {
    return join(this._layerDir(layer), filename);
  }

  private async _ensureLayerDir(layer: CacheLayer): Promise<void> {
    const dir = this._layerDir(layer);
    await mkdir(dir, { recursive: true });
  }

  private _getLayerConfig(layer: CacheLayer): CacheLayerConfig {
    return this._config[layer];
  }

  // ---------------------------------------------------------------------------
  // Private: atomic writes
  // ---------------------------------------------------------------------------

  private async _atomicWrite(filePath: string, data: string): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });

    const tmpPath = join(
      this._state.paths.tmp,
      `${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );

    try {
      await mkdir(this._state.paths.tmp, { recursive: true });
      await writeFile(tmpPath, data, "utf-8");
      await rename(tmpPath, filePath);
    } catch (error) {
      try {
        await rm(tmpPath, { force: true });
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }

  private async _atomicWriteBuffer(
    filePath: string,
    buffer: Buffer,
  ): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });

    const tmpPath = join(
      this._state.paths.tmp,
      `${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );

    try {
      await mkdir(this._state.paths.tmp, { recursive: true });
      await writeFile(tmpPath, buffer);
      await rename(tmpPath, filePath);
    } catch (error) {
      try {
        await rm(tmpPath, { force: true });
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: limits & eviction
  // ---------------------------------------------------------------------------

  private async _enforceLimits(layer: CacheLayer): Promise<void> {
    const config = this._getLayerConfig(layer);

    if (config.maxEntries !== undefined) {
      const layerEntries = this._manifest.entries.filter(
        (e) => e.layer === layer,
      );
      const excess = layerEntries.length - config.maxEntries;
      if (excess > 0) {
        await this._evictLru(layer, excess);
      }
    }

    if (config.maxSizeBytes !== undefined) {
      const layerEntries = this._manifest.entries.filter(
        (e) => e.layer === layer,
      );
      let totalSize = layerEntries.reduce((sum, e) => sum + e.size, 0);

      if (totalSize > config.maxSizeBytes) {
        const sorted = [...layerEntries].sort(
          (a, b) =>
            new Date(a.accessedAt).getTime() - new Date(b.accessedAt).getTime(),
        );

        for (const entry of sorted) {
          if (totalSize <= config.maxSizeBytes) break;
          totalSize -= entry.size;
          await this._removeEntryFile(entry);
          const idx = this._manifest.entries.indexOf(entry);
          if (idx >= 0) {
            (this._manifest.entries as CacheEntryMeta[]).splice(idx, 1);
          }
          this._stats.evictions++;
        }

        await this._saveManifest();
      }
    }

    if (this._config.maxTotalSizeBytes !== undefined) {
      let totalSize = this._manifest.entries.reduce(
        (sum, e) => sum + e.size,
        0,
      );

      if (totalSize > this._config.maxTotalSizeBytes) {
        const sorted = [...this._manifest.entries].sort(
          (a, b) =>
            new Date(a.accessedAt).getTime() - new Date(b.accessedAt).getTime(),
        );

        for (const entry of sorted) {
          if (totalSize <= this._config.maxTotalSizeBytes) break;
          totalSize -= entry.size;
          await this._removeEntryFile(entry);
          const idx = this._manifest.entries.indexOf(entry);
          if (idx >= 0) {
            (this._manifest.entries as CacheEntryMeta[]).splice(idx, 1);
          }
          this._stats.evictions++;
        }

        await this._saveManifest();
      }
    }
  }

  private async _evictLru(layer: CacheLayer, count: number): Promise<void> {
    const layerEntries = this._manifest.entries
      .filter((e) => e.layer === layer)
      .sort(
        (a, b) =>
          new Date(a.accessedAt).getTime() - new Date(b.accessedAt).getTime(),
      );

    const toEvict = layerEntries.slice(0, count);

    for (const entry of toEvict) {
      await this._removeEntryFile(entry);
      const idx = this._manifest.entries.indexOf(entry);
      if (idx >= 0) {
        (this._manifest.entries as CacheEntryMeta[]).splice(idx, 1);
      }
      this._stats.evictions++;
    }

    if (toEvict.length > 0) {
      await this._saveManifest();
      this._logger.debug("Evicted LRU entries", {
        layer,
        count: toEvict.length,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private: orphan cleanup
  // ---------------------------------------------------------------------------

  private async _cleanupOrphans(): Promise<number> {
    const knownFiles = new Set<string>();

    for (const entry of this._manifest.entries) {
      knownFiles.add(this._entryFilePath(entry));
    }

    const casDir = join(this._state.paths.cache, CAS_DIR);
    for (const ref of this._casIndex.values()) {
      knownFiles.add(join(casDir, `${ref.sha256}.bin`));
    }

    const manifestPath = join(this._state.paths.cache, MANIFEST_FILENAME);
    knownFiles.add(manifestPath);

    let orphanCount = 0;
    const layers: CacheLayer[] = ["metadata", "content", "artifacts"];

    for (const layer of layers) {
      const dir = this._layerDir(layer);
      try {
        const files = await readdir(dir);
        for (const file of files) {
          const filePath = join(dir, file);
          if (!knownFiles.has(filePath)) {
            try {
              await rm(filePath, { force: true });
              orphanCount++;
              this._logger.debug("Removed orphan file", { path: filePath });
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // dir may not exist
      }
    }

    try {
      const casFiles = await readdir(casDir);
      for (const file of casFiles) {
        const filePath = join(casDir, file);
        if (!knownFiles.has(filePath)) {
          try {
            await rm(filePath, { force: true });
            orphanCount++;
            this._logger.debug("Removed orphan CAS file", { path: filePath });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // CAS dir may not exist
    }

    if (orphanCount > 0) {
      this._logger.info("Cleaned up orphan files", { count: orphanCount });
    }

    return orphanCount;
  }
}
