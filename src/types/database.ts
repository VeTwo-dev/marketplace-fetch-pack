export interface DatabaseConfig {
  readonly directory: string;
  readonly maxHistoryEntries: number;
}

export interface DatabaseEntry {
  readonly id: string;
  readonly resourceId: string;
  readonly version: string;
  readonly installedAt: string;
  readonly destination: string;
  readonly manifestHash: string;
  readonly files: ReadonlyArray<DatabaseFileEntry>;
  readonly status: DatabaseEntryStatus;
}

export type DatabaseEntryStatus =
  "installed" | "pending" | "failed" | "removed";

export interface DatabaseFileEntry {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
}

export interface DatabaseHistoryEntry {
  readonly action: DatabaseAction;
  readonly resourceId: string;
  readonly version: string;
  readonly timestamp: string;
  readonly success: boolean;
  readonly details?: string;
}

export type DatabaseAction = "install" | "update" | "remove" | "rollback";

export interface DatabaseService {
  initialize(basePath: string): Promise<void>;
  addEntry(entry: DatabaseEntry): Promise<void>;
  removeEntry(resourceId: string): Promise<void>;
  getEntry(resourceId: string): Promise<DatabaseEntry | null>;
  getAllEntries(): Promise<ReadonlyArray<DatabaseEntry>>;
  hasEntry(resourceId: string): Promise<boolean>;
  updateEntryStatus(
    resourceId: string,
    status: DatabaseEntryStatus,
  ): Promise<void>;
  addHistory(entry: DatabaseHistoryEntry): Promise<void>;
  getHistory(
    resourceId?: string,
    limit?: number,
  ): Promise<ReadonlyArray<DatabaseHistoryEntry>>;
  clearHistory(): Promise<void>;
  getReports(resourceId?: string): Promise<ReadonlyArray<InstallReport>>;
}

export interface InstallReport {
  readonly id: string;
  readonly resourceId: string;
  readonly version: string;
  readonly timestamp: string;
  readonly success: boolean;
  readonly filesInstalled: number;
  readonly duration: number;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export interface LocalDatabase {
  readonly entries: DatabaseService;
  readonly basePath: string;
  readonly initialized: boolean;
}
