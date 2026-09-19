export interface CacheEntry<T = unknown> {
  readonly key: string;
  readonly data: T;
  readonly cachedAt: string;
  readonly expiresAt: string;
  readonly size: number;
}

export interface CacheConfig {
  readonly enabled: boolean;
  readonly directory: string;
  readonly maxSize: number;
  readonly ttl: number;
  readonly autoClean: boolean;
}

export interface CacheStats {
  readonly entries: number;
  readonly totalSize: number;
  readonly hitRate: number;
  readonly oldestEntry: string | null;
  readonly newestEntry: string | null;
  readonly registryEntries: number;
  readonly manifestEntries: number;
  readonly downloadEntries: number;
}
