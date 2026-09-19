export interface PipelineContext {
  readonly resourceId: string;
  readonly version: string;
  readonly destination: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly options: PipelineOptions;
  readonly manifest: unknown;
  /** Registered resource type id — drives per-type transforms/merges */
  readonly resourceType?: string;
  readonly files: Array<PipelineFile>;
  readonly snapshot: PipelineSnapshot | null;
  readonly errors: Array<PipelineError>;
  readonly warnings: Array<string>;
  readonly metadata: PipelineMetadata;
  readonly dependencyPlan?: import("./dependencies.js").InstallationPlan;
  readonly transactionId?: string;
}

export interface PipelineFile {
  readonly sourcePath: string;
  readonly relativePath: string;
  readonly targetPath?: string;
  readonly content: string;
  readonly sha: string;
  readonly size: number;
  readonly action: PipelineAction;
  readonly mergeStrategy?: MergeStrategyName;
}

export type PipelineAction =
  "create" | "overwrite" | "merge" | "skip" | "append" | "prepend" | "patch";

type MergeStrategyName =
  | "copy"
  | "replace"
  | "merge"
  | "append"
  | "prepend"
  | "patch"
  | "ast"
  | "template";

export interface PipelineOptions {
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly skipDependencies: boolean;
  readonly skipTransforms: boolean;
  readonly skipMerge: boolean;
  readonly skipValidation: boolean;
  readonly concurrency: number;
}

export interface PipelineSnapshot {
  readonly id: string;
  readonly timestamp: string;
  readonly files: ReadonlyArray<SnapshotFile>;
}

export interface SnapshotFile {
  readonly path: string;
  readonly content: string;
  readonly sha: string;
}

export interface PipelineError {
  readonly stage: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface PipelineMetadata {
  readonly startTime: number;
  readonly endTime?: number;
  readonly stagesCompleted: ReadonlyArray<string>;
  readonly filesProcessed: number;
  readonly bytesWritten: number;
  readonly [key: string]: unknown;
}

export interface PipelineStage {
  readonly name: string;
  readonly execute: (context: PipelineContext) => Promise<PipelineContext>;
  readonly rollback?: (context: PipelineContext) => Promise<PipelineContext>;
}

export interface PipelineResult {
  readonly success: boolean;
  readonly resourceId: string;
  readonly version: string;
  readonly destination: string;
  readonly filesWritten: ReadonlyArray<string>;
  readonly stagesCompleted: ReadonlyArray<string>;
  readonly duration: number;
  readonly errors: ReadonlyArray<PipelineError>;
  readonly warnings: ReadonlyArray<string>;
  readonly snapshotId: string | null;
}
