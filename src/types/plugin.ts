import type { SearchQuery, SearchResult } from "./search.js";
import type { InstallOptions, InstallResult } from "./install.js";
import type { DownloadOptions, DownloadResult } from "./download.js";
import type { Registry } from "./registry.js";
import type { CompatibilityResult } from "./versions.js";
import type { DetectedProject } from "./detection.js";
import type { ResourceTypeDefinition } from "./resource-types.js";
import type { PipelineContext } from "./pipeline.js";
import type { MergeResult } from "./merge.js";
import type { TransformResult } from "./transform.js";
import type { Resource } from "./resource.js";

export type PluginCapability =
  | "registry"
  | "provider"
  | "resource-type"
  | "installer"
  | "transform"
  | "merge-strategy"
  | "search"
  | "compatibility"
  | "lifecycle"
  | "validation"
  | "detection";

export type PluginState =
  "discovered" | "loading" | "initialized" | "ready" | "failed" | "disposed";

export type PluginFailurePolicy = "stop" | "continue" | "fallback";

export interface PluginDependency {
  readonly id: string;
  readonly version?: string;
}

/** Explicit, inspectable plugin permissions (Phase 17 Step 17). */
export type PluginPermission =
  | "filesystem-read"
  | "filesystem-write"
  | "network"
  | "process-execution"
  | "environment-read"
  | "registry-access";

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly capabilities: ReadonlyArray<PluginCapability>;
  readonly dependencies?: ReadonlyArray<PluginDependency>;
  /** Declared permissions — dangerous ones must be explicit and inspectable */
  readonly permissions?: ReadonlyArray<PluginPermission>;
  readonly marketplaceVersion?: string;
  readonly priority?: number;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly logger: PluginLogger;
  readonly config: PluginConfigAccess;
  readonly state: PluginStateAccess;
  readonly events: PluginEventAccess;
}

export interface PluginLogger {
  readonly debug: (message: string, meta?: Record<string, unknown>) => void;
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface PluginConfigAccess {
  readonly get: <T = unknown>(key: string) => T | undefined;
  readonly has: (key: string) => boolean;
}

export interface PluginStateAccess {
  readonly get: <T = unknown>(key: string) => T | undefined;
  readonly set: <T = unknown>(key: string, value: T) => void;
  readonly has: (key: string) => boolean;
  readonly delete: (key: string) => void;
}

export interface PluginEventAccess {
  readonly on: (event: string, handler: (data: unknown) => void) => void;
  readonly off: (event: string, handler: (data: unknown) => void) => void;
  readonly emit: (event: string, data: unknown) => void;
}

export interface PluginHooks {
  readonly onInitialize?: (ctx: PluginContext) => Promise<void> | void;
  readonly onDispose?: (ctx: PluginContext) => Promise<void> | void;
  readonly onEnable?: (ctx: PluginContext) => Promise<void> | void;
  readonly onDisable?: (ctx: PluginContext) => Promise<void> | void;

  readonly search?: (
    query: SearchQuery,
    result: SearchResult,
    ctx: PluginContext,
  ) => SearchResult | Promise<SearchResult>;
  readonly install?: (
    options: InstallOptions,
    result: InstallResult,
    ctx: PluginContext,
  ) => InstallResult | Promise<InstallResult>;
  readonly download?: (
    options: DownloadOptions,
    result: DownloadResult,
    ctx: PluginContext,
  ) => DownloadResult | Promise<DownloadResult>;
  readonly registry?: (
    registry: Registry,
    ctx: PluginContext,
  ) => Registry | Promise<Registry>;
  readonly wizard?: (
    step: WizardStep,
    ctx: PluginContext,
  ) => WizardStep | Promise<WizardStep>;
  readonly preview?: (
    id: string,
    resource: Resource,
    ctx: PluginContext,
  ) => Resource | Promise<Resource>;
  readonly compatibility?: (
    result: CompatibilityResult,
    ctx: PluginContext,
  ) => CompatibilityResult | Promise<CompatibilityResult>;
  readonly detection?: (
    project: DetectedProject,
    ctx: PluginContext,
  ) => DetectedProject | Promise<DetectedProject>;
  readonly pipeline?: (
    context: PipelineContext,
    ctx: PluginContext,
  ) => PipelineContext | Promise<PipelineContext>;
  readonly transform?: (
    filePath: string,
    result: TransformResult,
    ctx: PluginContext,
  ) => TransformResult | Promise<TransformResult>;
  readonly merge?: (
    filePath: string,
    result: MergeResult,
    ctx: PluginContext,
  ) => MergeResult | Promise<MergeResult>;
  readonly resourceType?: (
    type: ResourceTypeDefinition,
    ctx: PluginContext,
  ) => ResourceTypeDefinition | Promise<ResourceTypeDefinition>;
}

export interface Plugin {
  readonly manifest: PluginManifest;
  readonly hooks: PluginHooks;
}

export interface PluginEntry {
  readonly plugin: Plugin;
  readonly enabled: boolean;
  readonly state: PluginState;
  readonly registeredAt: string;
  readonly failurePolicy: PluginFailurePolicy;
  readonly priority?: number;
}

export interface PluginRegistrationOptions {
  readonly enabled?: boolean;
  readonly failurePolicy?: PluginFailurePolicy;
  readonly priority?: number;
}

export type HookErrorPolicy = "throw" | "log" | "ignore";

export interface HookRegistration {
  readonly hookName: string;
  readonly pluginId: string;
  readonly policy: HookErrorPolicy;
  readonly priority: number;
}

export interface WizardStep {
  readonly type: string;
  readonly title: string;
  readonly choices: ReadonlyArray<WizardChoice>;
}

export interface WizardChoice {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}
