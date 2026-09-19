export type CacheLayer = "metadata" | "content" | "artifacts";

export type CacheEntryState = "fresh" | "stale" | "expired" | "missing";

export interface CacheEntryMeta {
  readonly key: string;
  readonly layer: CacheLayer;
  readonly contentType: string;
  readonly size: number;
  readonly checksum: string;
  readonly source: string;
  readonly repository?: string;
  readonly revision?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly createdAt: string;
  readonly accessedAt: string;
  readonly expiresAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CacheLayerConfig {
  readonly ttl: number;
  readonly staleTtl?: number;
  readonly maxEntries?: number;
  readonly maxSizeBytes?: number;
}

export interface CacheManagerConfig {
  readonly metadata: CacheLayerConfig;
  readonly content: CacheLayerConfig;
  readonly artifacts: CacheLayerConfig;
  readonly maxTotalSizeBytes?: number;
  readonly autoClean: boolean;
  readonly enabled: boolean;
}

export interface CacheManagerStats {
  readonly hits: number;
  readonly misses: number;
  readonly staleHits: number;
  readonly expiredEntries: number;
  readonly writes: number;
  readonly invalidations: number;
  readonly evictions: number;
  readonly bytesRead: number;
  readonly bytesWritten: number;
  readonly entries: ReadonlyArray<CacheEntryMeta>;
}

export interface ContentAddressableRef {
  readonly sha256: string;
  readonly size: number;
  readonly refCount: number;
}

export const CACHE_MANIFEST_VERSION = 2;

export interface CacheManifestV2 {
  readonly version: number;
  readonly entries: ReadonlyArray<CacheEntryMeta>;
  readonly cas?: ReadonlyArray<ContentAddressableRef>;
}
