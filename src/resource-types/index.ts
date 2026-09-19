import type {
  ResourceTypeDefinition,
  ResourceTypeInstaller,
  ResourceTypeRegistration,
  InstallerContext,
  InstallOutcome,
  PreviewOutcome,
  RemoveContext,
  ResourceTypeCapability,
  ValidationResult,
} from "../types/resource-types.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { VersionResolver } from "../versions/index.js";
import { EventBus } from "../events/index.js";
import { MARKETPLACE_VERSION } from "../constants.js";

function createDefaultInstaller(
  typeName: string,
  logger?: Logger,
): ResourceTypeInstaller {
  const log = logger ?? createLogger({ prefix: `builtin-${typeName}` });

  return {
    install: async (context: InstallerContext): Promise<InstallOutcome> => {
      log.info(`Installing ${typeName}`, {
        resourceId: context.resourceId,
        version: context.version,
        destination: context.destination,
      });
      return {
        success: true,
        filesWritten: [],
        duration: 0,
        errors: [],
      };
    },
    preview: async (context: InstallerContext): Promise<PreviewOutcome> => {
      log.info(`Previewing ${typeName}`, {
        resourceId: context.resourceId,
        destination: context.destination,
      });
      return {
        files: [],
        estimatedSize: 0,
        conflicts: [],
      };
    },
    remove: async (context: RemoveContext): Promise<void> => {
      log.info(`Removing ${typeName}`, {
        resourceId: context.resourceId,
        destination: context.destination,
      });
    },
  };
}

const BUILTIN_TYPES: ReadonlyArray<{
  readonly id: string;
  readonly displayName: string;
  readonly icon: string;
  readonly manifestNames: ReadonlyArray<string>;
  readonly capabilities: ReadonlyArray<ResourceTypeCapability>;
}> = [
  {
    id: "plugin",
    displayName: "Plugin",
    icon: "plug",
    manifestNames: [
      "resource.json",
      "manifest.json",
      "vetwo.json",
      "package.json",
    ],
    capabilities: [
      "install",
      "update",
      "remove",
      "repair",
      "preview",
      "configuration",
    ],
  },
  {
    id: "theme",
    displayName: "Theme",
    icon: "palette",
    manifestNames: ["resource.json", "manifest.json", "vetwo.json"],
    capabilities: ["install", "update", "remove", "repair", "preview", "merge"],
  },
  {
    id: "template",
    displayName: "Template",
    icon: "file-code",
    manifestNames: ["resource.json", "manifest.json", "vetwo.json"],
    capabilities: [
      "install",
      "update",
      "remove",
      "repair",
      "preview",
      "transform",
      "merge",
    ],
  },
  {
    id: "module",
    displayName: "Module",
    icon: "package",
    manifestNames: [
      "resource.json",
      "manifest.json",
      "vetwo.json",
      "package.json",
    ],
    capabilities: [
      "install",
      "update",
      "remove",
      "repair",
      "preview",
      "dependencies",
      "configuration",
    ],
  },
  {
    id: "generator",
    displayName: "Generator",
    icon: "zap",
    manifestNames: ["resource.json", "vetwo.json"],
    capabilities: [
      "install",
      "update",
      "remove",
      "repair",
      "preview",
      "transform",
    ],
  },
  {
    id: "extension",
    displayName: "Extension",
    icon: "puzzle",
    manifestNames: [
      "resource.json",
      "manifest.json",
      "vetwo.json",
      "package.json",
    ],
    capabilities: [
      "install",
      "update",
      "remove",
      "repair",
      "preview",
      "configuration",
    ],
  },
];

export class ResourceTypeRegistry {
  private readonly registrations = new Map<string, ResourceTypeRegistration>();
  private readonly manifestIndex = new Map<string, string>();
  private readonly logger: Logger;
  private readonly _events: EventBus | null;
  private readonly _versionResolver = new VersionResolver();

  constructor(logger?: Logger, events?: EventBus) {
    this.logger = logger ?? createLogger({ prefix: "resource-type-registry" });
    this._events = events ?? null;
    this.registerBuiltins();
  }

  register(
    type: ResourceTypeDefinition,
    installer: ResourceTypeInstaller,
    options?: { source?: "builtin" | "plugin"; pluginId?: string },
  ): void {
    if (this.registrations.has(type.id)) {
      void this._events?.emit("extensionConflict", {
        kind: "resource-type",
        id: type.id,
        pluginId: options?.pluginId,
      });
      throw new MarketplaceClientError("RESOURCE_TYPE_DUPLICATE", {
        message: `Resource type already registered: ${type.id}`,
        context: { typeId: type.id, source: options?.source },
      });
    }

    const compat = type.marketplaceVersion;
    if (compat !== undefined && compat !== "") {
      if (!this._versionResolver.satisfiesRange(MARKETPLACE_VERSION, compat)) {
        throw new MarketplaceClientError("PLUGIN_INCOMPATIBLE", {
          message: `Resource type ${type.id} requires marketplace ${compat}, but current version is ${MARKETPLACE_VERSION}`,
          context: {
            typeId: type.id,
            required: compat,
            current: MARKETPLACE_VERSION,
          },
        });
      }
    }

    const registration: ResourceTypeRegistration = {
      type,
      installer,
      registeredAt: new Date().toISOString(),
      source: options?.source ?? "builtin",
      pluginId: options?.pluginId,
    };

    this.registrations.set(type.id, registration);

    for (const name of type.manifestNames) {
      if (!this.manifestIndex.has(name)) {
        this.manifestIndex.set(name, type.id);
      }
    }

    this.logger.info(`Registered resource type: ${type.id}`, {
      displayName: type.displayName,
      source: options?.source ?? "builtin",
    });

    void this._events?.emit("resourceTypeRegistered", {
      typeId: type.id,
      source: options?.source ?? "builtin",
      pluginId: options?.pluginId,
    });
  }

