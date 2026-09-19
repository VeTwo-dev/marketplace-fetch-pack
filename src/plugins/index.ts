import type {
  Plugin,
  PluginManifest,
  PluginHooks,
  PluginContext,
  PluginEntry,
  PluginState,
  PluginRegistrationOptions,
  PluginCapability,
  PluginLogger,
  PluginConfigAccess,
  PluginStateAccess,
  PluginEventAccess,
  PluginPermission,
} from "../types/plugin.js";
import type { SearchQuery, SearchResult } from "../types/search.js";
import type { InstallOptions, InstallResult } from "../types/install.js";
import type { DownloadOptions, DownloadResult } from "../types/download.js";
import type { Registry } from "../types/registry.js";
import type { CompatibilityResult } from "../types/versions.js";
import type { DetectedProject } from "../types/detection.js";
import type { ResourceTypeDefinition } from "../types/resource-types.js";
import type { PipelineContext } from "../types/pipeline.js";
import type { MergeResult } from "../types/merge.js";
import type { TransformResult } from "../types/transform.js";
import type { Resource } from "../types/resource.js";
import type { WizardStep } from "../types/plugin.js";
import { HookSystem } from "../hooks/index.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { VersionResolver } from "../versions/index.js";
import { EventBus } from "../events/index.js";
import type { PluginConfigInput } from "../types/config.js";
import { MARKETPLACE_VERSION } from "../constants.js";
import { PluginStateStore } from "./state-store.js";

export interface PluginManagerOptions {
  /** Directory for namespaced plugin state (e.g. .vetwo/marketplace/plugins) */
  readonly stateDir?: string;
  /** Event bus for extension observability events */
  readonly events?: EventBus;
}

export class PluginManager {
  private readonly _plugins: Map<string, PluginEntry> = new Map();
  private readonly _hookSystem: HookSystem;
  private readonly _logger: Logger;
  private readonly _versionResolver = new VersionResolver();
  private readonly _events: EventBus | null;
  private _context: PluginContext | null = null;
  private _initialized = false;
  private _stateStore: PluginStateStore | null = null;
  private _pluginConfigs: ReadonlyArray<PluginConfigInput> = [];
  private readonly _ephemeralState = new Map<string, Record<string, unknown>>();

  constructor(logger?: Logger, options?: PluginManagerOptions) {
    this._logger = logger ?? createLogger({ prefix: "plugins" });
    this._hookSystem = new HookSystem(this._logger.child("hooks"));
    this._events = options?.events ?? null;
    if (options?.stateDir !== undefined) {
      this._stateStore = new PluginStateStore(options.stateDir);
    }
  }

  /**
   * Provides the resolved plugin configuration entries so each plugin's
   * PluginContext.config resolves its own `options` namespace first.
   */
  setPluginConfigs(configs: ReadonlyArray<PluginConfigInput>): void {
    this._pluginConfigs = configs;
  }

  setContext(context: PluginContext): void {
    this._context = context;
  }

  get hookSystem(): HookSystem {
    return this._hookSystem;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;

    const ordered = this._getInitializationOrder();

    // Dependency existence is a hard failure independent of failure policy
    for (const entry of ordered) {
      if (!entry.enabled) continue;
      const deps = entry.plugin.manifest.dependencies;
      if (deps !== undefined) {
        for (const dep of deps) {
          if (!this._plugins.has(dep.id)) {
            throw new MarketplaceClientError("EXTENSION_DEPENDENCY_CONFLICT", {
              message: `Missing plugin dependency: ${dep.id}`,
              context: { plugin: entry.plugin.manifest.id, dependency: dep.id },
            });
          }
        }
      }
    }

    const errors: Array<{ pluginId: string; error: Error }> = [];

    for (const entry of ordered) {
      if (entry.state === "initialized" || entry.state === "ready") continue;
      if (!entry.enabled) continue;

      const startTime = Date.now();
      try {
        await this._initializePlugin(entry);
        void this._events?.emit("pluginInitialized", {
          pluginId: entry.plugin.manifest.id,
          duration: Date.now() - startTime,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ pluginId: entry.plugin.manifest.id, error: err });

        if (entry.failurePolicy === "stop") {
          this._setPluginState(entry.plugin.manifest.id, "failed");
          throw new MarketplaceClientError("PLUGIN_INIT_FAILED", {
            cause: err,
            context: { plugin: entry.plugin.manifest.id },
          });
        }

        this._setPluginState(entry.plugin.manifest.id, "failed");
        this._logger.error(
          `Plugin init failed (continuing): ${entry.plugin.manifest.id}`,
          { error: err.message },
        );
        void this._events?.emit("pluginFailed", {
          pluginId: entry.plugin.manifest.id,
          phase: "initialize",
          error: err.message,
        });
      }
    }

    this._initialized = true;

    if (errors.length > 0) {
      this._logger.warn(`${errors.length} plugin(s) failed to initialize`);
    }

    await this._stateStore?.flush();
  }

