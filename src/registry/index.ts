import type {
  Registry,
  RegistryCategory,
  RegistryResource,
} from "../types/registry.js";
import type { ResolvedConfig } from "../types/config.js";
import type { RegistryProvider } from "../types/providers.js";
import { Cache } from "../cache/index.js";
import { EventBus } from "../events/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { GitHubRepositoryTransport } from "../transport/github-repository.js";
import { RegistryDiscovery } from "./discovery.js";
import { RegistryIndexManager } from "./registry-index.js";
import { RevisionDetector } from "./revision-detector.js";
import {
  type RegistrySnapshot,
  buildRegistrySnapshot,
} from "./registry-snapshot.js";
import {
  type FreshnessPolicy,
  evaluateFreshness,
  shouldUseCache,
  shouldRevalidate,
} from "./freshness-policy.js";
import {
  detectCapabilities,
  type EnhancedProviderCapabilities,
} from "./provider-capabilities.js";
import { SingleFlight, buildRegistryFetchKey } from "./single-flight.js";
import { ResourceIndexBuilder, type ResourceIndex } from "./resource-index.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import {
  RegistryDiagnosticsCollector,
  type RegistryDiagnostics,
} from "./diagnostics.js";
import { MarketplaceClientError } from "../errors/index.js";

function buildManifestFetchKey(repo: string, manifestPath: string): string {
  return `manifest:${repo}:${manifestPath}`;
}

export interface RegistryClientOptions {
  readonly config: ResolvedConfig;
  readonly cache: Cache;
  readonly events: EventBus;
  readonly indexManager?: RegistryIndexManager;
  readonly revisionDetector?: RevisionDetector;
  readonly logger?: Logger;
  readonly freshnessPolicy?: FreshnessPolicy;
  readonly maxConcurrent?: number;
  readonly offline?: boolean;
}

export interface LoadOptions {
  readonly refresh?: boolean;
  readonly force?: boolean;
  readonly freshness?: FreshnessPolicy;
}

export class RegistryClient {
  private _registry: Registry | null = null;
  private _snapshot: RegistrySnapshot | null = null;
  private _resourceIndex: ResourceIndex | null = null;
  private readonly _config: ResolvedConfig;
  private readonly _cache: Cache;
  private readonly _events: EventBus;
  private readonly _logger: Logger;
  private readonly _repos: GitHubRepositoryTransport;
  private readonly _discovery: RegistryDiscovery;
  private readonly _indexManager: RegistryIndexManager | null;
  private readonly _revisionDetector: RevisionDetector | null;
  private _provider: RegistryProvider | null = null;
  private _capabilities: EnhancedProviderCapabilities | null = null;
  private readonly _singleFlight: SingleFlight;
  private readonly _resourceIndexBuilder: ResourceIndexBuilder;
  private readonly _concurrencyLimiter: ConcurrencyLimiter;
  private readonly _diagnostics: RegistryDiagnosticsCollector;
  private _freshnessPolicy: FreshnessPolicy;
  private _cachedDiagnostics: RegistryDiagnostics | null = null;
  private _offline: boolean;

  constructor(
    config: ResolvedConfig,
    cache: Cache,
    events: EventBus,
    logger?: Logger,
    indexManager?: RegistryIndexManager,
    revisionDetector?: RevisionDetector,
    freshnessPolicy?: FreshnessPolicy,
    maxConcurrent?: number,
    offline?: boolean,
  ) {
    this._config = config;
    this._cache = cache;
    this._events = events;
    this._logger = logger ?? createLogger({ prefix: "registry" });
    this._repos = new GitHubRepositoryTransport(
      {
        repository: config.repository,
        branch: config.branch,
        timeout: config.timeout,
        token: config.token,
      },
      undefined,
      undefined,
      this._logger.child("repos"),
    );
    this._discovery = new RegistryDiscovery(config, this._logger);
    this._indexManager = indexManager ?? null;
    this._revisionDetector = revisionDetector ?? null;
    this._freshnessPolicy = freshnessPolicy ?? "normal";
    this._singleFlight = new SingleFlight();
    this._resourceIndexBuilder = new ResourceIndexBuilder();
    this._concurrencyLimiter = new ConcurrencyLimiter({
      maxConcurrent: maxConcurrent ?? 5,
    });
    this._diagnostics = new RegistryDiagnosticsCollector();
    this._offline = offline ?? false;
  }

