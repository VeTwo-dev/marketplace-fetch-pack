import type { MarketplaceConfig, ResolvedConfig } from "../types/config.js";
import type { SearchQuery, SearchResult } from "../types/search.js";
import type {
  InstallOptions,
  InstallResult,
  DryRunResult,
} from "../types/install.js";
import type { RegistryCategory, RegistryResource } from "../types/registry.js";
import type { Resource } from "../types/resource.js";
import type { DependencyGraph } from "../types/dependencies.js";
import type { DetectedProject, FrameworkType } from "../types/detection.js";
import type { DoctorReport } from "../types/doctor.js";
import type { Plugin } from "../types/plugin.js";
import type { CacheStats } from "../types/cache.js";
import type {
  MarketplaceEvent,
  MarketplaceEventData,
  EventListener,
  EventUnsubscribe,
} from "../types/events.js";
import type { RegistryProvider } from "../types/providers.js";
import type { TransformRegistry } from "../types/transform.js";
import type { MergeRegistry } from "../types/merge.js";
import type { SnapshotManager, SnapshotConfig } from "../types/snapshot.js";
import type { LockFileService } from "../types/lockfile.js";
import type { DatabaseService } from "../types/database.js";
import { ConfigManager } from "../config/index.js";
import { Cache } from "../cache/index.js";
import { EventBus } from "../events/index.js";
import { PluginManager } from "../plugins/index.js";
import { RegistryClient } from "../registry/index.js";
import { RegistryIndexManager } from "../registry/registry-index.js";
import { RevisionDetector } from "../registry/revision-detector.js";
import { SearchEngine } from "../search/index.js";
import { DependencyResolver } from "../dependencies/index.js";
import { VersionResolver } from "../versions/index.js";
import { Downloader } from "../downloader/index.js";
import { DownloadEngine } from "../download/DownloadEngine.js";
import { CacheManager } from "../cache/CacheManager.js";
import { DownloadMetricsCollector } from "../download/metrics.js";
import { Installer } from "../installer/index.js";
import { OfflinePolicy } from "../offline/policy.js";
import { NetworkAccessGuard } from "../offline/guard.js";
import { NodeFetchTransport } from "../transport/node-fetch-transport.js";
import { OperationHistory } from "../state/history.js";
import { StateRecovery } from "../state/recovery.js";
import { ProjectDetector } from "../detection/index.js";
import { Doctor } from "../doctor/index.js";
import { ManifestParser } from "../manifest/index.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { registryResourceToResource } from "../types/registry.js";
import { InstallPipeline, createInstallPipeline } from "../pipeline/core.js";
import { createTransformRegistry } from "../transform/index.js";
import { createMergeRegistry } from "../merge/index.js";
import {
  createTypeRegistry,
  type ResourceTypeRegistry,
} from "../resource-types/index.js";
import {
  createInstallerRegistry,
  type InstallerRegistry,
} from "../installer-registry/index.js";
import { createSnapshotManager } from "../snapshot/index.js";
import { createLockFileService } from "../lockfile/index.js";
import { createDatabaseService } from "../database/index.js";
import { TransactionManager } from "../transaction/index.js";
import {
  resolveStatePaths,
  MarketplaceStateManager,
  type MarketplaceStatePaths,
} from "../state/index.js";
import { MARKETPLACE_VERSION } from "../constants.js";
import {
  DiagnosticCollector,
  PerformanceTimeline,
} from "../diagnostics/index.js";
import { redactContext } from "../errors/index.js";

export interface MarketplaceOptions {
  readonly config?: MarketplaceConfig;
  readonly logger?: Logger;
}

