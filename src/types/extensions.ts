import type { PluginCapability } from "./plugin.js";

export interface ResourceTypeInstallerDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly supportedResourceTypes: ReadonlyArray<string>;
  readonly priority: number;
}

export interface InstallerRegistryEntry {
  readonly definition: ResourceTypeInstallerDefinition;
  readonly installer: InstallerFunction;
  readonly registeredAt: string;
  readonly source: "builtin" | "plugin";
  readonly pluginId?: string;
}

export type InstallerFunction = (
  context: InstallerInstallContext,
) => Promise<InstallerResult>;

export interface InstallerInstallContext {
  readonly resourceId: string;
  readonly version: string;
  readonly source: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>;
  readonly destination: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly resourceType: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export interface InstallerResult {
  readonly success: boolean;
  readonly filesWritten: ReadonlyArray<string>;
  readonly duration: number;
  readonly errors: ReadonlyArray<string>;
}

export interface PluginDiscoveredEvent {
  readonly pluginId: string;
  readonly source: string;
  readonly timestamp: string;
}

export interface PluginLoadedEvent {
  readonly pluginId: string;
  readonly duration: number;
  readonly timestamp: string;
}

export interface PluginInitializedEvent {
  readonly pluginId: string;
  readonly capabilities: ReadonlyArray<PluginCapability>;
  readonly duration: number;
  readonly timestamp: string;
}

export interface PluginFailedEvent {
  readonly pluginId: string;
  readonly error: string;
  readonly phase: string;
  readonly timestamp: string;
}

export interface PluginDisposedEvent {
  readonly pluginId: string;
  readonly duration: number;
  readonly timestamp: string;
}

export interface ResourceTypeRegisteredEvent {
  readonly typeId: string;
  readonly source: "builtin" | "plugin";
  readonly pluginId?: string;
  readonly timestamp: string;
}

export interface InstallerRegisteredEvent {
  readonly installerId: string;
  readonly source: "builtin" | "plugin";
  readonly pluginId?: string;
  readonly timestamp: string;
}

export interface ExtensionConflictEvent {
  readonly type: "resource-type" | "installer" | "merge-strategy" | "transform";
  readonly existingId: string;
  readonly newId: string;
  readonly pluginId?: string;
  readonly timestamp: string;
}

export interface HookExecutionEvent {
  readonly hookName: string;
  readonly pluginId: string;
  readonly duration: number;
  readonly success: boolean;
  readonly error?: string;
  readonly timestamp: string;
}
