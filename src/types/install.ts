export interface InstallOptions {
  readonly id: string;
  readonly version?: string;
  readonly destination?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly skipDependencies?: boolean;
  readonly skipValidation?: boolean;
  readonly concurrency?: number;
}

export interface InstallResult {
  readonly success: boolean;
  readonly id: string;
  readonly version: string;
  readonly destination: string;
  readonly filesInstalled: number;
  readonly dependenciesInstalled: number;
  readonly duration: number;
  readonly report: InstallReport;
  readonly dryRun: boolean;
}

export interface InstallReport {
  readonly id: string;
  readonly version: string;
  readonly installedAt: string;
  readonly files: ReadonlyArray<InstalledFile>;
  readonly dependencies: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly integrity: IntegrityReport;
}

export interface InstalledFile {
  readonly path: string;
  readonly size: number;
  readonly sha: string;
}

export interface DryRunResult {
  readonly wouldInstall: ReadonlyArray<DryRunFile>;
  readonly wouldDownload: ReadonlyArray<string>;
  readonly estimatedSize: number;
  readonly conflicts: ReadonlyArray<DryRunConflict>;
}

export interface DryRunFile {
  readonly path: string;
  readonly size: number;
}

export interface DryRunConflict {
  readonly path: string;
  readonly existingSize?: number;
  readonly newSize: number;
}

export interface IntegrityReport {
  readonly verified: boolean;
  readonly filesChecked: number;
  readonly filesMatched: number;
  readonly mismatches: ReadonlyArray<string>;
}

export type TransactionStatus =
  | "created"
  | "pending"
  | "preparing"
  | "snapshotting"
  | "executing"
  | "writing"
  | "committing"
  | "committed"
  | "rolling-back"
  | "rolled-back"
  | "failed"
  | "recovery-required";

export interface InstallationTransaction {
  readonly id: string;
  readonly resourceId: string;
  readonly version: string;
  readonly status: TransactionStatus;
  readonly resourceIds: ReadonlyArray<string>;
  readonly snapshotId: string | null;
  readonly createdFiles: ReadonlyArray<string>;
  readonly modifiedFiles: ReadonlyArray<string>;
  readonly deletedFiles: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly error?: string;
  // Phase 28 additions (optional for backward compat)
  readonly operation?: "install" | "update" | "remove" | "rollback" | "bulk";
  readonly targetProject?: string;
  readonly currentStage?: string;
  readonly completedStages?: ReadonlyArray<string>;
  readonly expectedChanges?: ReadonlyArray<string>;
  readonly lockfileChanges?: ReadonlyArray<string>;
  readonly stateChanges?: ReadonlyArray<string>;
  readonly recoveryStatus?: string;
  readonly journal?: ReadonlyArray<{
    at: string;
    stage: string;
    status: TransactionStatus;
  }>;
  readonly plan?: InstallPlan;
  readonly bulkIds?: ReadonlyArray<string>;
}

export interface InstallPlan {
  readonly transactionId: string;
  readonly filesToCreate: ReadonlyArray<string>;
  readonly filesToReplace: ReadonlyArray<string>;
  readonly filesToDelete: ReadonlyArray<string>;
  readonly filesToMerge: ReadonlyArray<string>;
  readonly dependencies: ReadonlyArray<string>;
  readonly artifacts: ReadonlyArray<string>;
  readonly lockfileChanges: ReadonlyArray<string>;
  readonly stateChanges: ReadonlyArray<string>;
  readonly conflicts: ReadonlyArray<string>;
}

type TransactionErrorKind =
  | "retryable"
  | "rollback-required"
  | "recovery-required"
  | "user-action-required"
  | "fatal"
  | "cancelled"
  | "already-completed";

export interface DryRunInstallResult {
  readonly plan: import("./dependencies.js").InstallationPlan;
  readonly wouldCreate: ReadonlyArray<string>;
  readonly wouldModify: ReadonlyArray<string>;
  readonly wouldDelete: ReadonlyArray<string>;
  readonly conflicts: ReadonlyArray<DryRunConflict>;
  readonly estimatedSize: number;
}