export class Marketplace {
  private readonly _configManager: ConfigManager;
  private _config: ResolvedConfig;
  private readonly _initialConfig?: MarketplaceConfig;
  private readonly _cache: Cache;
  private readonly _events: EventBus;
  private readonly _plugins: PluginManager;
  private _registryClient: RegistryClient;
  private readonly _searchEngine: SearchEngine;
  private readonly _depResolver: DependencyResolver;
  private readonly _versionResolver: VersionResolver;
  private _downloader: Downloader;
  private _cacheManager: CacheManager | null = null;
  private _downloadEngine: DownloadEngine | null = null;
  private _downloadMetrics: DownloadMetricsCollector | null = null;
  private _offlinePolicy: OfflinePolicy | null = null;
  private _networkGuard: NetworkAccessGuard | null = null;
  private _transport: NodeFetchTransport | null = null;
  private _operationHistory: OperationHistory | null = null;
  private _stateRecovery: StateRecovery | null = null;
  private _installer: Installer;
  private readonly _detector: ProjectDetector;
  private readonly _doctor: Doctor;
  private readonly _manifestParser: ManifestParser;
  private readonly _logger: Logger;
  private _loaded = false;

  private _pipeline: InstallPipeline | null = null;
  private _transformRegistry: TransformRegistry | null = null;
  private _mergeRegistry: MergeRegistry | null = null;
  private _typeRegistry: ResourceTypeRegistry | null = null;
  private _installerRegistry: InstallerRegistry | null = null;
  private readonly _diagnosticsCollector = new DiagnosticCollector();
  private readonly _timeline = new PerformanceTimeline();
  private _snapshotManager: SnapshotManager | null = null;
  private _lockFileService: LockFileService | null = null;
  private _database: DatabaseService | null = null;
  private _statePaths: MarketplaceStatePaths | null = null;
  private _stateManager: MarketplaceStateManager | null = null;
  private _indexManager: RegistryIndexManager | null = null;
  private _revisionDetector: RevisionDetector | null = null;
  private _transactionManager: TransactionManager | null = null;

