import type { CacheManager } from "./CacheManager.js";
import type { RegistryResource } from "../types/registry.js";
import { createLogger, type Logger } from "../logger/index.js";

export interface WarmupOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

export interface PrefetchOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  readonly priority?: "high" | "normal" | "low";
}

/**
 * Cache warmup & prefetch — respects concurrency, cancellation, and existing cache.
 */
export class CacheWarmup {
  private readonly _cache: CacheManager;
  private readonly _logger: Logger;

  constructor(cache: CacheManager, logger?: Logger) {
    this._cache = cache;
    this._logger = logger ?? createLogger({ prefix: "cache-warmup" });
  }

  /**
   * Warm registry + manifest metadata without downloading artifact content.
   */
  async warmupRegistry(
    resources: ReadonlyArray<RegistryResource>,
    opts?: WarmupOptions,
  ): Promise<number> {
    const concurrency = opts?.concurrency ?? 10;
    let warmed = 0;
    const chunks: Array<ReadonlyArray<RegistryResource>> = [];
    for (let i = 0; i < resources.length; i += concurrency)
      chunks.push(resources.slice(i, i + concurrency));

    for (const chunk of chunks) {
      if (opts?.signal?.aborted) break;
      await Promise.all(
        chunk.map(async (r) => {
          const key = `resource:${r.id}:${r.version}`;
          if (!this._cache.has(key, "metadata")) {
            await this._cache.set(key, r, "metadata", { source: "warmup" });
            warmed++;
          }
        }),
      );
    }
    this._logger.debug("Registry warmup complete", {
      warmed,
      total: resources.length,
    });
    return warmed;
  }

  /**
   * Explicit prefetch — fetch keys through factory, respecting cache + cancellation.
   */
  async prefetch<T>(
    keys: ReadonlyArray<string>,
    factory: (key: string) => Promise<T>,
    layer: "metadata" | "content" = "content",
    opts?: PrefetchOptions,
  ): Promise<Map<string, T>> {
    const concurrency = opts?.concurrency ?? 5;
    const results = new Map<string, T>();
    const chunks: Array<ReadonlyArray<string>> = [];
    for (let i = 0; i < keys.length; i += concurrency)
      chunks.push(keys.slice(i, i + concurrency));

    for (const chunk of chunks) {
      if (opts?.signal?.aborted) break;
      await Promise.all(
        chunk.map(async (k) => {
          const cached = await this._cache.get<T>(k, layer);
          if (cached !== null) {
            results.set(k, cached.data);
            return;
          }
          try {
            const data = await factory(k);
            await this._cache.set(k, data, layer, { source: "prefetch" });
            results.set(k, data);
          } catch (e) {
            this._logger.warn("Prefetch failed", { key: k, error: String(e) });
          }
        }),
      );
    }
    return results;
  }
}
