import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type Logger } from "../logger/index.js";
import { fileExists, sha256 } from "../utils/index.js";
import type {
  InstalledResource,
  InstalledStateFile,
  ManagedFile,
  FileIntegrityStatus,
  InstallationState,
} from "../types/installed-state.js";
import { INSTALLED_STATE_SCHEMA_VERSION } from "../types/installed-state.js";

const STATE_FILE = "installed.json";

// In-memory lock to serialize concurrent writes to the same state file
let writeLock: Promise<void> = Promise.resolve();

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const prev = writeLock;
  let release: () => void;
  writeLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    const { rename } = await import("node:fs/promises");
    await rename(tmpPath, filePath);
  } finally {
    release!();
  }
}

export class InstalledStateManager {
  private readonly _logger: Logger;
  private readonly _stateDir: string;
  private _stateFile: string;

  constructor(stateDir: string, logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "installed-state" });
    this._stateDir = stateDir;
    this._stateFile = join(stateDir, STATE_FILE);
  }

  async initialize(): Promise<void> {
    await mkdir(this._stateDir, { recursive: true });
    if (!(await fileExists(this._stateFile))) {
      const initial: InstalledStateFile = {
        schemaVersion: INSTALLED_STATE_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        resources: [],
      };
      await writeJsonAtomic(this._stateFile, initial);
    }
  }

  async getState(): Promise<InstalledStateFile> {
    return readJson<InstalledStateFile>(this._stateFile, {
      schemaVersion: INSTALLED_STATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      resources: [],
    });
  }

  async getResource(resourceId: string): Promise<InstalledResource | null> {
    const state = await this.getState();
    return state.resources.find((r) => r.id === resourceId) ?? null;
  }

  async getAllResources(): Promise<ReadonlyArray<InstalledResource>> {
    const state = await this.getState();
    return state.resources;
  }

  async addResource(resource: InstalledResource): Promise<void> {
    const state = await this.getState();
    const idx = state.resources.findIndex((r) => r.id === resource.id);
    const resources = [...state.resources];
    if (idx >= 0) {
      resources[idx] = resource;
    } else {
      resources.push(resource);
    }
    const updated: InstalledStateFile = {
      ...state,
      updatedAt: new Date().toISOString(),
      resources,
    };
    await writeJsonAtomic(this._stateFile, updated);
    this._logger.debug("Resource added to installed state", {
      id: resource.id,
      version: resource.version,
    });
  }

  async removeResource(resourceId: string): Promise<boolean> {
    const state = await this.getState();
    const idx = state.resources.findIndex((r) => r.id === resourceId);
    if (idx < 0) return false;
    const resources = state.resources.filter((r) => r.id !== resourceId);
    const updated: InstalledStateFile = {
      ...state,
      updatedAt: new Date().toISOString(),
      resources,
    };
    await writeJsonAtomic(this._stateFile, updated);
    this._logger.debug("Resource removed from installed state", {
      id: resourceId,
    });
    return true;
  }

  async updateResourceState(
    resourceId: string,
    newState: InstallationState,
  ): Promise<void> {
    const state = await this.getState();
    const idx = state.resources.findIndex((r) => r.id === resourceId);
    if (idx < 0) return;
    const existing = state.resources[idx]!;
    const updated: InstalledResource = {
      ...existing,
      state: newState,
      updatedAt: new Date().toISOString(),
    };
    const resources = [...state.resources];
    resources[idx] = updated;
    const updatedState: InstalledStateFile = {
      ...state,
      updatedAt: new Date().toISOString(),
      resources,
    };
    await writeJsonAtomic(this._stateFile, updatedState);
  }

  async updateManagedFiles(
    resourceId: string,
    files: ReadonlyArray<ManagedFile>,
  ): Promise<void> {
    const state = await this.getState();
    const idx = state.resources.findIndex((r) => r.id === resourceId);
    if (idx < 0) return;
    const existing = state.resources[idx]!;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const updated: InstalledResource = {
      ...existing,
      managedFiles: files,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...existing.metadata,
        totalSize,
        fileCount: files.length,
      },
    };
    const resources = [...state.resources];
    resources[idx] = updated;
    const updatedState: InstalledStateFile = {
      ...state,
      updatedAt: new Date().toISOString(),
      resources,
    };
    await writeJsonAtomic(this._stateFile, updatedState);
  }

  async fileExists(
    resourceId: string,
    relativePath: string,
    destination: string,
  ): Promise<boolean> {
    const fullPath = join(destination, resourceId, relativePath);
    try {
      await stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async checkFileIntegrity(
    resourceId: string,
    relativePath: string,
    destination: string,
  ): Promise<FileIntegrityStatus> {
    const resource = await this.getResource(resourceId);
    if (resource === null) return "unknown";
    const managed = resource.managedFiles.find(
      (f) => f.relativePath === relativePath,
    );
    if (managed === undefined) return "unknown";

    const fullPath = join(destination, resourceId, relativePath);
    try {
      const content = await readFile(fullPath, "utf-8");
      const currentSha = sha256(content);
      if (currentSha === managed.expectedSha) return "match";
      return "modified";
    } catch {
      return "missing";
    }
  }

  async rebuildFromLockfile(
    lockfileEntries: ReadonlyArray<{
      id: string;
      version: string;
      integrity: string;
      dependencies: ReadonlyArray<{ id: string; version: string }>;
      installedAt: string;
      source: string;
    }>,
    destination: string,
  ): Promise<ReadonlyArray<InstalledResource>> {
    const rebuilt: Array<InstalledResource> = [];

    for (const entry of lockfileEntries) {
      const existing = await this.getResource(entry.id);
      if (existing !== null) {
        rebuilt.push(existing);
        continue;
      }

      const resourceDir = join(destination, entry.id);
      const managedFiles = await this._scanManagedFiles(
        resourceDir,
        entry.id,
        destination,
      );

      const totalSize = managedFiles.reduce((sum, f) => sum + f.size, 0);
      const resource: InstalledResource = {
        id: entry.id,
        version: entry.version,
        state: managedFiles.length > 0 ? "installed" : "missing",
        installedAt: entry.installedAt,
        updatedAt: new Date().toISOString(),
        source: entry.source,
        registryRevision: null,
        resourceRevision: null,
        integrity: entry.integrity,
        managedFiles,
        dependencies: entry.dependencies.map((d) => ({
          id: d.id,
          version: d.version,
          optional: false,
        })),
        transactionId: null,
        metadata: {
          manifestHash: "",
          destination,
          totalSize,
          fileCount: managedFiles.length,
        },
      };

      await this.addResource(resource);
      rebuilt.push(resource);
    }

    return rebuilt;
  }

  private async _scanManagedFiles(
    dir: string,
    resourceId: string,
    destination: string,
  ): Promise<Array<ManagedFile>> {
    const files: Array<ManagedFile> = [];
    try {
      const entries = await import("node:fs/promises").then((m) =>
        m.readdir(dir, { withFileTypes: true }),
      );
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this._scanManagedFiles(
            fullPath,
            resourceId,
            destination,
          );
          files.push(...subFiles);
        } else {
          try {
            const content = await readFile(fullPath, "utf-8");
            const relativePath = fullPath.substring(
              join(destination, resourceId).length + 1,
            );
            files.push({
              relativePath,
              sha: sha256(content),
              size: Buffer.byteLength(content),
              installedAt: new Date().toISOString(),
              expectedSha: sha256(content),
              integrityStatus: "match" as const,
            });
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // directory doesn't exist
    }
    return files;
  }
}

export function createInstalledStateManager(
  stateDir: string,
  logger?: Logger,
): InstalledStateManager {
  return new InstalledStateManager(stateDir, logger);
}
