export const INSTALLED_STATE_SCHEMA_VERSION = 1;

export type InstallationState =
  | "unknown"
  | "pending"
  | "installing"
  | "installed"
  | "modified"
  | "missing"
  | "corrupted"
  | "updating"
  | "removing"
  | "failed"
  | "rolled-back";

export type FileIntegrityStatus = "match" | "modified" | "missing" | "unknown";

export interface ManagedFile {
  readonly relativePath: string;
  readonly sha: string;
  readonly size: number;
  readonly installedAt: string;
  readonly expectedSha: string;
  readonly integrityStatus: FileIntegrityStatus;
}

export interface InstalledResource {
  readonly id: string;
  readonly version: string;
  readonly state: InstallationState;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly source: string;
  readonly registryRevision: string | null;
  readonly resourceRevision: string | null;
  readonly integrity: string;
  readonly managedFiles: ReadonlyArray<ManagedFile>;
  readonly dependencies: ReadonlyArray<InstalledDependency>;
  readonly transactionId: string | null;
  readonly metadata: InstalledResourceMetadata;
}

export interface InstalledDependency {
  readonly id: string;
  readonly version: string;
  readonly optional: boolean;
}

export interface InstalledResourceMetadata {
  readonly manifestHash: string;
  readonly destination: string;
  readonly totalSize: number;
  readonly fileCount: number;
}

export interface InstalledStateFile {
  readonly schemaVersion: number;
  readonly updatedAt: string;
  readonly resources: ReadonlyArray<InstalledResource>;
}

export type ReconciliationAction =
  "noop" | "update" | "repair" | "remove" | "reinstall" | "manual-review";

export interface ReconciliationItem {
  readonly resourceId: string;
  readonly currentState: InstallationState;
  readonly detectedState: InstallationState;
  readonly action: ReconciliationAction;
  readonly reason: string;
  readonly details: ReconciliationDetails;
}

export interface ReconciliationDetails {
  readonly missingFiles: ReadonlyArray<string>;
  readonly modifiedFiles: ReadonlyArray<string>;
  readonly corruptedFiles: ReadonlyArray<string>;
  readonly lockfileMismatch: boolean;
  readonly registryRevisionMismatch: boolean;
  readonly versionMismatch: boolean;
}

export interface ReconciliationResult {
  readonly timestamp: string;
  readonly resources: ReadonlyArray<ReconciliationItem>;
  readonly healthy: ReadonlyArray<string>;
  readonly modified: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
  readonly corrupted: ReadonlyArray<string>;
  readonly stale: ReadonlyArray<string>;
  readonly unknown: ReadonlyArray<string>;
  readonly lockfileMismatches: ReadonlyArray<string>;
  readonly recommendedActions: ReadonlyArray<ReconciliationItem>;
  readonly offlineCapable: boolean;
  readonly registryAvailable: boolean;
}

export interface ResourceStatus {
  readonly resourceId: string;
  readonly version: string;
  readonly status: InstallationState;
  readonly dependencies: ReadonlyArray<InstalledDependency>;
  readonly managedFileState: ManagedFileState;
  readonly integrityState: IntegrityState;
  readonly updateAvailable: boolean;
  readonly latestVersion: string | null;
  readonly registryRevisionCurrent: string | null;
  readonly registryRevisionInstalled: string | null;
}

export interface ManagedFileState {
  readonly totalFiles: number;
  readonly matchCount: number;
  readonly modifiedCount: number;
  readonly missingCount: number;
  readonly unknownCount: number;
}

export interface IntegrityState {
  readonly verified: boolean;
  readonly filesChecked: number;
  readonly filesMatched: number;
  readonly mismatches: ReadonlyArray<string>;
}

export interface UpdateCheckResult {
  readonly resourceId: string;
  readonly installedVersion: string;
  readonly availableVersion: string | null;
  readonly updateAvailable: boolean;
  readonly breaking: boolean;
  readonly registryRevisionCurrent: string | null;
  readonly registryRevisionInstalled: string | null;
}

export interface RemovePlan {
  readonly resourceId: string;
  readonly version: string;
  readonly managedFiles: ReadonlyArray<string>;
  readonly dependents: ReadonlyArray<string>;
  readonly blocksRemoval: boolean;
  readonly orphans: ReadonlyArray<string>;
}

export interface LifecycleResult {
  readonly success: boolean;
  readonly resourceId: string;
  readonly version: string;
  readonly action: string;
  readonly duration: number;
  readonly details: string;
}

export type ModifiedFilePolicy = "preserve" | "overwrite" | "fail" | "prompt";
