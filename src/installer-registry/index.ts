import { createLogger, type Logger } from "../logger/index.js";
import { EventBus } from "../events/index.js";
import type {
  ResourceTypeInstallerDefinition,
  InstallerRegistryEntry,
  InstallerFunction,
  InstallerInstallContext,
  InstallerResult,
} from "../types/extensions.js";
import { MarketplaceClientError } from "../errors/index.js";

export class InstallerRegistry {
  private readonly _entries: Map<string, InstallerRegistryEntry> = new Map();
  private readonly _typeMap: Map<string, string[]> = new Map();
  private readonly _logger: Logger;
  private readonly _events: EventBus | null;

  constructor(logger?: Logger, events?: EventBus) {
    this._logger = logger ?? createLogger({ prefix: "installer-registry" });
    this._events = events ?? null;
  }

  register(
    definition: ResourceTypeInstallerDefinition,
    installer: InstallerFunction,
    options?: { source?: "builtin" | "plugin"; pluginId?: string },
  ): void {
    if (this._entries.has(definition.id)) {
      void this._events?.emit("extensionConflict", {
        kind: "installer",
        id: definition.id,
        pluginId: options?.pluginId,
      });
      throw new MarketplaceClientError("INSTALLER_DUPLICATE", {
        message: `Installer already registered: ${definition.id}`,
        context: { installerId: definition.id },
      });
    }

    const entry: InstallerRegistryEntry = {
      definition,
      installer,
      registeredAt: new Date().toISOString(),
      source: options?.source ?? "builtin",
      pluginId: options?.pluginId,
    };

    this._entries.set(definition.id, entry);

    for (const typeId of definition.supportedResourceTypes) {
      let types = this._typeMap.get(typeId);
      if (types === undefined) {
        types = [];
        this._typeMap.set(typeId, types);
      }
      if (!types.includes(definition.id)) {
        types.push(definition.id);
      }
    }

    this._logger.info(`Registered installer: ${definition.id}`, {
      supportedTypes: definition.supportedResourceTypes,
      source: options?.source ?? "builtin",
    });

    void this._events?.emit("installerRegistered", {
      installerId: definition.id,
      supportedResourceTypes: definition.supportedResourceTypes,
      source: options?.source ?? "builtin",
      pluginId: options?.pluginId,
    });
  }

  unregister(id: string): boolean {
    const entry = this._entries.get(id);
    if (entry === undefined) return false;

    for (const typeId of entry.definition.supportedResourceTypes) {
      const types = this._typeMap.get(typeId);
      if (types !== undefined) {
        const idx = types.indexOf(id);
        if (idx >= 0) types.splice(idx, 1);
        if (types.length === 0) this._typeMap.delete(typeId);
      }
    }

    this._entries.delete(id);
    this._logger.info(`Unregistered installer: ${id}`);
    return true;
  }

  get(id: string): InstallerRegistryEntry | undefined {
    return this._entries.get(id);
  }

  getAll(): ReadonlyArray<InstallerRegistryEntry> {
    return Array.from(this._entries.values());
  }

  getByResourceType(resourceType: string): InstallerRegistryEntry | undefined {
    const installerIds = this._typeMap.get(resourceType);
    if (installerIds === undefined || installerIds.length === 0)
      return undefined;

    let best: InstallerRegistryEntry | undefined;
    for (const id of installerIds) {
      const entry = this._entries.get(id);
      if (entry !== undefined) {
        if (
          best === undefined ||
          entry.definition.priority > best.definition.priority
        ) {
          best = entry;
        }
      }
    }
    return best;
  }

  async install(
    context: InstallerInstallContext,
    resourceType: string,
  ): Promise<InstallerResult> {
    const entry = this.getByResourceType(resourceType);
    if (entry === undefined) {
      return {
        success: false,
        filesWritten: [],
        duration: 0,
        errors: [`No installer registered for resource type: ${resourceType}`],
      };
    }

    const startTime = Date.now();
    try {
      const result = await entry.installer(context);
      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        filesWritten: [],
        duration: Date.now() - startTime,
        errors: [
          `Installer ${entry.definition.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
}

export function createInstallerRegistry(
  logger?: Logger,
  events?: EventBus,
): InstallerRegistry {
  return new InstallerRegistry(logger, events);
}
