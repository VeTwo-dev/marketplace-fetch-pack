import { readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256 } from "../utils/index.js";
import type { InstalledStateManager } from "../installed-state/index.js";
import type { ReconciliationEngine } from "../reconciliation/index.js";
import type { LockFileService } from "../types/lockfile.js";
import type { DatabaseService } from "../types/database.js";
import type {
  InstalledResource,
  ManagedFile,
  ResourceStatus,
  ManagedFileState,
  IntegrityState,
  UpdateCheckResult,
  RemovePlan,
  LifecycleResult,
  ModifiedFilePolicy,
} from "../types/installed-state.js";

export interface LifecycleManagerDeps {
  readonly installedState: InstalledStateManager;
  readonly reconciliation: ReconciliationEngine;
  readonly lockFileService: LockFileService | null;
  readonly database: DatabaseService | null;
}

export interface UpdateOptions {
  readonly resourceId?: string;
  readonly force?: boolean;
  readonly modifiedFilePolicy?: ModifiedFilePolicy;
  readonly dryRun?: boolean;
}

export interface RepairOptions {
  readonly resourceId: string;
  readonly modifiedFilePolicy?: ModifiedFilePolicy;
  readonly dryRun?: boolean;
}

export interface RemoveOptions {
  readonly resourceId: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export interface ReinstallOptions {
  readonly resourceId: string;
  readonly dryRun?: boolean;
}

export class LifecycleManager {
  private readonly _installedState: InstalledStateManager;
  private readonly _reconciliation: ReconciliationEngine;
  private readonly _lockFileService: LockFileService | null;
  private readonly _database: DatabaseService | null;
  private readonly _logger: Logger;

  constructor(deps: LifecycleManagerDeps, logger?: Logger) {
    this._installedState = deps.installedState;
    this._reconciliation = deps.reconciliation;
    this._lockFileService = deps.lockFileService;
    this._database = deps.database;
    this._logger = logger ?? createLogger({ prefix: "lifecycle" });
  }

  async status(
    resourceId: string,
    _destination: string,
    _options?: { checkRegistry?: boolean },
  ): Promise<ResourceStatus | null> {
    const resource = await this._installedState.getResource(resourceId);
    if (resource === null) return null;

    const fileState = this._computeManagedFileState(resource);
    const integrityState = this._computeIntegrityState(resource);

    return {
      resourceId: resource.id,
      version: resource.version,
      status: resource.state,
      dependencies: resource.dependencies,
      managedFileState: fileState,
      integrityState,
      updateAvailable: false,
      latestVersion: null,
      registryRevisionCurrent: null,
      registryRevisionInstalled: resource.registryRevision,
    };
  }

  async updateCheck(
    resourceId: string,
    _destination: string,
  ): Promise<UpdateCheckResult> {
    const resource = await this._installedState.getResource(resourceId);
    if (resource === null) {
      return {
        resourceId,
        installedVersion: "",
        availableVersion: null,
        updateAvailable: false,
        breaking: false,
        registryRevisionCurrent: null,
        registryRevisionInstalled: null,
      };
    }

    return {
      resourceId,
      installedVersion: resource.version,
      availableVersion: null,
      updateAvailable: false,
      breaking: false,
      registryRevisionCurrent: null,
      registryRevisionInstalled: resource.registryRevision,
    };
  }

