import type { RegistrySnapshot } from "./registry-snapshot.js";
import type { ResourceIndex } from "./resource-index.js";
import type { RevisionInfo } from "./index-schema.js";

export interface RegistryDiagnostics {
  readonly source: "registry.json" | "manifest-scan" | "cache" | "index";
  readonly revision?: RevisionInfo;
  readonly resourceCount: number;
  readonly resourceTypeCount: number;
  readonly invalidResourceCount: number;
  readonly cacheState:
    | "fresh"
    | "stale"
    | "miss"
    | "disabled"
    | "unknown"
    | "expired"
    | "remote-failed"
    | "no-cache";
  readonly freshness: "fresh" | "stale" | "expired" | "unknown";
  readonly provider: string;
  readonly durationMs: {
    readonly total: number;
    readonly fetch: number;
    readonly parse: number;
    readonly normalize: number;
    readonly index: number;
  };
  readonly indexStats?: RegistryIndexStats;
}

export interface RegistryIndexStats {
  readonly idLookupCount: number;
  readonly nameLookupCount: number;
  readonly versionLookupCount: number;
  readonly categoryLookupCount: number;
  readonly tagLookupCount: number;
}

export interface RegistryPerformanceMetrics {
  readonly fetchDurationMs: number;
  readonly parseDurationMs: number;
  readonly normalizeDurationMs: number;
  readonly indexDurationMs: number;
  readonly cacheLookupDurationMs: number;
  readonly resourceLookupDurationMs: number;
  readonly totalDurationMs: number;
  readonly timestamp: string;
}

export class RegistryDiagnosticsCollector {
  private _metrics: RegistryPerformanceMetrics = {
    fetchDurationMs: 0,
    parseDurationMs: 0,
    normalizeDurationMs: 0,
    indexDurationMs: 0,
    cacheLookupDurationMs: 0,
    resourceLookupDurationMs: 0,
    totalDurationMs: 0,
    timestamp: new Date().toISOString(),
  };
  private _lookupStats: RegistryIndexStats = {
    idLookupCount: 0,
    nameLookupCount: 0,
    versionLookupCount: 0,
    categoryLookupCount: 0,
    tagLookupCount: 0,
  };

  recordFetch(durationMs: number): void {
    this._metrics = { ...this._metrics, fetchDurationMs: durationMs };
  }

  recordParse(durationMs: number): void {
    this._metrics = { ...this._metrics, parseDurationMs: durationMs };
  }

  recordNormalize(durationMs: number): void {
    this._metrics = { ...this._metrics, normalizeDurationMs: durationMs };
  }

  recordIndex(durationMs: number): void {
    this._metrics = { ...this._metrics, indexDurationMs: durationMs };
  }

  recordCacheLookup(durationMs: number): void {
    this._metrics = { ...this._metrics, cacheLookupDurationMs: durationMs };
  }

  recordResourceLookup(durationMs: number): void {
    this._metrics = { ...this._metrics, resourceLookupDurationMs: durationMs };
  }

  recordTotal(durationMs: number): void {
    this._metrics = { ...this._metrics, totalDurationMs: durationMs };
  }

  trackIdLookup(): void {
    this._lookupStats = {
      ...this._lookupStats,
      idLookupCount: this._lookupStats.idLookupCount + 1,
    };
  }

  trackNameLookup(): void {
    this._lookupStats = {
      ...this._lookupStats,
      nameLookupCount: this._lookupStats.nameLookupCount + 1,
    };
  }

  trackVersionLookup(): void {
    this._lookupStats = {
      ...this._lookupStats,
      versionLookupCount: this._lookupStats.versionLookupCount + 1,
    };
  }

  trackCategoryLookup(): void {
    this._lookupStats = {
      ...this._lookupStats,
      categoryLookupCount: this._lookupStats.categoryLookupCount + 1,
    };
  }

  trackTagLookup(): void {
    this._lookupStats = {
      ...this._lookupStats,
      tagLookupCount: this._lookupStats.tagLookupCount + 1,
    };
  }

  getMetrics(): RegistryPerformanceMetrics {
    return { ...this._metrics, timestamp: new Date().toISOString() };
  }

  getIndexStats(): RegistryIndexStats {
    return { ...this._lookupStats };
  }

  buildDiagnostics(
    snapshot: RegistrySnapshot | null,
    index: ResourceIndex | null,
    source: RegistryDiagnostics["source"],
    cacheState: RegistryDiagnostics["cacheState"],
    freshness: RegistryDiagnostics["freshness"],
    provider: string,
  ): RegistryDiagnostics {
    const metrics = this.getMetrics();

    return {
      source,
      revision: snapshot?.revision,
      resourceCount: index?.totalCount ?? snapshot?.metadata.totalCount ?? 0,
      resourceTypeCount: snapshot?.metadata.resourceTypeCount ?? 0,
      invalidResourceCount: snapshot?.metadata.invalidResourceCount ?? 0,
      cacheState,
      freshness,
      provider,
      durationMs: {
        total: metrics.totalDurationMs,
        fetch: metrics.fetchDurationMs,
        parse: metrics.parseDurationMs,
        normalize: metrics.normalizeDurationMs,
        index: metrics.indexDurationMs,
      },
      indexStats: this.getIndexStats(),
    };
  }

  reset(): void {
    this._metrics = {
      fetchDurationMs: 0,
      parseDurationMs: 0,
      normalizeDurationMs: 0,
      indexDurationMs: 0,
      cacheLookupDurationMs: 0,
      resourceLookupDurationMs: 0,
      totalDurationMs: 0,
      timestamp: new Date().toISOString(),
    };
    this._lookupStats = {
      idLookupCount: 0,
      nameLookupCount: 0,
      versionLookupCount: 0,
      categoryLookupCount: 0,
      tagLookupCount: 0,
    };
  }
}