  constructor(options: MarketplaceOptions = {}) {
    this._logger = options.logger ?? createLogger({ prefix: "marketplace" });

    this._configManager = new ConfigManager();
    if (options.config !== undefined) {
      // Apply constructor config immediately so it is not silently dropped.
      // load() without args preserves it (see _initialConfig).
      this._configManager.update(options.config);
    }
    this._initialConfig = options.config;
    this._config = this._configManager.config;

    this._cache = new Cache(this._config.cache, this._logger.child("cache"));
    this._events = new EventBus(this._logger.child("events"));
    this._offlinePolicy = new OfflinePolicy(
      this._config,
      this._logger.child("offline"),
    );
    this._networkGuard = new NetworkAccessGuard(
      this._offlinePolicy,
      this._logger.child("guard"),
    );
    this._transport = new NodeFetchTransport(
      this._logger.child("transport"),
      undefined,
      this._networkGuard,
    );
    this._statePaths = resolveStatePaths(this._config.destination);
    this._plugins = new PluginManager(this._logger.child("plugins"), {
      stateDir: this._statePaths.plugins,
      events: this._events,
    });

    this._indexManager = new RegistryIndexManager(
      this._statePaths,
      this._logger.child("index"),
    );
    this._revisionDetector = new RevisionDetector(
      this._config,
      this._logger.child("revision"),
    );

    this._registryClient = new RegistryClient(
      this._config,
      this._cache,
      this._events,
      this._logger.child("registry"),
      this._indexManager,
      this._revisionDetector,
      undefined,
      undefined,
      this._config.offline,
    );
    this._searchEngine = new SearchEngine(
      this._events,
      this._plugins,
      this._logger.child("search"),
    );
    this._depResolver = new DependencyResolver(this._logger.child("deps"));
    this._versionResolver = new VersionResolver(this._logger.child("versions"));
    this._downloader = new Downloader(
      this._config,
      this._cache,
      this._events,
      this._logger.child("downloader"),
    );
    this._detector = new ProjectDetector(this._logger.child("detector"));
    this._doctor = new Doctor(
      this._config,
      this._cache,
      this._logger.child("doctor"),
    );
    this._manifestParser = new ManifestParser(this._logger.child("manifest"));

    this._transformRegistry = createTransformRegistry();
    this._mergeRegistry = createMergeRegistry();
    this._typeRegistry = createTypeRegistry(
      this._logger.child("resource-types"),
      this._events,
    );
    this._installerRegistry = createInstallerRegistry(
      this._logger.child("installers"),
      this._events,
    );

    this._pipeline = createInstallPipeline(
      this._events,
      this._logger.child("pipeline"),
      {
        transformRegistry: this._transformRegistry,
        typeRegistry: this._typeRegistry,
      },
    );
    this._lockFileService = createLockFileService();

    this._statePaths = resolveStatePaths(this._config.destination);
    const snapshotConfig: SnapshotConfig = {
      enabled: true,
      maxSnapshots: 50,
      retentionDays: 30,
      directory: this._statePaths.snapshots,
    };
    this._snapshotManager = createSnapshotManager(
      this._config.destination,
      snapshotConfig,
      this._statePaths.root,
    );
    this._database = createDatabaseService(this._statePaths.database);

    this._stateManager = new MarketplaceStateManager(
      this._config.destination,
      this._logger.child("state"),
    );
    this._operationHistory = new OperationHistory(this._stateManager);
    this._stateRecovery = new StateRecovery(
      this._stateManager,
      this._logger.child("state-recovery"),
    );
    this._transactionManager = new TransactionManager(
      this._stateManager,
      this._logger.child("transaction"),
      this._events,
    );
    // Unified cache + high-performance download engine
    this._cacheManager = new CacheManager(
      this._stateManager,
      undefined,
      this._logger.child("cache-manager"),
      this._events,
    );
    this._downloadMetrics = new DownloadMetricsCollector();
    this._downloadEngine = new DownloadEngine(
      this._stateManager,
      this._cacheManager,
      { maxConcurrency: this._config.concurrency ?? 6 },
      undefined,
      this._logger.child("download-engine"),
      this._downloadMetrics,
      undefined,
      this._transport!,
    );
    // Rebuild downloader on top of the engine: single retry owner (engine),
    // streaming + atomic writes over the shared native transport.
    this._downloader = new Downloader(
      this._config,
      this._cache,
      this._events,
      this._logger.child("downloader"),
      this._downloadEngine,
    );

    // Keep doctor's runtime wiring current: managers are rebuilt here.
    this._doctor.updateDeps({
      transactionManager: this._transactionManager ?? undefined,
      stateManager: this._stateManager ?? undefined,
      cacheManager: this._cacheManager ?? undefined,
      // Zero-network probe: local index presence only, never a live fetch.
      registryProbe: async () =>
        (await this._indexManager?.loadLocal().catch(() => null)) !== null,
    });

    this._installer = new Installer(
      this._config,
      this._downloader,
      this._depResolver,
      this._versionResolver,
      this._events,
      this._cache,
      this._plugins,
      {
        pipeline: this._pipeline!,
        transactionManager: this._transactionManager,
        snapshotManager: this._snapshotManager,
        lockFileService: this._lockFileService,
        database: this._database,
      },
      this._logger.child("installer"),
      this._downloadEngine,
    );
  }

