import type { ResolverResult } from "./advanced-resolver.js";

export interface ResolutionCacheEntry {
  readonly result: ResolverResult;
  readonly cachedAt: number;
  readonly key: string;
}

export interface ResolutionCacheConfig {
  readonly maxSize: number;
  readonly ttlMs: number;
}

const DEFAULT_CONFIG: ResolutionCacheConfig = {
  maxSize: 1000,
  ttlMs: 5 * 60_000,
};

export class ResolutionCache {
  private readonly _cache = new Map<string, ResolutionCacheEntry>();
  private readonly _config: ResolutionCacheConfig;

  constructor(config?: Partial<ResolutionCacheConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  get size(): number {
    return this._cache.size;
  }

  buildKey(
    resourceId: string,
    registryRevision: string,
    installedVersions: ReadonlyMap<string, string>,
    nodeVersion: string,
    platform: string,
    frameworks: ReadonlyArray<string>,
    skipOptional: boolean,
  ): string {
    const parts = [
      resourceId,
      registryRevision,
      nodeVersion,
      platform,
      frameworks.join(","),
      skipOptional ? "skip" : "include",
    ];

    const sorted = [...installedVersions.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    for (const [id, version] of sorted) {
      parts.push(`${id}@${version}`);
    }

    return `resolution:${parts.join("|")}`;
  }

  get(key: string): ResolverResult | null {
    const entry = this._cache.get(key);
    if (entry === undefined) return null;

    if (Date.now() - entry.cachedAt > this._config.ttlMs) {
      this._cache.delete(key);
      return null;
    }

    return entry.result;
  }

  set(key: string, result: ResolverResult): void {
    if (this._cache.size >= this._config.maxSize) {
      this._evictOldest();
    }

    this._cache.set(key, {
      result,
      cachedAt: Date.now(),
      key,
    });
  }

  has(key: string): boolean {
    const entry = this._cache.get(key);
    if (entry === undefined) return false;

    if (Date.now() - entry.cachedAt > this._config.ttlMs) {
      this._cache.delete(key);
      return false;
    }

    return true;
  }

  invalidate(key?: string): void {
    if (key !== undefined) {
      this._cache.delete(key);
    } else {
      this._cache.clear();
    }
  }

  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this._cache.keys()) {
      if (key.startsWith(prefix)) {
        this._cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this._cache.clear();
  }

  get stats(): { size: number; hitRate: number } {
    return {
      size: this._cache.size,
      hitRate: 0,
    };
  }

  private _evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this._cache) {
      if (entry.cachedAt < oldestTime) {
        oldestTime = entry.cachedAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this._cache.delete(oldestKey);
    }
  }
}
