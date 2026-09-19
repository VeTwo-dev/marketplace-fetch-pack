import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createLogger, type Logger } from "../logger/index.js";
import { fileExists, sha256 } from "../utils/index.js";
import type {
  Snapshot,
  SnapshotEntry,
  SnapshotManager,
  SnapshotRestoreResult,
  SnapshotConfig,
} from "../types/snapshot.js";

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const randomHex = createHash("sha256")
    .update(`${timestamp}-${Math.random().toString(36).slice(2)}`)
    .digest("hex")
    .slice(0, 8);
  return `${timestamp}-${randomHex}`;
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function listFiles(
  dir: string,
  basePath: string,
  excludeDir?: string,
): Promise<ReadonlyArray<string>> {
  const results: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return results;
  }
  for (const name of names) {
    if (excludeDir && join(dir, name) === excludeDir) continue;
    const fullPath = join(dir, name);
    let isDir: boolean;
    try {
      const s = await stat(fullPath);
      isDir = s.isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      const subFiles = await listFiles(fullPath, basePath, excludeDir);
      results.push(...subFiles);
    } else {
      const relative = fullPath.slice(basePath.length + 1);
      results.push(relative);
    }
  }
  return results;
}

class SnapshotManagerImpl implements SnapshotManager {
  private readonly logger: Logger;
  private readonly snapshotsDir: string;

  constructor(
    private readonly basePath: string,
    private readonly config: SnapshotConfig,
    private readonly stateRoot?: string,
  ) {
    this.logger = createLogger({ prefix: "snapshot" });
    this.snapshotsDir = join(basePath, config.directory);
  }

  async create(
    resourceId: string,
    version: string,
    destination: string,
  ): Promise<Snapshot> {
    await mkdir(this.snapshotsDir, { recursive: true });

    const files: SnapshotEntry[] = [];
    const filePaths = await listFiles(destination, destination, this.stateRoot);

    for (const relPath of filePaths) {
      const fullPath = join(destination, relPath);
      const content = await readFileSafe(fullPath);
      if (content !== null) {
        files.push({
          path: relPath,
          content,
          sha: sha256(content),
          size: Buffer.byteLength(content, "utf-8"),
          action: "modified",
        });
      }
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    const snapshot: Snapshot = {
      id: generateId(),
      resourceId,
      version,
      timestamp: new Date().toISOString(),
      files,
      metadata: {
        destination,
        pipelineStages: [],
        totalFiles: files.length,
        totalSize,
      },
    };

    const snapshotPath = join(this.snapshotsDir, `${snapshot.id}.json`);
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
    this.logger.info("Snapshot created", {
      id: snapshot.id,
      resourceId,
      fileCount: files.length,
    });

    return snapshot;
  }

  async restore(snapshotId: string): Promise<SnapshotRestoreResult> {
    const snapshot = await this.readSnapshotFromDisk(snapshotId);
    if (snapshot === null) {
      return {
        success: false,
        filesRestored: 0,
        filesFailed: 0,
        errors: [`Snapshot ${snapshotId} not found`],
      };
    }

    const errors: string[] = [];
    let filesRestored = 0;
    let filesFailed = 0;

    for (const entry of snapshot.files) {
      const fullPath = join(snapshot.metadata.destination, entry.path);
      try {
        if (entry.action === "deleted") {
          if (await fileExists(fullPath)) {
            await rm(fullPath);
          }
        } else {
          const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
          await mkdir(dir, { recursive: true });
          await writeFile(fullPath, entry.content, "utf-8");
        }
        filesRestored++;
      } catch (err) {
        filesFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to restore ${entry.path}: ${msg}`);
      }
    }

    return { success: filesFailed === 0, filesRestored, filesFailed, errors };
  }

  async delete(snapshotId: string): Promise<boolean> {
    const snapshotPath = join(this.snapshotsDir, `${snapshotId}.json`);
    if (!(await fileExists(snapshotPath))) {
      return false;
    }
    await rm(snapshotPath);
    this.logger.info("Snapshot deleted", { id: snapshotId });
    return true;
  }

  async list(resourceId?: string): Promise<ReadonlyArray<Snapshot>> {
    await mkdir(this.snapshotsDir, { recursive: true });
    let fileNames: string[];
    try {
      fileNames = await readdir(this.snapshotsDir);
    } catch {
      return [];
    }

    const snapshots: Snapshot[] = [];
    for (const file of fileNames) {
      if (!file.endsWith(".json")) continue;
      const snapshot = await this.readSnapshotFromDisk(
        file.replace(".json", ""),
      );
      if (snapshot !== null) {
        if (resourceId === undefined || snapshot.resourceId === resourceId) {
          snapshots.push(snapshot);
        }
      }
    }
    return snapshots;
  }

  async get(snapshotId: string): Promise<Snapshot | null> {
    return this.readSnapshotFromDisk(snapshotId);
  }

  async clean(olderThanMs: number): Promise<number> {
    const snapshots = await this.list();
    const now = Date.now();
    let count = 0;

    for (const snapshot of snapshots) {
      const age = now - new Date(snapshot.timestamp).getTime();
      if (age > olderThanMs) {
        const deleted = await this.delete(snapshot.id);
        if (deleted) count++;
      }
    }

    this.logger.info("Snapshots cleaned", { count });
    return count;
  }

  private async readSnapshotFromDisk(
    snapshotId: string,
  ): Promise<Snapshot | null> {
    const snapshotPath = join(this.snapshotsDir, `${snapshotId}.json`);
    const content = await readFileSafe(snapshotPath);
    if (content === null) return null;
    try {
      return JSON.parse(content) as Snapshot;
    } catch {
      return null;
    }
  }
}

export function createSnapshotManager(
  basePath: string,
  config: SnapshotConfig,
  stateRoot?: string,
): SnapshotManager {
  return new SnapshotManagerImpl(basePath, config, stateRoot);
}