  get config(): ResolvedConfig {
    return this._config;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  getPipeline(): InstallPipeline | null {
    return this._pipeline;
  }

  getTransformRegistry(): TransformRegistry | null {
    return this._transformRegistry;
  }

  getMergeRegistry(): MergeRegistry | null {
    return this._mergeRegistry;
  }

  getTypeRegistry(): ResourceTypeRegistry | null {
    return this._typeRegistry;
  }

  getInstallerRegistry(): InstallerRegistry | null {
    return this._installerRegistry;
  }

  getSnapshotManager(): SnapshotManager | null {
    return this._snapshotManager;
  }

  getLockFileService(): LockFileService | null {
    return this._lockFileService;
  }

  getDatabase(): DatabaseService | null {
    return this._database;
  }

  setProvider(provider: RegistryProvider): void {
    this._registryClient.setProvider(provider);
    this._logger.debug("Marketplace provider set", { type: provider.type });
  }

  async load(config?: MarketplaceConfig): Promise<void> {
    this._config = await this._configManager.load(
      config ?? this._initialConfig,
    );
    this._rebuildComponents();
    this._plugins.setPluginConfigs(this._config.plugins);
    await this._cache.initialize();

    // Lazy: only state is mandatory at startup; cache/tx deferred until needed (install/tx commands)
    if (this._stateManager !== null) {
      await this._stateManager.initialize();
      await this._stateRecovery?.recover().catch(() => {});
    }
    // Defer heavy CacheManager/TransactionManager init — search/doctor don't need it (lazy)
    if (this._cache !== null) {
      // legacy cache still init for registry (small)
    }

    if (this._database !== null) {
      await this._database.initialize(this._statePaths!.database);
    }

    if (this._config.networkMode === "prefer-offline") {
      // Prefer-offline (Step 47): serve from local state immediately;
      // remote refresh only fills gaps. Registry load failures degrade
      // gracefully instead of failing startup.
      this._logger.info("Prefer-offline mode: serving local state first");
      let registry;
      try {
        registry = await this._registryClient.load();
      } catch {
        this._logger.warn(
          "Prefer-offline: registry unavailable — using cached state only",
        );
        this._searchEngine.setResources([]);
        this._depResolver.setResources([]);
      }
      if (registry !== undefined) {
        this._searchEngine.setResources(registry.resources);
        this._depResolver.setResources(registry.resources);
      }
    } else if (this._config.offline) {
      // Offline mode: NEVER attempt network. Serve from local cache/state only.
      this._logger.info("Offline mode: loading from local cache");
      try {
        const cached = await this._registryClient.load();
        this._searchEngine.setResources(cached.resources);
        this._depResolver.setResources(cached.resources);
        await this._events
          .emit("localRegistryLoaded", {
            revision: cached.version,
            stale: false,
          })
          .catch(() => {});
      } catch {
        this._logger.warn("Offline: no cached registry — search will be empty");
        this._searchEngine.setResources([]);
        this._depResolver.setResources([]);
        await this._events
          .emit("offlineCapabilityFailure", {
            operation: "registry-load",
            reason: "no cached registry",
          })
          .catch(() => {});
      }
    } else {
      let registry;
      try {
        registry = await this._registryClient.load();
      } catch (error) {
        this._diagnosticsCollector.error(
          "registry",
          "REGISTRY_LOAD_FAILED",
          `Registry load failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this._logger.warn(
          "Registry unavailable — continuing with empty resource set",
          {
            error: error instanceof Error ? error.message : String(error),
            code:
              error instanceof MarketplaceClientError ? error.code : undefined,
          },
        );
        this._searchEngine.setResources([]);
        this._depResolver.setResources([]);
        this._loaded = true;
        return;
      }
      this._searchEngine.setResources(registry.resources);
      this._depResolver.setResources(registry.resources);
    }

    this._loaded = true;
    this._logger.info(
      `Marketplace loaded (offline=${this._config.offline}): ${this._searchEngine !== null ? "ready" : "no engine"}`,
    );
  }

  async search(query: string | SearchQuery): Promise<SearchResult> {
    this._ensureLoaded();

    const searchQuery: SearchQuery =
      typeof query === "string" ? { keyword: query } : query;

    return this._searchEngine.search(searchQuery);
  }

  async install(idOrOptions: string | InstallOptions): Promise<InstallResult> {
    this._ensureLoaded();

    const options: InstallOptions =
      typeof idOrOptions === "string" ? { id: idOrOptions } : idOrOptions;

    const resource = await this._resolveResource(options.id, options.version);

    return this._installer.install(resource, options);
  }

  private async _installViaPipeline(
    resource: RegistryResource,
    options: InstallOptions,
  ): Promise<InstallResult> {
    const startTime = Date.now();

    const context = {
      resourceId: resource.id,
      version: options.version ?? resource.version,
      destination: options.destination ?? this._config.destination,
      variables: {},
      options: {
        force: options.force ?? false,
        dryRun: options.dryRun ?? false,
        skipDependencies: false,
        skipTransforms: false,
        skipMerge: false,
        skipValidation: false,
        concurrency: this._config.concurrency,
      },
      manifest: resource,
      resourceType: this._resolveResourceType(resource),
      files: [],
      snapshot: null,
      errors: [],
      warnings: [],
      metadata: {
        startTime,
        stagesCompleted: [],
        filesProcessed: 0,
        bytesWritten: 0,
      },
    };

    const result = await this._pipeline!.execute(context);

    return {
      success: result.success,
      id: result.resourceId,
      version: result.version,
      destination: result.destination,
      filesInstalled: result.filesWritten.length,
      dependenciesInstalled: 0,
      duration: result.duration,
      dryRun: options.dryRun ?? false,
      report: {
        id: result.resourceId,
        version: result.version,
        installedAt: new Date().toISOString(),
        files: result.filesWritten.map((f) => ({ path: f, sha: "", size: 0 })),
        dependencies: [],
        warnings: result.warnings,
        integrity: {
          verified: true,
          filesChecked: 0,
          filesMatched: 0,
          mismatches: [],
        },
      },
    };
  }

  async preview(id: string): Promise<DryRunResult> {
    this._ensureLoaded();

    const resource = await this._resolveResource(id);

    if (this._pipeline !== null && this._pipeline.getStages().length > 0) {
      return this._previewViaPipeline(resource);
    }

    return this._installer.dryRun(resource);
  }

  private async _previewViaPipeline(
    resource: RegistryResource,
  ): Promise<DryRunResult> {
    const startTime = Date.now();

    const context = {
      resourceId: resource.id,
      version: resource.version,
      destination: this._config.destination,
      variables: {},
      options: {
        force: false,
        dryRun: true,
        skipDependencies: false,
        skipTransforms: false,
        skipMerge: false,
        skipValidation: false,
        concurrency: this._config.concurrency,
      },
      manifest: resource,
      resourceType: this._resolveResourceType(resource),
      files: [],
      snapshot: null,
      errors: [],
      warnings: [],
      metadata: {
        startTime,
        stagesCompleted: [],
        filesProcessed: 0,
        bytesWritten: 0,
      },
    };

    const result = await this._pipeline!.execute(context);

    return {
      wouldInstall: result.filesWritten.map((f) => ({ path: f, size: 0 })),
      wouldDownload: [],
      estimatedSize: 0,
      conflicts: [],
    };
  }

  async info(id: string): Promise<Resource | null> {
    this._ensureLoaded();

    const registryResource = await this._registryClient.getResource(id);
    if (registryResource === null) return null;

    return registryResourceToResource(registryResource);
  }

  async categories(): Promise<ReadonlyArray<RegistryCategory>> {
    this._ensureLoaded();
    return this._registryClient.getCategories();
  }

  async resources(): Promise<ReadonlyArray<RegistryResource>> {
    this._ensureLoaded();
    return this._registryClient.getResources();
  }

  async remove(id: string): Promise<void> {
    this._ensureLoaded();
    await this._installer.remove(id, this._config.destination);
  }

  async list(): Promise<ReadonlyArray<string>> {
    return this._installer.list(this._config.destination);
  }

  async dependencies(id: string): Promise<DependencyGraph> {
    this._ensureLoaded();
    return this._depResolver.resolve(id);
  }

  async update(): Promise<void> {
    this._registryClient.invalidate();
    this._loaded = false;
    await this.load(this._configManager.config);
  }

  async doctor(): Promise<DoctorReport> {
    return this._doctor.run();
  }

  async detectProject(rootPath?: string): Promise<DetectedProject> {
    return this._detector.detect(rootPath);
  }

  async getRecommendedFrameworks(): Promise<ReadonlyArray<FrameworkType>> {
    const project = await this.detectProject();
    return this._detector.getCompatibleFrameworks(project);
  }

  async cacheStats(): Promise<CacheStats> {
    return this._cache.stats();
  }

  async cacheClear(): Promise<void> {
    await this._cache.clear();
  }

  // ─── Phase 15: Diagnostics API ──────────────────────────────────────

  /** Structured, machine-readable diagnostics snapshot. */
  async diagnostics(): Promise<Record<string, unknown>> {
    const startTime = Date.now();

    let cacheStatus: Record<string, unknown> = { initialized: false };
    try {
      const stats = await this._cache.stats();
      cacheStatus = { initialized: true, ...stats };
    } catch {
      // cache not initialized
    }

    let lockfileStatus: Record<string, unknown> = { present: false };
    if (this._lockFileService !== null) {
      try {
        const validation = await (
          this._lockFileService as {
            validate?: (
              d: string,
            ) => Promise<{ valid: boolean; errors: string[] }>;
          }
        ).validate?.(this._config.destination);
        if (validation !== undefined) {
          lockfileStatus = {
            present: true,
            valid: validation.valid,
            errors: validation.errors,
          };
        } else {
          lockfileStatus = { present: true };
        }
      } catch {
        lockfileStatus = { present: false };
      }
    }

    return {
      system: {
        marketplaceVersion: MARKETPLACE_VERSION,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeSeconds: Math.round(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      },
      config: this.configDebug(),
      registry: await this.registryDiagnostics(),
      network: this.networkDiagnostics(),
      cache: cacheStatus,
      plugins: this.pluginDiagnostics(),
      resourceTypes: this.resourceTypeDiagnostics(),
      state: {
        destination: this._config.destination,
        offline: this._config.offline,
        lockfile: lockfileStatus,
        database: this._database !== null ? "available" : "unavailable",
        transactions:
          this._transactionManager !== null ? "tracked" : "unavailable",
      },
      performance: {
        timeline: this._timeline.summary(),
      },
      health: {
        loaded: this._loaded,
        recentErrors: this._diagnosticsCollector
          .getBySeverity("error")
          .slice(-10),
        warningCount:
          this._diagnosticsCollector.getBySeverity("warning").length,
        errorCount: this._diagnosticsCollector.getBySeverity("error").length,
      },
      generatedInMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Human/CI-friendly debug report. JSON-serializable.
   * NEVER contains secrets — sensitive values are redacted.
   */
  async debugReport(): Promise<Record<string, unknown>> {
    return redactContext(await this.diagnostics()) as Record<string, unknown>;
  }

  /**
   * Effective configuration with source and redacted secrets.
   * Shows WHY each value was selected where source info is available.
   */
  configDebug(): Record<string, unknown> {
    const cfg = this._config;
    const entries: Array<{
      key: string;
      value: unknown;
      source: string;
      sensitive: boolean;
    }> = [
      {
        key: "repository",
        value: cfg.repository,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "branch",
        value: cfg.branch,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "destination",
        value: cfg.destination,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "concurrency",
        value: cfg.concurrency,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "timeout",
        value: cfg.timeout,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "offline",
        value: cfg.offline,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "autoDetect",
        value: cfg.autoDetect,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "token",
        value: cfg.token !== undefined ? "<redacted>" : undefined,
        source: cfg.token !== undefined ? "environment" : cfg.source,
        sensitive: true,
      },
      {
        key: "cache.directory",
        value: cfg.cache.directory,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "cache.enabled",
        value: cfg.cache.enabled,
        source: cfg.source,
        sensitive: false,
      },
      {
        key: "logger.level",
        value: cfg.logger.level,
        source: cfg.source,
        sensitive: false,
      },
    ];

    return {
      priority: ["default < file < environment < programmatic"],
      values: Object.fromEntries(
        entries.map((e) => [
          e.key,
          {
            value: e.sensitive ? "<redacted>" : (e.value ?? "<unset>"),
            source: e.source,
            ...(e.sensitive ? { redacted: true } : {}),
          },
        ]),
      ),
    };
  }

  private async registryDiagnostics(): Promise<Record<string, unknown>> {
    const status: Record<string, unknown> = {
      repository: this._config.repository,
      branch: this._config.branch,
      offline: this._config.offline,
    };
    try {
      const resources = await this._registryClient.getResources();
      status.manifestCount = resources.length;
      const categories = new Set(resources.map((r) => r.category));
      status.categoryCount = categories.size;
    } catch {
      status.loaded = false;
    }
    return status;
  }

  private networkDiagnostics(): Record<string, unknown> {
    return {
      note: "Aggregate stats from shared network layer",
      timeoutMs: this._config.timeout,
      concurrencyLimit: this._config.concurrency,
      rateLimitTracked: true,
    };
  }

  private pluginDiagnostics(): Record<string, unknown> {
    const manifests = this._plugins.list();
    return {
      count: manifests.length,
      enabled: this._plugins.getEnabled().length,
      plugins: manifests.map((m) => ({
        id: m.id,
        version: m.version,
        capabilities: m.capabilities,
        state: this._plugins.getState(m.id),
      })),
    };
  }

  private resourceTypeDiagnostics(): Record<string, unknown> {
    if (this._typeRegistry === null) return { count: 0 };
    const all = this._typeRegistry.getAll();
    return {
      count: all.length,
      builtin: all.filter((r) => r.source === "builtin").length,
      plugin: all.filter((r) => r.source === "plugin").length,
      types: all.map((r) => ({ id: r.type.id, source: r.source })),
    };
  }

  /** Access to the shared performance timeline for instrumentation. */
  get timeline(): PerformanceTimeline {
    return this._timeline;
  }

  /** Access to the shared diagnostic collector. */
  get diagnosticsCollector(): DiagnosticCollector {
    return this._diagnosticsCollector;
  }

  on<K extends MarketplaceEvent>(
    event: K,
    listener: EventListener<MarketplaceEventData[K]>,
  ): EventUnsubscribe {
    return this._events.on(event, listener);
  }

  once<K extends MarketplaceEvent>(
    event: K,
    listener: EventListener<MarketplaceEventData[K]>,
  ): EventUnsubscribe {
    return this._events.once(event, listener);
  }

  registerPlugin(plugin: Plugin): void {
    this._plugins.register(plugin);
  }

  unregisterPlugin(name: string): boolean {
    return this._plugins.unregister(name);
  }

  listPlugins(): ReadonlyArray<ReturnType<PluginManager["list"]>[number]> {
    return this._plugins.list();
  }

  private _ensureLoaded(): void {
    if (!this._loaded) {
      throw new MarketplaceClientError("REGISTRY_LOAD_FAILED", {
        message: "Marketplace not loaded. Call load() first.",
      });
    }
  }

  /**
   * Resolves the registered resource type id for a registry resource.
   * Uses explicit manifest metadata first, then the type registry's
   * detection — never folder names or hardcoded switch chains.
   */
  private _resolveResourceType(resource: RegistryResource): string | undefined {
    const manifest = resource as unknown as Record<string, unknown>;
    const detected = this._typeRegistry?.detectType(manifest);
    if (detected !== undefined) return detected;

    const category = resource.category;
    if (typeof category === "string" && this._typeRegistry?.has(category)) {
      return category;
    }
    return undefined;
  }

  private async _resolveResource(
    id: string,
    version?: string,
  ): Promise<RegistryResource> {
    const resource = await this._registryClient.getResource(id);
    if (resource === null) {
      throw new MarketplaceClientError("RESOURCE_NOT_FOUND", {
        message: `Resource not found: ${id}`,
        context: { id, version },
      });
    }

    if (version !== undefined && version !== "latest") {
      const allResources = await this._registryClient.getResources();
      const matching = allResources.filter(
        (r) => r.id === id || r.manifestId === id,
      );
      const resolved = this._versionResolver.resolveVersion(matching, version);

      if (resolved === null || !resolved.satisfies) {
        throw new MarketplaceClientError("VERSION_NOT_FOUND", {
          message: `Version ${version} not found for resource: ${id}`,
          context: { id, version },
        });
      }
    }

    return resource;
  }

  private _rebuildComponents(): void {
    this._statePaths = resolveStatePaths(this._config.destination);

    this._indexManager = new RegistryIndexManager(
      this._statePaths,
      this._logger.child("index"),
    );
    this._revisionDetector = new RevisionDetector(
      this._config,
      this._logger.child("revision"),
    );

    this._registryClient = new RegistryClient(
      this._config,
      this._cache,
      this._events,
      this._logger.child("registry"),
      this._indexManager,
      this._revisionDetector,
      undefined,
      undefined,
      this._config.offline,
    );
    this._downloader = new Downloader(
      this._config,
      this._cache,
      this._events,
      this._logger.child("downloader"),
    );

    this._transformRegistry = createTransformRegistry();
    this._mergeRegistry = createMergeRegistry();
    this._typeRegistry = createTypeRegistry(
      this._logger.child("resource-types"),
      this._events,
    );
    this._installerRegistry = createInstallerRegistry(
      this._logger.child("installers"),
      this._events,
    );
    this._lockFileService = createLockFileService();

    const snapshotConfig: SnapshotConfig = {
      enabled: true,
      maxSnapshots: 50,
      retentionDays: 30,
      directory: this._statePaths.snapshots,
    };
    this._snapshotManager = createSnapshotManager(
      this._config.destination,
      snapshotConfig,
      this._statePaths.root,
    );
    this._database = createDatabaseService(this._statePaths.database);

    this._stateManager = new MarketplaceStateManager(
      this._config.destination,
      this._logger.child("state"),
    );
    this._operationHistory = new OperationHistory(this._stateManager);
    this._stateRecovery = new StateRecovery(
      this._stateManager,
      this._logger.child("state-recovery"),
    );
    this._transactionManager = new TransactionManager(
      this._stateManager,
      this._logger.child("transaction"),
      this._events,
    );

    this._pipeline = createInstallPipeline(
      this._events,
      this._logger.child("pipeline"),
      {
        transformRegistry: this._transformRegistry,
        typeRegistry: this._typeRegistry,
      },
    );

    // Rebuild cache manager / download engine on reconfigure
    this._cacheManager = new CacheManager(
      this._stateManager!,
      undefined,
      this._logger.child("cache-manager"),
      this._events,
    );
    this._downloadMetrics = new DownloadMetricsCollector();
    this._downloadEngine = new DownloadEngine(
      this._stateManager!,
      this._cacheManager,
      { maxConcurrency: this._config.concurrency ?? 6 },
      undefined,
      this._logger.child("download-engine"),
      this._downloadMetrics,
      undefined,
      this._transport!,
    );
    this._downloader = new Downloader(
      this._config,
      this._cache,
      this._events,
      this._logger.child("downloader"),
      this._downloadEngine,
    );

    // Keep doctor's runtime wiring current: managers are rebuilt here.
    this._doctor.updateDeps({
      transactionManager: this._transactionManager ?? undefined,
      stateManager: this._stateManager ?? undefined,
      cacheManager: this._cacheManager ?? undefined,
      // Zero-network probe: local index presence only, never a live fetch.
      registryProbe: async () =>
        (await this._indexManager?.loadLocal().catch(() => null)) !== null,
    });

    this._installer = new Installer(
      this._config,
      this._downloader,
      this._depResolver,
      this._versionResolver,
      this._events,
      this._cache,
      this._plugins,
      {
        pipeline: this._pipeline,
        transactionManager: this._transactionManager,
        snapshotManager: this._snapshotManager,
        lockFileService: this._lockFileService,
        database: this._database,
      },
      this._logger.child("installer"),
      this._downloadEngine,
    );
  }
}
