export interface LockFile {
  readonly version: string;
  readonly generatedAt: string;
  readonly lockfileVersion: number;
  readonly resources: ReadonlyArray<LockEntry>;
}

export interface LockEntry {
  readonly id: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity: string;
  readonly dependencies: ReadonlyArray<LockDependency>;
  readonly installedAt: string;
  readonly source: string;
}

export interface LockDependency {
  readonly id: string;
  readonly version: string;
}

export interface LockFileEntry {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
}

export interface LockFileService {
  read(destination: string): Promise<LockFile | null>;
  write(destination: string, lockfile: LockFile): Promise<void>;
  addEntry(destination: string, entry: LockEntry): Promise<void>;
  removeEntry(destination: string, resourceId: string): Promise<void>;
  hasEntry(destination: string, resourceId: string): Promise<boolean>;
  getEntry(destination: string, resourceId: string): Promise<LockEntry | null>;
  clear(destination: string): Promise<void>;
}