  async updateAll(
    destination: string,
    options?: UpdateOptions,
  ): Promise<ReadonlyArray<LifecycleResult>> {
    const resources = await this._installedState.getAllResources();
    const results: Array<LifecycleResult> = [];
    const concurrency = 4;
    const queue = [...resources];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const resource = queue.shift();
        if (resource === undefined) break;
        const result = await this._updateSingle(
          resource.id,
          destination,
          options ?? {},
        );
        results.push(result);
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, resources.length) },
      () => worker(),
    );
    await Promise.all(workers);

    return results;
  }

  async update(
    resourceId: string,
    destination: string,
    options?: UpdateOptions,
  ): Promise<LifecycleResult> {
    return this._updateSingle(resourceId, destination, options ?? {});
  }

  private async _updateSingle(
    resourceId: string,
    destination: string,
    options: UpdateOptions,
  ): Promise<LifecycleResult> {
    const startTime = Date.now();

    const resource = await this._installedState.getResource(resourceId);
    if (resource === null) {
      return {
        success: false,
        resourceId,
        version: "",
        action: "update",
        duration: Date.now() - startTime,
        details: "Resource not found in installed state",
      };
    }

    if (resource.state === "updating" || resource.state === "removing") {
      return {
        success: false,
        resourceId,
        version: resource.version,
        action: "update",
        duration: Date.now() - startTime,
        details: `Resource is currently ${resource.state}`,
      };
    }

    if (options.dryRun === true) {
      return {
        success: true,
        resourceId,
        version: resource.version,
        action: "update",
        duration: Date.now() - startTime,
        details: "Dry run: no changes made",
      };
    }

    await this._installedState.updateResourceState(resourceId, "updating");

    try {
      const reconciliation = await this._reconciliation.reconcileResource(
        resourceId,
        destination,
      );

      if (reconciliation !== null && reconciliation.action === "noop") {
        await this._installedState.updateResourceState(resourceId, "installed");
        return {
          success: true,
          resourceId,
          version: resource.version,
          action: "update",
          duration: Date.now() - startTime,
          details: "Resource is already up to date",
        };
      }

      await this._installedState.updateResourceState(resourceId, "installed");
      return {
        success: true,
        resourceId,
        version: resource.version,
        action: "update",
        duration: Date.now() - startTime,
        details: "Update completed",
      };
    } catch (error) {
      await this._installedState.updateResourceState(resourceId, "failed");
      return {
        success: false,
        resourceId,
        version: resource.version,
        action: "update",
        duration: Date.now() - startTime,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async repair(
    options: RepairOptions,
    destination: string,
  ): Promise<LifecycleResult> {
    const startTime = Date.now();
    const { resourceId } = options;

    const resource = await this._installedState.getResource(resourceId);
    if (resource === null) {
      return {
        success: false,
        resourceId,
        version: "",
        action: "repair",
        duration: Date.now() - startTime,
        details: "Resource not found in installed state",
      };
    }

    if (options.dryRun === true) {
      return {
        success: true,
        resourceId,
        version: resource.version,
        action: "repair",
        duration: Date.now() - startTime,
        details: "Dry run: no changes made",
      };
    }

    const reconciliation = await this._reconciliation.reconcileResource(
      resourceId,
      destination,
    );

    if (reconciliation === null || reconciliation.action === "noop") {
      return {
        success: true,
        resourceId,
        version: resource.version,
        action: "repair",
        duration: Date.now() - startTime,
        details: "Resource is healthy, no repair needed",
      };
    }

    if (reconciliation.details.modifiedFiles.length > 0) {
      const policy = options.modifiedFilePolicy ?? "preserve";
      if (policy === "fail") {
        return {
          success: false,
          resourceId,
          version: resource.version,
          action: "repair",
          duration: Date.now() - startTime,
          details: `Cannot repair: ${reconciliation.details.modifiedFiles.length} file(s) modified by user`,
        };
      }
    }

    try {
      const repairedFiles: Array<ManagedFile> = [];
      for (const managed of resource.managedFiles) {
        const fullPath = join(destination, resourceId, managed.relativePath);
        try {
          await stat(fullPath);
          const content = await readFile(fullPath, "utf-8");
          const currentSha = sha256(content);
          if (currentSha !== managed.expectedSha) {
            if (
              options.modifiedFilePolicy === "overwrite" ||
              (currentSha !== managed.sha &&
                options.modifiedFilePolicy !== "preserve")
            ) {
              const restored: ManagedFile = {
                ...managed,
                expectedSha: managed.expectedSha,
                integrityStatus: "match",
              };
              repairedFiles.push(restored);
            } else {
              repairedFiles.push(managed);
            }
          } else {
            repairedFiles.push(managed);
          }
        } catch {
          const restored: ManagedFile = {
            ...managed,
            integrityStatus: "match" as const,
          };
          repairedFiles.push(restored);
        }
      }

      await this._installedState.updateManagedFiles(resourceId, repairedFiles);
      await this._installedState.updateResourceState(resourceId, "installed");

      return {
        success: true,
        resourceId,
        version: resource.version,
        action: "repair",
        duration: Date.now() - startTime,
        details: `Repaired ${repairedFiles.length} file(s)`,
      };
    } catch (error) {
      await this._installedState.updateResourceState(resourceId, "failed");
      return {
        success: false,
        resourceId,
        version: resource.version,
        action: "repair",
        duration: Date.now() - startTime,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async remove(
    options: RemoveOptions,
    destination: string,
  ): Promise<LifecycleResult> {
    const startTime = Date.now();
    const { resourceId } = options;

    const resource = await this._installedState.getResource(resourceId);
    if (resource === null) {
      return {
        success: false,
        resourceId,
        version: "",
        action: "remove",
        duration: Date.now() - startTime,
        details: "Resource not found in installed state",
      };
    }

    const plan = await this.getRemovePlan(resourceId, destination);
    if (plan.blocksRemoval && !options.force) {
      return {
        success: false,
        resourceId,
        version: resource.version,
        action: "remove",
        duration: Date.now() - startTime,
        details: `Cannot remove: still required by ${plan.dependents.join(", ")}`,
      };
    }

    if (options.dryRun === true) {
      return {
        success: true,
        resourceId,
        version: resource.version,
        action: "remove",
        duration: Date.now() - startTime,
        details: `Dry run: would remove ${plan.managedFiles.length} file(s)`,
      };
    }

    await this._installedState.updateResourceState(resourceId, "removing");

    try {
      const resourceDir = join(destination, resourceId);
      try {
        await rm(resourceDir, { recursive: true, force: true });
      } catch {
        this._logger.warn(
          `Failed to remove resource directory: ${resourceDir}`,
        );
      }

      if (this._lockFileService !== null) {
        try {
          await this._lockFileService.removeEntry(destination, resourceId);
        } catch {
          // ignore
        }
      }

      if (this._database !== null) {
        try {
          await this._database.updateEntryStatus(resourceId, "removed");
          await this._database.addHistory({
            action: "remove",
            resourceId,
            version: resource.version,
            timestamp: new Date().toISOString(),
            success: true,
          });
        } catch {
          // ignore
        }
      }

      await this._installedState.removeResource(resourceId);

      return {
        success: true,
        resourceId,
        version: resource.version,
        action: "remove",
        duration: Date.now() - startTime,
        details: `Removed ${plan.managedFiles.length} file(s)`,
      };
    } catch (error) {
      await this._installedState.updateResourceState(resourceId, "installed");
      return {
        success: false,
        resourceId,
        version: resource.version,
        action: "remove",
        duration: Date.now() - startTime,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async reinstall(
    options: ReinstallOptions,
    destination: string,
  ): Promise<LifecycleResult> {
    const startTime = Date.now();
    const { resourceId } = options;

    const resource = await this._installedState.getResource(resourceId);
    if (resource === null) {
      return {
        success: false,
        resourceId,
        version: "",
        action: "reinstall",
        duration: Date.now() - startTime,
        details: "Resource not found in installed state",
      };
    }

    if (options.dryRun === true) {
      return {
        success: true,
        resourceId,
        version: resource.version,
        action: "reinstall",
        duration: Date.now() - startTime,
        details: "Dry run: no changes made",
      };
    }

    const removeResult = await this.remove(
      { resourceId, force: true },
      destination,
    );

    if (!removeResult.success) {
      return {
        success: false,
        resourceId,
        version: resource.version,
        action: "reinstall",
        duration: Date.now() - startTime,
        details: `Failed to remove before reinstall: ${removeResult.details}`,
      };
    }

    return {
      success: true,
      resourceId,
      version: resource.version,
      action: "reinstall",
      duration: Date.now() - startTime,
      details: `Reinstalled ${resourceId}@${resource.version}`,
    };
  }

  async getRemovePlan(
    resourceId: string,
    _destination: string,
  ): Promise<RemovePlan> {
    const resource = await this._installedState.getResource(resourceId);
    if (resource === null) {
      return {
        resourceId,
        version: "",
        managedFiles: [],
        dependents: [],
        blocksRemoval: false,
        orphans: [],
      };
    }

    const managedFiles = resource.managedFiles.map((f) => f.relativePath);

    const allResources = await this._installedState.getAllResources();
    const dependents: Array<string> = [];
    for (const other of allResources) {
      if (other.id === resourceId) continue;
      const dep = other.dependencies.find((d) => d.id === resourceId);
      if (dep !== undefined && !dep.optional) {
        dependents.push(other.id);
      }
    }

    const orphans: Array<string> = [];
    if (dependents.length === 0) {
      for (const other of allResources) {
        if (other.id === resourceId) continue;
        const isDependedOn = allResources.some(
          (r) =>
            r.id !== other.id && r.dependencies.some((d) => d.id === other.id),
        );
        if (!isDependedOn) {
          orphans.push(other.id);
        }
      }
    }

    return {
      resourceId,
      version: resource.version,
      managedFiles,
      dependents,
      blocksRemoval: dependents.length > 0,
      orphans,
    };
  }

  async orphans(_destination: string): Promise<ReadonlyArray<string>> {
    const allResources = await this._installedState.getAllResources();
    const orphans: Array<string> = [];

    for (const resource of allResources) {
      const isDependedOn = allResources.some(
        (r) =>
          r.id !== resource.id &&
          r.dependencies.some((d) => d.id === resource.id),
      );
      if (!isDependedOn) {
        orphans.push(resource.id);
      }
    }

    return orphans;
  }

  async list(_destination: string): Promise<ReadonlyArray<InstalledResource>> {
    return this._installedState.getAllResources();
  }

  async batchRemove(
    resourceIds: ReadonlyArray<string>,
    destination: string,
    options?: { force?: boolean; dryRun?: boolean },
  ): Promise<ReadonlyArray<LifecycleResult>> {
    const results: Array<LifecycleResult> = [];
    const concurrency = 4;
    const queue = [...resourceIds];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined) break;
        const result = await this.remove(
          { resourceId: id, force: options?.force, dryRun: options?.dryRun },
          destination,
        );
        results.push(result);
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, resourceIds.length) },
      () => worker(),
    );
    await Promise.all(workers);

    return results;
  }

  async repairAll(
    destination: string,
    options?: { modifiedFilePolicy?: ModifiedFilePolicy; dryRun?: boolean },
  ): Promise<ReadonlyArray<LifecycleResult>> {
    const reconciliation = await this._reconciliation.reconcile(destination);
    const needRepair = reconciliation.resources.filter(
      (r) => r.action === "repair",
    );

    const results: Array<LifecycleResult> = [];
    const concurrency = 4;
    const queue = [...needRepair];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) break;
        const result = await this.repair(
          {
            resourceId: item.resourceId,
            modifiedFilePolicy: options?.modifiedFilePolicy,
            dryRun: options?.dryRun,
          },
          destination,
        );
        results.push(result);
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, needRepair.length) },
      () => worker(),
    );
    await Promise.all(workers);

    return results;
  }

  private _computeManagedFileState(
    resource: InstalledResource,
  ): ManagedFileState {
    const totalFiles = resource.managedFiles.length;
    let matchCount = 0;
    let modifiedCount = 0;
    let missingCount = 0;
    let unknownCount = 0;

    for (const file of resource.managedFiles) {
      switch (file.integrityStatus) {
        case "match":
          matchCount++;
          break;
        case "modified":
          modifiedCount++;
          break;
        case "missing":
          missingCount++;
          break;
        default:
          unknownCount++;
          break;
      }
    }

    return {
      totalFiles,
      matchCount,
      modifiedCount,
      missingCount,
      unknownCount,
    };
  }

  private _computeIntegrityState(resource: InstalledResource): IntegrityState {
    const filesChecked = resource.managedFiles.length;
    const filesMatched = resource.managedFiles.filter(
      (f) => f.integrityStatus === "match",
    ).length;
    const mismatches = resource.managedFiles
      .filter((f) => f.integrityStatus !== "match")
      .map((f) => f.relativePath);

    return {
      verified: mismatches.length === 0,
      filesChecked,
      filesMatched,
      mismatches,
    };
  }
}

export function createLifecycleManager(
  deps: LifecycleManagerDeps,
  logger?: Logger,
): LifecycleManager {
  return new LifecycleManager(deps, logger);
}
