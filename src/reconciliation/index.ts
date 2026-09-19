import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256 } from "../utils/index.js";
import type { InstalledStateManager } from "../installed-state/index.js";
import type { LockFileService } from "../types/lockfile.js";
import type {
  InstalledResource,
  ReconciliationResult,
  ReconciliationItem,
  ReconciliationAction,
  ReconciliationDetails,
  InstallationState,
} from "../types/installed-state.js";

export interface ReconciliationEngineDeps {
  readonly installedState: InstalledStateManager;
  readonly lockFileService: LockFileService | null;
}

export class ReconciliationEngine {
  private readonly _installedState: InstalledStateManager;
  private readonly _lockFileService: LockFileService | null;
  private readonly _logger: Logger;

  constructor(deps: ReconciliationEngineDeps, logger?: Logger) {
    this._installedState = deps.installedState;
    this._lockFileService = deps.lockFileService;
    this._logger = logger ?? createLogger({ prefix: "reconciliation" });
  }

  async reconcile(
    destination: string,
    options?: { registryAvailable?: boolean },
  ): Promise<ReconciliationResult> {
    const registryAvailable = options?.registryAvailable ?? false;
    const resources = await this._installedState.getAllResources();
    const items: Array<ReconciliationItem> = [];

    const lockfileEntries = new Map<
      string,
      { version: string; integrity: string }
    >();
    if (this._lockFileService !== null) {
      const lockfile = await this._lockFileService.read(destination);
      if (lockfile !== null) {
        for (const entry of lockfile.resources) {
          lockfileEntries.set(entry.id, {
            version: entry.version,
            integrity: entry.integrity,
          });
        }
      }
    }

    for (const resource of resources) {
      const item = await this._reconcileResource(
        resource,
        destination,
        lockfileEntries,
        registryAvailable,
      );
      items.push(item);
    }

    const lockfileResourceIds = new Set(lockfileEntries.keys());
    const installedIds = new Set(resources.map((r) => r.id));
    for (const lockId of lockfileResourceIds) {
      if (!installedIds.has(lockId)) {
        items.push({
          resourceId: lockId,
          currentState: "unknown",
          detectedState: "missing",
          action: "reinstall",
          reason: "Resource in lockfile but not in installed state",
          details: this._emptyDetails(),
        });
      }
    }

    const healthy = items
      .filter((i) => i.detectedState === "installed")
      .map((i) => i.resourceId);
    const modified = items
      .filter((i) => i.detectedState === "modified")
      .map((i) => i.resourceId);
    const missing = items
      .filter((i) => i.detectedState === "missing")
      .map((i) => i.resourceId);
    const corrupted = items
      .filter((i) => i.detectedState === "corrupted")
      .map((i) => i.resourceId);
    const stale = items
      .filter((i) => i.action === "update")
      .map((i) => i.resourceId);
    const unknown = items
      .filter((i) => i.detectedState === "unknown")
      .map((i) => i.resourceId);
    const lockfileMismatches = items
      .filter((i) => i.details.lockfileMismatch)
      .map((i) => i.resourceId);
    const recommendedActions = items.filter(
      (i) => i.action !== "noop" && i.action !== "manual-review",
    );

    return {
      timestamp: new Date().toISOString(),
      resources: items,
      healthy,
      modified,
      missing,
      corrupted,
      stale,
      unknown,
      lockfileMismatches,
      recommendedActions,
      offlineCapable: true,
      registryAvailable,
    };
  }

  async reconcileResource(
    resourceId: string,
    destination: string,
  ): Promise<ReconciliationItem | null> {
    const resource = await this._installedState.getResource(resourceId);
    if (resource === null) return null;

    const lockfileEntries = new Map<
      string,
      { version: string; integrity: string }
    >();
    if (this._lockFileService !== null) {
      const lockfile = await this._lockFileService.read(destination);
      if (lockfile !== null) {
        for (const entry of lockfile.resources) {
          lockfileEntries.set(entry.id, {
            version: entry.version,
            integrity: entry.integrity,
          });
        }
      }
    }

    return this._reconcileResource(
      resource,
      destination,
      lockfileEntries,
      false,
    );
  }

  private async _reconcileResource(
    resource: InstalledResource,
    destination: string,
    lockfileEntries: Map<string, { version: string; integrity: string }>,
    _registryAvailable: boolean,
  ): Promise<ReconciliationItem> {
    const missingFiles: Array<string> = [];
    const modifiedFiles: Array<string> = [];
    const corruptedFiles: Array<string> = [];

    for (const managed of resource.managedFiles) {
      const fullPath = join(destination, resource.id, managed.relativePath);
      try {
        await stat(fullPath);
        const content = await readFile(fullPath, "utf-8");
        const currentSha = sha256(content);
        if (currentSha !== managed.expectedSha) {
          if (currentSha === managed.sha) {
            modifiedFiles.push(managed.relativePath);
          } else {
            corruptedFiles.push(managed.relativePath);
          }
        }
      } catch {
        missingFiles.push(managed.relativePath);
      }
    }

    const lockEntry = lockfileEntries.get(resource.id);
    const lockfileMismatch =
      lockEntry !== undefined &&
      (lockEntry.version !== resource.version ||
        lockEntry.integrity !== resource.integrity);

    const registryRevisionMismatch = false;

    const details: ReconciliationDetails = {
      missingFiles,
      modifiedFiles,
      corruptedFiles,
      lockfileMismatch,
      registryRevisionMismatch,
      versionMismatch: false,
    };

    let detectedState: InstallationState;
    let action: ReconciliationAction;
    let reason: string;

    if (corruptedFiles.length > 0) {
      detectedState = "corrupted";
      action = "repair";
      reason = `${corruptedFiles.length} file(s) corrupted`;
    } else if (
      missingFiles.length > 0 &&
      missingFiles.length === resource.managedFiles.length
    ) {
      detectedState = "missing";
      action = "reinstall";
      reason = "All managed files missing";
    } else if (missingFiles.length > 0) {
      detectedState = "missing";
      action = "repair";
      reason = `${missingFiles.length} file(s) missing`;
    } else if (modifiedFiles.length > 0) {
      detectedState = "modified";
      action = "manual-review";
      reason = `${modifiedFiles.length} file(s) modified by user`;
    } else if (lockfileMismatch) {
      detectedState = "installed";
      action = "update";
      reason = "Lockfile version/integrity mismatch";
    } else {
      detectedState = "installed";
      action = "noop";
      reason = "All files match expected state";
    }

    return {
      resourceId: resource.id,
      currentState: resource.state,
      detectedState,
      action,
      reason,
      details,
    };
  }

  private _emptyDetails(): ReconciliationDetails {
    return {
      missingFiles: [],
      modifiedFiles: [],
      corruptedFiles: [],
      lockfileMismatch: false,
      registryRevisionMismatch: false,
      versionMismatch: false,
    };
  }
}

export function createReconciliationEngine(
  deps: ReconciliationEngineDeps,
  logger?: Logger,
): ReconciliationEngine {
  return new ReconciliationEngine(deps, logger);
}
