import type { CacheManager } from "./CacheManager.js";
import type { CacheLayer } from "./types.js";
import { createLogger, type Logger } from "../logger/index.js";

export type InvalidationReason =
  | "registry-revision"
  | "resource-update"
  | "manifest-change"
  | "manual"
  | "expired"
  | "corrupt";

/**
 * Dependency-aware invalidation graph.
 * Knows relationships between cache layers so a registry revision
 * change cascades to dependent entries without wiping everything.
 */
export class CacheInvalidationGraph {
  private readonly _cache: CacheManager;
  private readonly _logger: Logger;

  constructor(cache: CacheManager, logger?: Logger) {
    this._cache = cache;
    this._logger = logger ?? createLogger({ prefix: "cache-invalidation" });
  }

  /**
   * Invalidate everything that depends on a registry revision.
   * Registry → resource metadata → manifests → resolution cache
   */
  async onRegistryRevisionChanged(newRevision: string): Promise<number> {
    let total = 0;
    // Invalidate metadata layer (registry, resource metadata)
    total += await this._cache.invalidateLayer("metadata");
    // Invalidate content layer entries tagged with old revision
    const entries = this._cache.stats.entries;
    for (const e of entries) {
      if (
        e.revision !== undefined &&
        e.revision !== newRevision &&
        e.layer === "content"
      ) {
        const ok = await this._cache.invalidate(e.key);
        if (ok) total++;
      }
    }
    this._logger.info("Invalidated on registry revision change", {
      newRevision,
      total,
    });
    return total;
  }

  async onResourceUpdated(resourceId: string): Promise<number> {
    const count = await this._cache.invalidateResource(resourceId);
    this._logger.debug("Invalidated resource", { resourceId, count });
    return count;
  }

  async onLayerInvalidated(
    layer: CacheLayer,
    reason: InvalidationReason,
  ): Promise<number> {
    this._logger.debug("Layer invalidation", { layer, reason });
    if (reason === "corrupt") {
      return this._cache.invalidateLayer(layer);
    }
    return 0;
  }

  /**
   * Selective invalidation — never wipes entire cache unless explicitly requested.
   */
  async selectiveInvalidation(keys: ReadonlyArray<string>): Promise<number> {
    let count = 0;
    for (const k of keys) {
      const ok = await this._cache.invalidate(k);
      if (ok) count++;
    }
    return count;
  }

  async fullReset(): Promise<void> {
    await this._cache.clearAll();
    this._logger.info("Full cache reset completed");
  }
}