  unregister(id: string): boolean {
    const registration = this.registrations.get(id);
    if (registration === undefined) return false;

    for (const name of registration.type.manifestNames) {
      if (this.manifestIndex.get(name) === id) {
        this.manifestIndex.delete(name);
      }
    }

    this.registrations.delete(id);
    this.logger.info(`Unregistered resource type: ${id}`);
    void this._events?.emit("resourceTypeUnregistered", { typeId: id });
    return true;
  }

  get(id: string): ResourceTypeRegistration | undefined {
    return this.registrations.get(id);
  }

  has(id: string): boolean {
    return this.registrations.has(id);
  }

  getAll(): ReadonlyArray<ResourceTypeRegistration> {
    return Array.from(this.registrations.values());
  }

  getByManifestName(fileName: string): ResourceTypeRegistration | undefined {
    const typeId = this.manifestIndex.get(fileName);
    if (typeId !== undefined) {
      return this.registrations.get(typeId);
    }
    for (const registration of this.registrations.values()) {
      if (registration.type.manifestNames.includes(fileName)) {
        return registration;
      }
    }
    return undefined;
  }

  getByCapability(
    capability: ResourceTypeCapability,
  ): ReadonlyArray<ResourceTypeRegistration> {
    return Array.from(this.registrations.values()).filter((r) =>
      r.type.capabilities.includes(capability),
    );
  }

  hasCapability(typeId: string, capability: ResourceTypeCapability): boolean {
    const registration = this.registrations.get(typeId);
    if (registration === undefined) return false;
    return registration.type.capabilities.includes(capability);
  }

  validateCapabilities(
    typeId: string,
    required: ReadonlyArray<ResourceTypeCapability>,
  ): ValidationResult {
    const registration = this.registrations.get(typeId);
    if (registration === undefined) {
      return {
        valid: false,
        errors: [`Resource type not found: ${typeId}`],
        warnings: [],
      };
    }

    const missing = required.filter(
      (cap) => !registration.type.capabilities.includes(cap),
    );

    if (missing.length > 0) {
      return {
        valid: false,
        errors: [
          `Resource type ${typeId} is missing required capabilities: ${missing.join(", ")}`,
        ],
        warnings: [],
      };
    }

    return { valid: true, errors: [], warnings: [] };
  }

  async validateManifest(
    typeId: string,
    manifest: Record<string, unknown>,
  ): Promise<ValidationResult> {
    const registration = this.registrations.get(typeId);
    if (registration === undefined) {
      return {
        valid: false,
        errors: [`Resource type not found: ${typeId}`],
        warnings: [],
      };
    }

    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    if (registration.type.validators !== undefined) {
      for (const validator of registration.type.validators) {
        try {
          const result = await validator.validate(manifest);
          allErrors.push(...result.errors);
          allWarnings.push(...result.warnings);
        } catch (error) {
          allErrors.push(
            `Validator ${validator.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  detectType(manifest: Record<string, unknown>): string | undefined {
    const manifestType = manifest.type ?? manifest.resourceType;
    if (
      typeof manifestType === "string" &&
      this.registrations.has(manifestType)
    ) {
      return manifestType;
    }

    for (const [typeId] of this.registrations) {
      const manifestField = manifest[`${typeId}Config`] ?? manifest[typeId];
      if (manifestField !== undefined && manifestField !== null) {
        return typeId;
      }
    }

    return undefined;
  }

  async install(
    context: InstallerContext,
    resourceType: string,
  ): Promise<InstallOutcome> {
    const registration = this.registrations.get(resourceType);
    if (registration === undefined) {
      this.logger.error(`No installer for resource type: ${resourceType}`);
      return {
        success: false,
        filesWritten: [],
        duration: 0,
        errors: [`No installer registered for resource type: ${resourceType}`],
      };
    }
    return registration.installer.install(context);
  }

  async preview(
    context: InstallerContext,
    resourceType: string,
  ): Promise<PreviewOutcome> {
    const registration = this.registrations.get(resourceType);
    if (
      registration === undefined ||
      registration.installer.preview === undefined
    ) {
      return {
        files: [],
        estimatedSize: 0,
        conflicts: [],
      };
    }
    return registration.installer.preview(context);
  }

  async remove(context: RemoveContext, resourceType: string): Promise<void> {
    const registration = this.registrations.get(resourceType);
    if (
      registration === undefined ||
      registration.installer.remove === undefined
    ) {
      this.logger.warn(`No remove handler for resource type: ${resourceType}`);
      return;
    }
    await registration.installer.remove(context);
  }

  private registerBuiltins(): void {
    for (const def of BUILTIN_TYPES) {
      this.register(
        {
          id: def.id,
          displayName: def.displayName,
          description: `${def.displayName} resource type`,
          icon: def.icon,
          installer: `builtin-${def.id}`,
          capabilities: def.capabilities,
          manifestNames: def.manifestNames,
          defaultDestination: `./${def.id}s`,
          mergeStrategies: [],
        },
        createDefaultInstaller(def.id, this.logger.child(def.id)),
      );
    }
  }
}

export function createTypeRegistry(
  logger?: Logger,
  events?: EventBus,
): ResourceTypeRegistry {
  return new ResourceTypeRegistry(logger, events);
}