  async dispose(): Promise<void> {
    const entries = Array.from(this._plugins.values());
    const disposeOrder = [...entries].sort(
      (a, b) =>
        (b.plugin.manifest.priority ?? 0) - (a.plugin.manifest.priority ?? 0),
    );

    for (const entry of disposeOrder) {
      if (entry.state !== "initialized" && entry.state !== "ready") continue;

      const startTime = Date.now();
      try {
        if (entry.plugin.hooks.onDispose !== undefined) {
          const ctx = this._makePluginContext(entry.plugin.manifest.id);
          await entry.plugin.hooks.onDispose(ctx);
        }
      } catch (error) {
        this._logger.error(
          `Plugin dispose error: ${entry.plugin.manifest.id}`,
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        void this._events?.emit("pluginFailed", {
          pluginId: entry.plugin.manifest.id,
          phase: "dispose",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this._hookSystem.unregisterAll(entry.plugin.manifest.id);
      this._setPluginState(entry.plugin.manifest.id, "disposed");
      void this._events?.emit("pluginDisposed", {
        pluginId: entry.plugin.manifest.id,
        duration: Date.now() - startTime,
      });
    }

    this._initialized = false;
    this._logger.info("All plugins disposed");

    await this._stateStore?.flush();
  }

  register(plugin: Plugin, options?: PluginRegistrationOptions): void {
    const id = plugin.manifest.id;

    if (this._plugins.has(id)) {
      if (options?.enabled === false) {
        this._logger.debug(`Plugin already registered (skipping): ${id}`);
        return;
      }
      throw new MarketplaceClientError("PLUGIN_DUPLICATE", {
        message: `Plugin already registered: ${id}`,
        context: { pluginId: id },
      });
    }

    this._validateManifest(plugin.manifest);

    const compat = plugin.manifest.marketplaceVersion;
    if (compat !== undefined && compat !== "") {
      if (!this._versionResolver.satisfiesRange(MARKETPLACE_VERSION, compat)) {
        throw new MarketplaceClientError("PLUGIN_INCOMPATIBLE", {
          message: `Plugin ${id} requires marketplace ${compat}, but current version is ${MARKETPLACE_VERSION}`,
          context: {
            pluginId: id,
            required: compat,
            current: MARKETPLACE_VERSION,
          },
        });
      }
    }

    const entry: PluginEntry = {
      plugin,
      enabled: options?.enabled ?? true,
      state: "discovered",
      registeredAt: new Date().toISOString(),
      failurePolicy: options?.failurePolicy ?? "continue",
      priority: options?.priority ?? plugin.manifest.priority,
    };

    this._plugins.set(id, entry);
    if (entry.enabled) {
      this._registerPluginHooks(id, plugin.hooks);
    }

    this._logger.info(
      `Registered plugin: ${plugin.manifest.name}@${plugin.manifest.version}`,
      {
        capabilities: plugin.manifest.capabilities,
        enabled: entry.enabled,
      },
    );

    void this._events?.emit("pluginDiscovered", { pluginId: id, source: id });
    void this._events?.emit("pluginLoaded", {
      pluginId: id,
      version: plugin.manifest.version,
      capabilities: plugin.manifest.capabilities,
    });
  }

  unregister(id: string): boolean {
    const entry = this._plugins.get(id);
    if (entry === undefined) return false;

    this._hookSystem.unregisterAll(id);
    this._plugins.delete(id);
    this._logger.info(`Unregistered plugin: ${id}`);
    return true;
  }

  enable(id: string): boolean {
    const entry = this._plugins.get(id);
    if (entry === undefined) return false;

    const updated: PluginEntry = { ...entry, enabled: true };
    this._plugins.set(id, updated);
    this._registerPluginHooks(id, entry.plugin.hooks);

    if (entry.plugin.hooks.onEnable !== undefined) {
      const ctx = this._makePluginContext(id);
      const result = entry.plugin.hooks.onEnable(ctx);
      if (
        result !== undefined &&
        typeof (result as Promise<void>).catch === "function"
      ) {
        (result as Promise<void>).catch((error: unknown) => {
          this._logger.error(`Plugin onEnable error: ${id}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    return true;
  }

  disable(id: string): boolean {
    const entry = this._plugins.get(id);
    if (entry === undefined) return false;

    const updated: PluginEntry = { ...entry, enabled: false };
    this._plugins.set(id, updated);
    this._hookSystem.unregisterAll(id);

    if (entry.plugin.hooks.onDisable !== undefined) {
      const ctx = this._makePluginContext(id);
      const result = entry.plugin.hooks.onDisable(ctx);
      if (
        result !== undefined &&
        typeof (result as Promise<void>).catch === "function"
      ) {
        (result as Promise<void>).catch((error: unknown) => {
          this._logger.error(`Plugin onDisable error: ${id}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    return true;
  }

  list(): ReadonlyArray<PluginManifest> {
    return Array.from(this._plugins.values()).map((e) => e.plugin.manifest);
  }

  getEnabled(): ReadonlyArray<Plugin> {
    return Array.from(this._plugins.values())
      .filter((e) => e.enabled)
      .map((e) => e.plugin);
  }

  getEntry(id: string): PluginEntry | undefined {
    return this._plugins.get(id);
  }

  getByCapability(capability: PluginCapability): ReadonlyArray<Plugin> {
    return Array.from(this._plugins.values())
      .filter(
        (e) => e.enabled && e.plugin.manifest.capabilities.includes(capability),
      )
      .map((e) => e.plugin);
  }

  has(id: string): boolean {
    return this._plugins.has(id);
  }

  getState(id: string): PluginState | undefined {
    return this._plugins.get(id)?.state;
  }

  getCapabilities(id: string): ReadonlyArray<PluginCapability> | undefined {
    return this._plugins.get(id)?.plugin.manifest.capabilities;
  }

  /** Inspectable plugin permissions (Phase 17 Step 17). */
  getPermissions(id: string): ReadonlyArray<PluginPermission> {
    return this._plugins.get(id)?.plugin.manifest.permissions ?? [];
  }

  hasPermission(id: string, permission: PluginPermission): boolean {
    return this.getPermissions(id).includes(permission);
  }

  /**
   * Permission ENFORCEMENT point (Phase 17 Step 17).
   * Throws a structured PERMISSION_DENIED error when the plugin has not
   * declared the required permission.
   */
  requirePermission(id: string, permission: PluginPermission): void {
    if (!this.hasPermission(id, permission)) {
      throw new MarketplaceClientError("PERMISSION_DENIED", {
        message: `Plugin "${id}" attempted to use permission "${permission}" without declaring it`,
        context: { pluginId: id, requiredPermission: permission },
      });
    }
  }

  async executeSearchHook(
    query: SearchQuery,
    result: SearchResult,
  ): Promise<SearchResult> {
    const output = await this._hookSystem.execute(
      "search",
      { query, result },
      (input: { query: SearchQuery; result: SearchResult }) => input,
    );
    return output.result;
  }

  async executeInstallHook(
    options: InstallOptions,
    result: InstallResult,
  ): Promise<InstallResult> {
    const output = await this._hookSystem.execute(
      "install",
      { options, result },
      (input: { options: InstallOptions; result: InstallResult }) => input,
    );
    return output.result;
  }

  async executeDownloadHook(
    options: DownloadOptions,
    result: DownloadResult,
  ): Promise<DownloadResult> {
    const output = await this._hookSystem.execute(
      "download",
      { options, result },
      (input: { options: DownloadOptions; result: DownloadResult }) => input,
    );
    return output.result;
  }

  async executeRegistryHook(registry: Registry): Promise<Registry> {
    return this._hookSystem.execute(
      "registry",
      registry,
      (input: Registry) => input,
    );
  }

  async executeWizardHook(step: WizardStep): Promise<WizardStep> {
    return this._hookSystem.execute(
      "wizard",
      step,
      (input: WizardStep) => input,
    );
  }

  async executePreviewHook(id: string, resource: Resource): Promise<Resource> {
    const output = await this._hookSystem.execute(
      "preview",
      { id, resource },
      (input: { id: string; resource: Resource }) => input,
    );
    return output.resource;
  }

  async executeCompatibilityHook(
    result: CompatibilityResult,
  ): Promise<CompatibilityResult> {
    return this._hookSystem.execute(
      "compatibility",
      result,
      (input: CompatibilityResult) => input,
    );
  }

  async executeDetectionHook(
    project: DetectedProject,
  ): Promise<DetectedProject> {
    return this._hookSystem.execute(
      "detection",
      project,
      (input: DetectedProject) => input,
    );
  }

  async executePipelineHook(
    context: PipelineContext,
  ): Promise<PipelineContext> {
    return this._hookSystem.execute(
      "pipeline",
      context,
      (input: PipelineContext) => input,
    );
  }

  async executeTransformHook(
    filePath: string,
    result: TransformResult,
  ): Promise<TransformResult> {
    const output = await this._hookSystem.execute(
      "transform",
      { filePath, result },
      (input: { filePath: string; result: TransformResult }) => input,
    );
    return output.result;
  }

  async executeMergeHook(
    filePath: string,
    result: MergeResult,
  ): Promise<MergeResult> {
    const output = await this._hookSystem.execute(
      "merge",
      { filePath, result },
      (input: { filePath: string; result: MergeResult }) => input,
    );
    return output.result;
  }

  async executeResourceTypeHook(
    type: ResourceTypeDefinition,
  ): Promise<ResourceTypeDefinition> {
    return this._hookSystem.execute(
      "resourceType",
      type,
      (input: ResourceTypeDefinition) => input,
    );
  }

  private async _initializePlugin(entry: PluginEntry): Promise<void> {
    this._setPluginState(entry.plugin.manifest.id, "loading");

    const deps = entry.plugin.manifest.dependencies;
    if (deps !== undefined && deps.length > 0) {
      for (const dep of deps) {
        const depEntry = this._plugins.get(dep.id);
        if (depEntry === undefined) {
          throw new MarketplaceClientError("EXTENSION_DEPENDENCY_CONFLICT", {
            message: `Missing plugin dependency: ${dep.id}`,
            context: { plugin: entry.plugin.manifest.id, dependency: dep.id },
          });
        }
      }
    }

    if (entry.plugin.hooks.onInitialize !== undefined) {
      const ctx = this._makePluginContext(entry.plugin.manifest.id);
      await entry.plugin.hooks.onInitialize(ctx);
    }

    this._setPluginState(entry.plugin.manifest.id, "ready");
  }

  private _registerPluginHooks(pluginId: string, hooks: PluginHooks): void {
    const reg = (
      name: string,
      handler?: (input: never, ctx: unknown) => unknown,
    ): void => {
      if (handler !== undefined) {
        this._hookSystem.register(name, pluginId, handler, {
          priority: 0,
          errorPolicy: "throw",
        });
      }
    };

    const ctxOf = (): PluginContext =>
      this._context ?? createFallbackPluginContext(pluginId);

    reg(
      "search",
      hooks.search !== undefined
        ? (bag: { query: SearchQuery; result: SearchResult }) =>
            Promise.resolve(hooks.search!(bag.query, bag.result, ctxOf())).then(
              (result) => ({ ...bag, result }),
            )
        : undefined,
    );
    reg(
      "install",
      hooks.install !== undefined
        ? (bag: { options: InstallOptions; result: InstallResult }) =>
            Promise.resolve(
              hooks.install!(bag.options, bag.result, ctxOf()),
            ).then((result) => ({ ...bag, result }))
        : undefined,
    );
    reg(
      "download",
      hooks.download !== undefined
        ? (bag: { options: DownloadOptions; result: DownloadResult }) =>
            Promise.resolve(
              hooks.download!(bag.options, bag.result, ctxOf()),
            ).then((result) => ({ ...bag, result }))
        : undefined,
    );
    reg(
      "registry",
      hooks.registry !== undefined
        ? (r: Registry) => hooks.registry!(r, ctxOf())
        : undefined,
    );
    reg(
      "wizard",
      hooks.wizard !== undefined
        ? (s: WizardStep) => hooks.wizard!(s, ctxOf())
        : undefined,
    );
    reg(
      "preview",
      hooks.preview !== undefined
        ? (bag: { id: string; resource: Resource }) =>
            Promise.resolve(hooks.preview!(bag.id, bag.resource, ctxOf())).then(
              (resource) => ({ ...bag, resource }),
            )
        : undefined,
    );
    reg(
      "compatibility",
      hooks.compatibility !== undefined
        ? (r: CompatibilityResult) => hooks.compatibility!(r, ctxOf())
        : undefined,
    );
    reg(
      "detection",
      hooks.detection !== undefined
        ? (p: DetectedProject) => hooks.detection!(p, ctxOf())
        : undefined,
    );
    reg(
      "pipeline",
      hooks.pipeline !== undefined
        ? (c: PipelineContext) => hooks.pipeline!(c, ctxOf())
        : undefined,
    );
    reg(
      "transform",
      hooks.transform !== undefined
        ? (bag: { filePath: string; result: TransformResult }) =>
            Promise.resolve(
              hooks.transform!(bag.filePath, bag.result, ctxOf()),
            ).then((result) => ({ ...bag, result }))
        : undefined,
    );
    reg(
      "merge",
      hooks.merge !== undefined
        ? (bag: { filePath: string; result: MergeResult }) =>
            Promise.resolve(
              hooks.merge!(bag.filePath, bag.result, ctxOf()),
            ).then((result) => ({ ...bag, result }))
        : undefined,
    );
    reg(
      "resourceType",
      hooks.resourceType !== undefined
        ? (t: ResourceTypeDefinition) => hooks.resourceType!(t, ctxOf())
        : undefined,
    );
  }

  private _setPluginState(id: string, state: PluginState): void {
    const entry = this._plugins.get(id);
    if (entry === undefined) return;

    this._plugins.set(id, { ...entry, state });
  }

  private _getInitializationOrder(): PluginEntry[] {
    // Deterministic: dependencies first (DFS), then explicit priority
    // (higher first), then registration order as final tiebreaker.
    const entries = Array.from(this._plugins.values()).sort((a, b) => {
      const pa = a.priority ?? a.plugin.manifest.priority ?? 0;
      const pb = b.priority ?? b.plugin.manifest.priority ?? 0;
      return pb - pa;
    });
    const sorted: PluginEntry[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (entry: PluginEntry): void => {
      const id = entry.plugin.manifest.id;
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new MarketplaceClientError("DEPENDENCY_CIRCULAR", {
          message: `Circular plugin dependency detected: ${id}`,
          context: { pluginId: id },
        });
      }

      visiting.add(id);

      const deps = entry.plugin.manifest.dependencies;
      if (deps !== undefined) {
        for (const dep of deps) {
          const depEntry = entries.find((e) => e.plugin.manifest.id === dep.id);
          if (depEntry !== undefined) {
            visit(depEntry);
          }
        }
      }

      visiting.delete(id);
      visited.add(id);
      sorted.push(entry);
    };

    for (const entry of entries) {
      visit(entry);
    }

    return sorted;
  }

  private _validateManifest(manifest: PluginManifest): void {
    if (!manifest.id || manifest.id.trim().length === 0) {
      throw new MarketplaceClientError("EXTENSION_VALIDATION_FAILED", {
        message: "Plugin manifest must have a non-empty id",
      });
    }
    if (!manifest.name || manifest.name.trim().length === 0) {
      throw new MarketplaceClientError("EXTENSION_VALIDATION_FAILED", {
        message: "Plugin manifest must have a non-empty name",
        context: { pluginId: manifest.id },
      });
    }
    if (!manifest.version || manifest.version.trim().length === 0) {
      throw new MarketplaceClientError("EXTENSION_VALIDATION_FAILED", {
        message: "Plugin manifest must have a non-empty version",
        context: { pluginId: manifest.id },
      });
    }
  }

  private _makePluginContext(pluginId: string): PluginContext {
    const logger: PluginLogger = {
      debug: (msg, meta) => this._logger.debug(`[${pluginId}] ${msg}`, meta),
      info: (msg, meta) => this._logger.info(`[${pluginId}] ${msg}`, meta),
      warn: (msg, meta) => this._logger.warn(`[${pluginId}] ${msg}`, meta),
      error: (msg, meta) => this._logger.error(`[${pluginId}] ${msg}`, meta),
    };

    const fallbackCtx = createFallbackPluginContext(pluginId);
    const sharedConfig: PluginConfigAccess =
      this._context !== null ? this._context.config : fallbackCtx.config;

    // Per-plugin options from configuration take precedence over the
    // shared config namespace (plugins: [{ name, options }] contract).
    const pluginEntry = Array.from(this._plugins.values()).find(
      (e) => e.plugin.manifest.id === pluginId,
    );
    const configName =
      pluginEntry !== undefined &&
      this._pluginConfigs.some((c) => c.name === pluginId)
        ? pluginId
        : (pluginEntry?.plugin.manifest.name ?? pluginId);
    const ownOptions =
      this._pluginConfigs.find(
        (c) => c.name === pluginId || c.name === configName,
      )?.options ?? undefined;

    const config: PluginConfigAccess = {
      get: <T = unknown>(key: string): T | undefined => {
        if (
          ownOptions !== undefined &&
          Object.prototype.hasOwnProperty.call(ownOptions, key)
        ) {
          return ownOptions[key] as T | undefined;
        }
        return sharedConfig.get<T>(key);
      },
      has: (key: string): boolean => {
        if (
          ownOptions !== undefined &&
          Object.prototype.hasOwnProperty.call(ownOptions, key)
        ) {
          return true;
        }
        return sharedConfig.has(key);
      },
    };

    const store = this._stateStore;
    if (store === null) {
      return {
        pluginId,
        logger,
        config,
        state: fallbackCtx.state,
        events: fallbackCtx.events,
      };
    }

    // Permission enforcement (Phase 17 Step 17): persistent (disk-backed)
    // state requires an explicit "filesystem-write" permission. Plugins
    // without it get ephemeral in-memory state that never touches disk.
    if (!this.hasPermission(pluginId, "filesystem-write")) {
      const memory = this._ephemeralState.get(pluginId) ?? {};
      this._ephemeralState.set(pluginId, memory);
      const state: PluginStateAccess = {
        get: <T = unknown>(key: string): T | undefined =>
          memory[key] as T | undefined,
        set: <T = unknown>(key: string, value: T) => {
          memory[key] = value;
        },
        has: (key: string): boolean => key in memory,
        delete: (key: string) => {
          delete memory[key];
        },
      };
      return { pluginId, logger, config, state, events: fallbackCtx.events };
    }

    let data = store.load(pluginId);

    const persist = (): void => {
      store!.save(pluginId, data);
    };

    const state: PluginStateAccess = {
      get: <T = unknown>(key: string): T | undefined =>
        data[key] as T | undefined,
      set: <T = unknown>(key: string, value: T) => {
        data = { ...data, [key]: value };
        persist();
      },
      has: (key: string): boolean => key in data,
      delete: (key: string) => {
        const next = { ...data };
        delete next[key];
        data = next;
        persist();
      },
    };

    const events: PluginEventAccess = {
      on: (_event: string, _handler: (data: unknown) => void) => {},
      off: (_event: string, _handler: (data: unknown) => void) => {},
      emit: (_event: string, _data: unknown) => {},
    };

    return { pluginId, logger, config, state, events };
  }
}

export function createFallbackPluginContext(pluginId: string): PluginContext {
  const logger: PluginLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const config: PluginConfigAccess = {
    get: <T = unknown>(_key: string): T | undefined => undefined,
    has: (_key: string): boolean => false,
  };

  const state: PluginStateAccess = {
    get: <T = unknown>(_key: string): T | undefined => undefined,
    set: <T = unknown>(_key: string, _value: T) => {},
    has: (_key: string): boolean => false,
    delete: (_key: string) => {},
  };

  const events: PluginEventAccess = {
    on: (_event: string, _handler: (data: unknown) => void) => {},
    off: (_event: string, _handler: (data: unknown) => void) => {},
    emit: (_event: string, _data: unknown) => {},
  };

  return { pluginId, logger, config, state, events };
}

export function createPlugin(
  manifest: PluginManifest,
  hooks: PluginHooks,
): Plugin {
  return { manifest, hooks };
}
