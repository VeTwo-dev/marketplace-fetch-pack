export interface Snapshot {
  readonly id: string;
  readonly resourceId: string;
  readonly version: string;
  readonly timestamp: string;
  readonly files: ReadonlyArray<SnapshotEntry>;
  readonly metadata: SnapshotMetadata;
}

export interface SnapshotEntry {
  readonly path: string;
  readonly content: string;
  readonly sha: string;
  readonly size: number;
  readonly action: "created" | "modified" | "deleted";
}

export interface SnapshotMetadata {
  readonly destination: string;
  readonly pipelineStages: ReadonlyArray<string>;
  readonly totalFiles: number;
  readonly totalSize: number;
}

export interface SnapshotManager {
  create(
    resourceId: string,
    version: string,
    destination: string,
  ): Promise<Snapshot>;
  restore(snapshotId: string): Promise<SnapshotRestoreResult>;
  delete(snapshotId: string): Promise<boolean>;
  list(resourceId?: string): Promise<ReadonlyArray<Snapshot>>;
  get(snapshotId: string): Promise<Snapshot | null>;
  clean(olderThanMs: number): Promise<number>;
}

export interface SnapshotRestoreResult {
  readonly success: boolean;
  readonly filesRestored: number;
  readonly filesFailed: number;
  readonly errors: ReadonlyArray<string>;
}

export interface SnapshotConfig {
  readonly enabled: boolean;
  readonly maxSnapshots: number;
  readonly retentionDays: number;
  readonly directory: string;
}
