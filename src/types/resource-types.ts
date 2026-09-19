import type { Logger } from "../logger/index.js";

export type ResourceTypeCapability =
  | "install"
  | "update"
  | "remove"
  | "repair"
  | "preview"
  | "transform"
  | "merge"
  | "dependencies"
  | "configuration"
  | "validation"
  | "rollback";

export interface ResourceTypeDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly icon: string;
  readonly installer: string;
  readonly capabilities: ReadonlyArray<ResourceTypeCapability>;
  readonly manifestNames: ReadonlyArray<string>;
  readonly defaultDestination: string;
  readonly mergeStrategies: ReadonlyArray<string>;
  readonly transformNames?: ReadonlyArray<string>;
  readonly validators?: ReadonlyArray<ResourceTypeValidator>;
  readonly marketplaceVersion?: string;
}

export interface ResourceTypeCapabilities {
  readonly supportsDependencies: boolean;
  readonly supportsVariables: boolean;
  readonly supportsTemplates: boolean;
  readonly supportsTransforms: boolean;
  readonly supportsMerge: boolean;
  readonly supportsRollback: boolean;
  readonly supportsPreview: boolean;
}

export interface ResourceTypeRegistration {
  readonly type: ResourceTypeDefinition;
  readonly installer: ResourceTypeInstaller;
  readonly registeredAt: string;
  readonly source: "builtin" | "plugin";
  readonly pluginId?: string;
}

export interface ResourceTypeInstaller {
  readonly install: (context: InstallerContext) => Promise<InstallOutcome>;
  readonly update?: (context: InstallerContext) => Promise<InstallOutcome>;
  readonly preview?: (context: InstallerContext) => Promise<PreviewOutcome>;
  readonly remove?: (context: RemoveContext) => Promise<void>;
  readonly repair?: (context: InstallerContext) => Promise<InstallOutcome>;
}

export interface InstallerContext {
  readonly resourceId: string;
  readonly version: string;
  readonly source: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>;
  readonly destination: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly config: unknown;
  readonly logger: Logger;
  readonly transactionId?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export interface InstallOutcome {
  readonly success: boolean;
  readonly filesWritten: ReadonlyArray<string>;
  readonly duration: number;
  readonly errors: ReadonlyArray<string>;
}

export interface PreviewOutcome {
  readonly files: ReadonlyArray<PreviewFile>;
  readonly estimatedSize: number;
  readonly conflicts: ReadonlyArray<PreviewConflict>;
}

export interface PreviewFile {
  readonly path: string;
  readonly action: "create" | "overwrite" | "merge" | "skip";
  readonly size: number;
}

export interface PreviewConflict {
  readonly path: string;
  readonly strategy: string;
}

export interface RemoveContext {
  readonly resourceId: string;
  readonly destination: string;
  readonly logger: Logger;
}

export interface ResourceTypeValidator {
  readonly name: string;
  readonly validate: (
    manifest: Record<string, unknown>,
  ) => ValidationResult | Promise<ValidationResult>;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}