  static create(options: RegistryClientOptions): RegistryClient {
    return new RegistryClient(
      options.config,
      options.cache,
      options.events,
      options.logger,
      options.indexManager,
      options.revisionDetector,
      options.freshnessPolicy,
      options.maxConcurrent,
      options.offline,
    );
  }

  setProvider(provider: RegistryProvider): void {
    this._provider = provider;
    this._capabilities = detectCapabilities(provider);
    this._discovery.setProvider(provider);
    this._logger.debug("Registry provider set", {
      type: provider.type,
      name: provider.name,
    });
  }

  get provider(): RegistryProvider | null {
    return this._provider;
  }

  get registry(): Registry | null {
    return this._registry;
  }

  get snapshot(): RegistrySnapshot | null {
    return this._snapshot;
  }

  get resourceIndex(): ResourceIndex | null {
    return this._resourceIndex;
  }

  get capabilities(): EnhancedProviderCapabilities | null {
    return this._capabilities;
  }

  get freshnessPolicy(): FreshnessPolicy {
    return this._freshnessPolicy;
  }

  get offline(): boolean {
    return this._offline;
  }

  setFreshnessPolicy(policy: FreshnessPolicy): void {
    this._freshnessPolicy = policy;
  }

  setOffline(offline: boolean): void {
    this._offline = offline;
  }

  async load(options?: LoadOptions): Promise<Registry> {
    if (
      this._registry !== null &&
      options?.refresh !== true &&
      options?.force !== true
    ) {
      return this._registry;
    }

    const effectivePolicy = options?.freshness ?? this._freshnessPolicy;

    if (options?.force === true) {
      this._registry = null;
      this._snapshot = null;
      this._resourceIndex = null;
      this._cachedDiagnostics = null;
      if (this._indexManager !== null) {
        await this._indexManager.invalidate();
      }
    }

    await this._events.emit("beforeRegistryLoad", {
      source: this._config.repository,
    });

    const totalStart = Date.now();

    // Offline mode: use cache-only, never attempt network
    if (this._offline) {
      this._logger.info("Offline mode: using cache/index only");

      // Try local index first
      if (this._indexManager !== null) {
        try {
          const localIndex = await this._indexManager.loadLocal();
          if (localIndex !== null) {
            const registry = this._indexManager.indexToRegistry(localIndex);
            this._registry = registry;
            this._snapshot = buildRegistrySnapshot(
              registry,
              localIndex.revision,
              (localIndex.metadata.source as
                "registry.json" | "manifest-scan") ?? "registry.json",
            );
            this._resourceIndex = this._resourceIndexBuilder.build(
              registry.resources,
            );
            this._diagnostics.recordTotal(Date.now() - totalStart);

            this._cachedDiagnostics = this._diagnostics.buildDiagnostics(
              this._snapshot,
              this._resourceIndex,
              "index",
              "fresh",
              "fresh",
              this._provider?.type ?? "unknown",
            );

            await this._emitAfterLoad(registry, totalStart);
            return registry;
          }
        } catch {
          this._logger.debug("Offline: local index load failed");
        }
      }

      // Try cache
      try {
        const cached = await this._cache.get<Registry>(
          this._registryCacheKey(),
        );
        if (cached !== null) {
          this._registry = cached.data;
          this._snapshot = buildRegistrySnapshot(
            cached.data,
            { checkedAt: cached.cachedAt },
            "registry.json",
          );
          this._resourceIndex = this._resourceIndexBuilder.build(
            cached.data.resources,
          );
          this._diagnostics.recordTotal(Date.now() - totalStart);

          this._cachedDiagnostics = this._diagnostics.buildDiagnostics(
            this._snapshot,
            this._resourceIndex,
            "cache",
            "fresh",
            "fresh",
            this._provider?.type ?? "unknown",
          );

          await this._emitAfterLoad(cached.data, totalStart);
          return this._registry;
        }
      } catch {
        this._logger.debug("Offline: cache read failed");
      }

      throw new MarketplaceClientError("REGISTRY_NOT_FOUND", {
        message:
          "Offline mode: no cached registry available. Run with network access first to build the cache.",
        context: {
          repository: this._config.repository,
          branch: this._config.branch,
        },
      });
    }

    if (this._indexManager !== null && options?.force !== true) {
      try {
        const cacheStart = Date.now();
        const localIndex = await this._indexManager.loadLocal();
        this._diagnostics.recordCacheLookup(Date.now() - cacheStart);

        if (localIndex !== null) {
          if (this._revisionDetector !== null && options?.refresh !== true) {
            try {
              const remoteRevision =
                await this._revisionDetector.detectRevision();
              if (this._indexManager.isIndexFresh(localIndex, remoteRevision)) {
                this._logger.info("Registry index is fresh, using local");
                const registry = this._indexManager.indexToRegistry(localIndex);
                this._registry = registry;

                const revision = localIndex.revision;
                this._snapshot = buildRegistrySnapshot(
                  registry,
                  revision,
                  (localIndex.metadata.source as
                    "registry.json" | "manifest-scan") ?? "registry.json",
                );
                const indexStart = Date.now();
                this._resourceIndex = this._resourceIndexBuilder.build(
                  registry.resources,
                );
                this._diagnostics.recordIndex(Date.now() - indexStart);
                this._diagnostics.recordTotal(Date.now() - totalStart);

                this._cachedDiagnostics = this._diagnostics.buildDiagnostics(
                  this._snapshot,
                  this._resourceIndex,
                  "index",
                  "fresh",
                  "fresh",
                  this._provider?.type ?? "unknown",
                );

                await this._emitAfterLoad(registry, totalStart);
                return registry;
              }
              this._logger.info("Registry index is stale, refreshing");
            } catch (error) {
              this._logger.debug("Revision check failed, using local index", {
                error: error instanceof Error ? error.message : String(error),
              });
              const registry = this._indexManager.indexToRegistry(localIndex);
              this._registry = registry;

              const revision = localIndex.revision;
              this._snapshot = buildRegistrySnapshot(
                registry,
                revision,
                (localIndex.metadata.source as
                  "registry.json" | "manifest-scan") ?? "registry.json",
              );
              this._resourceIndex = this._resourceIndexBuilder.build(
                registry.resources,
              );
              this._diagnostics.recordTotal(Date.now() - totalStart);

              await this._emitAfterLoad(registry, totalStart);
              return registry;
            }
          } else {
            this._logger.info("Using local registry index");
            const registry = this._indexManager.indexToRegistry(localIndex);
            this._registry = registry;

            const revision = localIndex.revision;
            this._snapshot = buildRegistrySnapshot(
              registry,
              revision,
              (localIndex.metadata.source as
                "registry.json" | "manifest-scan") ?? "registry.json",
            );
            this._resourceIndex = this._resourceIndexBuilder.build(
              registry.resources,
            );
            this._diagnostics.recordTotal(Date.now() - totalStart);

            await this._emitAfterLoad(registry, totalStart);
            return registry;
          }
        }
      } catch (error) {
        this._logger.debug(
          "Local index load failed, proceeding with discovery",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    try {
      const cacheStart = Date.now();
      const cached = await this._cache.get<Registry>(this._registryCacheKey());
      this._diagnostics.recordCacheLookup(Date.now() - cacheStart);

      if (cached !== null && options?.force !== true) {
        const freshness = evaluateFreshness(cached.cachedAt, effectivePolicy);

        if (shouldUseCache(freshness)) {
          this._logger.debug("Registry loaded from cache", {
            freshness: freshness.state,
            ageMs: freshness.ageMs,
          });
          this._registry = cached.data;
          this._snapshot = buildRegistrySnapshot(
            cached.data,
            { checkedAt: cached.cachedAt },
            "registry.json",
          );
          this._resourceIndex = this._resourceIndexBuilder.build(
            cached.data.resources,
          );

          this._cachedDiagnostics = this._diagnostics.buildDiagnostics(
            this._snapshot,
            this._resourceIndex,
            "cache",
            freshness.state === "offline" ||
              freshness.state === "remote-failed" ||
              freshness.state === "no-cache"
              ? "unknown"
              : freshness.state,
            freshness.state === "offline" ||
              freshness.state === "remote-failed" ||
              freshness.state === "no-cache"
              ? "unknown"
              : freshness.state,
            this._provider?.type ?? "unknown",
          );
          this._diagnostics.recordTotal(Date.now() - totalStart);

          await this._emitAfterLoad(cached.data, totalStart);

          if (shouldRevalidate(freshness) && options?.refresh !== true) {
            this._revalidateInBackground();
          }

          return this._registry;
        }
      }
    } catch {
      this._logger.debug("Cache read failed, loading from source");
    }

    const fetchKey = buildRegistryFetchKey(
      this._config.repository,
      this._config.branch,
    );
    let result;
    try {
      result = await this._singleFlight.do(fetchKey, async () => {
        const fetchStart = Date.now();
        const discoveryResult = await this._discovery.discover();
        this._diagnostics.recordFetch(Date.now() - fetchStart);

        return discoveryResult;
      });
    } catch (error) {
      // Remote failed: fall back to stale local data (index, then cache)
      // instead of failing startup with an empty registry.
      this._logger.warn("Registry discovery failed, trying stale local data", {
        error: error instanceof Error ? error.message : String(error),
      });
      const stale = await this._loadStaleRegistry(totalStart);
      if (stale !== null) return stale;
      throw error;
    }

    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        this._logger.warn(`Discovery warning: ${warning.message}`, {
          path: warning.path,
          type: warning.type,
        });
      }
    }

    const registry = result.registry;
    this._registry = registry;

    let revision = { checkedAt: new Date().toISOString() };
    if (this._revisionDetector !== null) {
      try {
        revision = await this._revisionDetector.detectRevision();
      } catch {
        this._logger.debug("Revision detection failed, using default");
      }
    }

    this._snapshot = buildRegistrySnapshot(
      registry,
      revision,
      result.source,
      0,
      result.warnings.length,
    );

    const indexStart = Date.now();
    if (this._resourceIndex !== null && !options?.force) {
      // Incremental update when refreshing
      const oldIds = new Set(this._resourceIndex.byId.keys());
      const newIds = new Set(registry.resources.map((r) => r.id));
      const added = registry.resources.filter((r) => !oldIds.has(r.id));
      const removed = [...oldIds].filter((id) => !newIds.has(id));
      const updated = registry.resources.filter(
        (r) =>
          oldIds.has(r.id) &&
          this._resourceIndex!.byId.get(r.id)?.version !== r.version,
      );
      if (
        added.length + removed.length + updated.length <
        registry.resources.length * 0.5
      ) {
        this._resourceIndex = this._resourceIndexBuilder.updateIncremental(
          this._resourceIndex,
          added,
          removed,
          updated,
        );
      } else {
        this._resourceIndex = this._resourceIndexBuilder.build(
          registry.resources,
        );
      }
    } else {
      this._resourceIndex = this._resourceIndexBuilder.build(
        registry.resources,
      );
    }
    this._diagnostics.recordIndex(Date.now() - indexStart);

    // Pre-warm manifest cache in parallel
    if (!this._offline && this._capabilities?.supportsBulkFetch !== false) {
      const resourceIds = registry.resources.map((r) => r.id);
      this._fetchManifestsParallel(resourceIds).catch(() => {
        this._logger.debug("Manifest pre-warm failed (non-critical)");
      });
    }

    if (this._indexManager !== null) {
      try {
        const index = this._indexManager.buildFromRegistry(registry, revision);
        await this._indexManager.save(index);
        this._logger.info("Registry index saved", {
          resources: index.resources.length,
        });
      } catch (error) {
        this._logger.warn("Failed to save registry index", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      await this._cache.set(this._registryCacheKey(), registry, "registry");
    } catch {
      this._logger.debug("Failed to cache registry");
    }

    this._diagnostics.recordTotal(Date.now() - totalStart);
    this._cachedDiagnostics = this._diagnostics.buildDiagnostics(
      this._snapshot,
      this._resourceIndex,
      result.source,
      "miss",
      "fresh",
      this._provider?.type ?? "unknown",
    );

    await this._emitAfterLoad(registry, totalStart);
    return registry;
  }

  async getResource(id: string): Promise<RegistryResource | null> {
    const startTime = Date.now();

    if (this._resourceIndex !== null) {
      const resource =
        this._resourceIndex.byId.get(id) ??
        [...this._resourceIndex.byId.values()].find((r) => r.manifestId === id);
      this._diagnostics.trackIdLookup();
      this._diagnostics.recordResourceLookup(Date.now() - startTime);
      return resource ?? null;
    }

    const registry = await this.load();
    this._diagnostics.trackIdLookup();
    const resource =
      registry.resources.find((r) => r.id === id || r.manifestId === id) ??
      null;
    this._diagnostics.recordResourceLookup(Date.now() - startTime);
    return resource;
  }

  async getResourceByName(name: string): Promise<RegistryResource | null> {
    const startTime = Date.now();

    if (this._resourceIndex !== null) {
      const resource = this._resourceIndex.byName.get(name);
      this._diagnostics.trackNameLookup();
      this._diagnostics.recordResourceLookup(Date.now() - startTime);
      return resource ?? null;
    }

    const registry = await this.load();
    this._diagnostics.trackNameLookup();
    const resource = registry.resources.find((r) => r.name === name) ?? null;
    this._diagnostics.recordResourceLookup(Date.now() - startTime);
    return resource;
  }

  async getResourcesByCategory(
    categoryId: string,
  ): Promise<ReadonlyArray<RegistryResource>> {
    const startTime = Date.now();

    if (this._resourceIndex !== null) {
      const resources = this._resourceIndex.byCategory.get(categoryId) ?? [];
      this._diagnostics.trackCategoryLookup();
      this._diagnostics.recordResourceLookup(Date.now() - startTime);
      return resources;
    }

    const registry = await this.load();
    this._diagnostics.trackCategoryLookup();
    const resources = registry.resources.filter(
      (r) => r.category === categoryId,
    );
    this._diagnostics.recordResourceLookup(Date.now() - startTime);
    return resources;
  }

  async getResourcesByTag(
    tag: string,
  ): Promise<ReadonlyArray<RegistryResource>> {
    const startTime = Date.now();

    if (this._resourceIndex !== null) {
      const resources = this._resourceIndex.byTag.get(tag) ?? [];
      this._diagnostics.trackTagLookup();
      this._diagnostics.recordResourceLookup(Date.now() - startTime);
      return resources;
    }

    const registry = await this.load();
    this._diagnostics.trackTagLookup();
    const resources = registry.resources.filter((r) => r.tags.includes(tag));
    this._diagnostics.recordResourceLookup(Date.now() - startTime);
    return resources;
  }

  async getCategory(categoryId: string): Promise<RegistryCategory | null> {
    const registry = await this.load();
    return registry.categories.find((c) => c.id === categoryId) ?? null;
  }

  async getCategories(): Promise<ReadonlyArray<RegistryCategory>> {
    const registry = await this.load();
    return registry.categories;
  }

  async getResources(): Promise<ReadonlyArray<RegistryResource>> {
    const registry = await this.load();
    return registry.resources;
  }

  async getDiagnostics(): Promise<RegistryDiagnostics> {
    if (this._cachedDiagnostics !== null) {
      return this._cachedDiagnostics;
    }

    return this._diagnostics.buildDiagnostics(
      this._snapshot,
      this._resourceIndex,
      "cache",
      "unknown",
      "unknown",
      this._provider?.type ?? "unknown",
    );
  }

  async getVersions(resourceId: string): Promise<ReadonlyArray<string>> {
    if (this._resourceIndex !== null) {
      const versionIndex = this._resourceIndex.versionIndex.get(resourceId);
      this._diagnostics.trackVersionLookup();
      if (versionIndex !== undefined) {
        return versionIndex.versions.map((v) => v.version);
      }
      return [];
    }

    const registry = await this.load();
    this._diagnostics.trackVersionLookup();
    return registry.resources
      .filter((r) => r.id === resourceId)
      .map((r) => r.version)
      .sort((a, b) => b.localeCompare(a));
  }

  async fetchManifest(
    resourceId: string,
  ): Promise<Record<string, unknown> | null> {
    const resource = await this.getResource(resourceId);
    if (resource === null) return null;

    const cacheKey = `manifest:${this._config.repository}:${resource.manifestPath}`;
    try {
      const cached = await this._cache.get<Record<string, unknown>>(cacheKey);
      if (cached !== null) return cached.data;
    } catch {
      this._logger.debug("Manifest cache read failed", { resourceId });
    }

    if (this._offline) {
      this._logger.debug("Offline mode: manifest not cached", { resourceId });
      return null;
    }

    const fetchKey = buildManifestFetchKey(
      this._config.repository,
      resource.manifestPath,
    );
    try {
      const manifest = await this._singleFlight.do<Record<string, unknown>>(
        fetchKey,
        async () => {
          const fetchProvider = this._provider;
          if (fetchProvider !== null) {
            return fetchProvider.readJson<Record<string, unknown>>(
              resource.manifestPath,
            );
          }
          return this._repos.readJson<Record<string, unknown>>(
            resource.manifestPath,
          );
        },
      );

      try {
        await this._cache.set(cacheKey, manifest, "manifest");
      } catch {
        this._logger.debug("Failed to cache manifest", { resourceId });
      }

      return manifest;
    } catch {
      this._logger.debug("Failed to fetch manifest", { resourceId });
      return null;
    }
  }

  async fetchManifests(
    resourceIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, Record<string, unknown>>> {
    const results = new Map<string, Record<string, unknown>>();
    const toFetch: Array<{ id: string; path: string }> = [];

    for (const id of resourceIds) {
      const resource = await this.getResource(id);
      if (resource === null) continue;

      const cacheKey = `manifest:${this._config.repository}:${resource.manifestPath}`;
      try {
        const cached = await this._cache.get<Record<string, unknown>>(cacheKey);
        if (cached !== null) {
          results.set(id, cached.data);
          continue;
        }
      } catch {
        // will fetch
      }

      toFetch.push({ id, path: resource.manifestPath });
    }

    if (toFetch.length === 0 || this._offline) return results;

    const fetches = toFetch.map(async ({ id, path }) => {
      const fetchKey = buildManifestFetchKey(this._config.repository, path);
      try {
        const manifest = await this._singleFlight.do<Record<string, unknown>>(
          fetchKey,
          async () => {
            const fetchProvider = this._provider;
            if (fetchProvider !== null) {
              return fetchProvider.readJson<Record<string, unknown>>(path);
            }
            return this._repos.readJson<Record<string, unknown>>(path);
          },
        );

        const cacheKey = `manifest:${this._config.repository}:${path}`;
        try {
          await this._cache.set(cacheKey, manifest, "manifest");
        } catch {
          // ignore cache write errors
        }

        results.set(id, manifest);
      } catch {
        this._logger.debug("Failed to fetch manifest", { id });
      }
    });

    await Promise.allSettled(fetches);
    return results;
  }

  invalidate(): void {
    this._registry = null;
    this._snapshot = null;
    this._resourceIndex = null;
    this._cachedDiagnostics = null;
    this._singleFlight.clear();
  }

  private _registryCacheKey(): string {
    return `registry:${this._config.repository}:${this._config.branch}`;
  }

  /**
   * Stale fallback used when remote discovery fails (rate limit, outage).
   * Serves the local index or cache regardless of freshness so startup and
   * reads keep working with clearly-marked stale data.
   */
  private async _loadStaleRegistry(
    totalStart: number,
  ): Promise<Registry | null> {
    if (this._indexManager !== null) {
      try {
        const localIndex = await this._indexManager.loadLocal();
        if (localIndex !== null) {
          const registry = this._indexManager.indexToRegistry(localIndex);
          this._logger.warn("Using stale local registry index", {
            revision: localIndex.revision,
          });
          this._registry = registry;
          this._snapshot = buildRegistrySnapshot(
            registry,
            localIndex.revision,
            (localIndex.metadata.source as "registry.json" | "manifest-scan") ??
              "registry.json",
          );
          this._resourceIndex = this._resourceIndexBuilder.build(
            registry.resources,
          );
          this._diagnostics.recordTotal(Date.now() - totalStart);
          await this._emitAfterLoad(registry, totalStart);
          return registry;
        }
      } catch {
        this._logger.debug("Stale index unavailable");
      }
    }

    try {
      const cached = await this._cache.get<Registry>(this._registryCacheKey());
      if (cached !== null) {
        this._logger.warn("Using stale cached registry", {
          cachedAt: cached.cachedAt,
        });
        this._registry = cached.data;
        this._snapshot = buildRegistrySnapshot(
          cached.data,
          { checkedAt: cached.cachedAt },
          "registry.json",
        );
        this._resourceIndex = this._resourceIndexBuilder.build(
          cached.data.resources,
        );
        this._diagnostics.recordTotal(Date.now() - totalStart);
        await this._emitAfterLoad(cached.data, totalStart);
        return cached.data;
      }
    } catch {
      this._logger.debug("Stale cache unavailable");
    }

    return null;
  }

  private async _fetchManifestsParallel(
    resourceIds: ReadonlyArray<string>,
  ): Promise<void> {
    const batch = resourceIds.slice(0, 50);
    const fetches = batch.map(async (id) => {
      const resource = this._resourceIndex?.byId.get(id);
      if (resource === null || resource === undefined) return;

      const cacheKey = `manifest:${this._config.repository}:${resource.manifestPath}`;
      try {
        const cached = await this._cache.get<Record<string, unknown>>(cacheKey);
        if (cached !== null) return;
      } catch {
        // will fetch
      }

      const fetchKey = buildManifestFetchKey(
        this._config.repository,
        resource.manifestPath,
      );
      try {
        await this._singleFlight.do<Record<string, unknown>>(
          fetchKey,
          async () => {
            const fetchProvider = this._provider;
            if (fetchProvider !== null) {
              return fetchProvider.readJson<Record<string, unknown>>(
                resource.manifestPath,
              );
            }
            return this._repos.readJson<Record<string, unknown>>(
              resource.manifestPath,
            );
          },
        );
      } catch {
        this._logger.debug("Manifest pre-fetch failed", { id });
      }
    });

    await Promise.allSettled(fetches);
  }

  private async _revalidateInBackground(): Promise<void> {
    try {
      await this.load({ refresh: true });
    } catch {
      this._logger.debug("Background revalidation failed");
    }
  }

  private async _emitAfterLoad(
    registry: Registry,
    startTime: number,
  ): Promise<void> {
    await this._events.emit("afterRegistryLoad", {
      registry,
      duration: Date.now() - startTime,
    });
  }
}
