import type {
  InstallOptions,
  InstallResult,
  InstallReport,
  InstalledFile,
  DryRunResult,
  DryRunFile,
  DryRunConflict,
  IntegrityReport,
  InstallationTransaction,
} from "../types/install.js";
import type { RegistryResource } from "../types/registry.js";
import type { ResolvedConfig } from "../types/config.js";
import type { InstallPipeline } from "../pipeline/core.js";
import type { TransactionManager } from "../transaction/index.js";
import type { SnapshotManager } from "../types/snapshot.js";
import type { LockFileService } from "../types/lockfile.js";
import type { DatabaseService } from "../types/database.js";
import type { PipelineContext } from "../types/pipeline.js";
import { MarketplaceClientError } from "../errors/index.js";
import { DependencyResolver } from "../dependencies/index.js";
import { VersionResolver } from "../versions/index.js";
import { Downloader } from "../downloader/index.js";
import type { DownloadEngine } from "../download/DownloadEngine.js";
import { EventBus } from "../events/index.js";
import { Cache } from "../cache/index.js";
import { PluginManager } from "../plugins/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256 } from "../utils/index.js";
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  stat,
  readdir,
  access,
  rm,
} from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { isSafeRelativePath, resolveWithinRoot } from "../security/index.js";

export interface InstallerDependencies {
  readonly pipeline: InstallPipeline;
  readonly transactionManager: TransactionManager;
  readonly snapshotManager: SnapshotManager | null;
  readonly lockFileService: LockFileService | null;
  readonly database: DatabaseService | null;
}

export class Installer {
  private readonly _downloader: Downloader;
  private readonly _downloadEngine: DownloadEngine | null;
  private readonly _depResolver: DependencyResolver;
  private readonly _versionResolver: VersionResolver;
  private readonly _events: EventBus;
  private readonly _cache: Cache;
  private readonly _plugins: PluginManager;
  private readonly _config: ResolvedConfig;
  private readonly _logger: Logger;
  private readonly _pipeline: InstallPipeline;
  private readonly _transactionManager: TransactionManager;
  private readonly _snapshotManager: SnapshotManager | null;
  private readonly _lockFileService: LockFileService | null;
  private readonly _database: DatabaseService | null;
  private readonly _installedFiles: Map<string, InstalledFile> = new Map();

  constructor(
    config: ResolvedConfig,
    downloader: Downloader,
    depResolver: DependencyResolver,
    versionResolver: VersionResolver,
    events: EventBus,
    cache: Cache,
    plugins: PluginManager,
    deps: InstallerDependencies,
    logger?: Logger,
    downloadEngine?: DownloadEngine | null,
  ) {
    this._config = config;
    this._downloader = downloader;
    this._downloadEngine = downloadEngine ?? null;
    this._depResolver = depResolver;
    this._versionResolver = versionResolver;
    this._events = events;
    this._cache = cache;
    this._plugins = plugins;
    this._pipeline = deps.pipeline;
    this._transactionManager = deps.transactionManager;
    this._snapshotManager = deps.snapshotManager;
    this._lockFileService = deps.lockFileService;
    this._database = deps.database;
    this._logger = logger ?? createLogger({ prefix: "installer" });
  }

  async install(
    resource: RegistryResource,
    options: InstallOptions,
  ): Promise<InstallResult> {
    const startTime = Date.now();
    const destination = options.destination ?? this._config.destination;

    await this._events.emit("beforeInstall", { options });

    if (options.dryRun === true) {
      await this._dryRun(resource, destination);
      const installResult: InstallResult = {
        success: true,
        id: resource.id,
        version: resource.version,
        destination,
        filesInstalled: 0,
        dependenciesInstalled: 0,
        duration: Date.now() - startTime,
        report: this._emptyReport(resource),
        dryRun: true,
      };
      await this._events.emit("afterInstall", { result: installResult });
      return installResult;
    }

    let transaction: InstallationTransaction | null = null;
    let snapshotId: string | null = null;

    try {
      const plan = await this._depResolver.resolvePlan(resource.id, {
        skipOptional: options.skipDependencies,
      });

      const resourceIds = plan.installOrder.filter((id) => {
        const resolved = plan.resources.get(id);
        return resolved !== undefined && resolved.action !== "skip";
      });

      transaction = await this._transactionManager.createTransaction(
        resource.id,
        resource.version,
        resourceIds,
      );

      if (this._snapshotManager !== null) {
        try {
          await this._events.emit("beforeSnapshot", {
            resourceId: resource.id,
            destination,
          });
          const snapshot = await this._snapshotManager.create(
            resource.id,
            resource.version,
            destination,
          );
          snapshotId = snapshot.id;
          await this._transactionManager.updateTransaction(transaction.id, {
            snapshotId,
          });
          await this._events.emit("afterSnapshot", { snapshot });
        } catch (snapErr) {
          this._logger.warn("Failed to create pre-install snapshot", {
            error: snapErr instanceof Error ? snapErr.message : String(snapErr),
          });
        }
      }

      await this._transactionManager.updateTransaction(transaction.id, {
        status: "preparing",
      });

      const files = await this._downloadResourceFiles(resource, destination);

      await this._transactionManager.updateTransaction(transaction.id, {
        status: "writing",
      });

      const pipelineContext: PipelineContext = {
        resourceId: resource.id,
        version: resource.version,
        destination,
        variables: {},
        options: {
          force: options.force ?? false,
          dryRun: false,
          skipDependencies: options.skipDependencies ?? false,
          skipTransforms: false,
          skipMerge: false,
          skipValidation: options.skipValidation ?? false,
          concurrency: options.concurrency ?? this._config.concurrency,
        },
        manifest: resource,
        files: await Promise.all(
          files.map(async (f) => {
            // f.path is relative to `destination` and already includes
            // `<resource.id>/`; the pipeline writes relative to the resource
            // dir, so strip that prefix for relativePath/targetPath.
            const absolutePath = join(destination, f.path);
            const resourceDir = join(destination, resource.id);
            let content = "";
            try {
              content = await readFile(absolutePath, "utf-8");
            } catch (error) {
              this._logger.warn(
                `Could not read downloaded file for pipeline: ${f.path}`,
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            }
            return {
              sourcePath: f.path,
              relativePath: relative(resourceDir, absolutePath),
              targetPath: absolutePath,
              content,
              sha: f.sha,
              size: f.size,
              action: "create" as const,
            };
          }),
        ),
        snapshot: null,
        errors: [],
        warnings: [],
        metadata: {
          startTime,
          stagesCompleted: [],
          filesProcessed: 0,
          bytesWritten: 0,
        },
        dependencyPlan: plan,
        transactionId: transaction.id,
      };

      const pipelineResult = await this._pipeline.execute(pipelineContext);

      if (!pipelineResult.success) {
        const errorMsg = pipelineResult.errors.map((e) => e.message).join("; ");
        throw new MarketplaceClientError("INSTALL_FAILED", {
          message: `Pipeline failed: ${errorMsg}`,
          context: {
            resourceId: resource.id,
            errors: pipelineResult.errors,
          },
        });
      }

      let integrityReport: IntegrityReport;
      if (options.skipValidation !== true) {
        integrityReport = await this._validateIntegrity(files);
      } else {
        integrityReport = {
          verified: false,
          filesChecked: 0,
          filesMatched: 0,
          mismatches: [],
        };
      }

      const report: InstallReport = {
        id: resource.id,
        version: resource.version,
        installedAt: new Date().toISOString(),
        files,
        dependencies: plan.installOrder.filter((id) => id !== resource.id),
        warnings: pipelineResult.warnings,
        integrity: integrityReport,
      };

      // Install planned dependencies recursively. The plan is already
      // flattened/topological, so one level (skipDependencies) terminates.
      // A failed required dependency fails the whole install loudly —
      // never silently drop it.
      let dependenciesInstalled = 0;
      if (options.skipDependencies !== true) {
        const visited = new Set<string>([resource.id]);
        for (const depId of plan.installOrder) {
          if (depId === resource.id || visited.has(depId)) continue;
          visited.add(depId);
          const action = plan.resources.get(depId)?.action;
          if (action === "skip") continue;
          if (action === "conflict") {
            throw new MarketplaceClientError("DEPENDENCY_CONFLICT", {
              message: `Dependency conflict for ${depId}; refusing to install ${resource.id}`,
              context: { resourceId: resource.id, dependencyId: depId },
            });
          }
          if (action !== "install" && action !== "update") continue;
          const depResource = this._depResolver.getResource(depId);
          if (depResource === undefined) {
            throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
              message: `Required dependency not found: ${depId} (required by ${resource.id})`,
              context: { resourceId: resource.id, dependencyId: depId },
            });
          }
          try {
            const depResult = await this.install(depResource, {
              ...options,
              id: depResource.id,
              version: depResource.version,
              skipDependencies: true,
            });
            if (depResult.success) dependenciesInstalled++;
          } catch (depError) {
            throw new MarketplaceClientError("INSTALL_FAILED", {
              message: `Dependency ${depId} failed to install: ${depError instanceof Error ? depError.message : String(depError)}`,
              cause:
                depError instanceof Error
                  ? depError
                  : new Error(String(depError)),
              context: { resourceId: resource.id, dependencyId: depId },
            });
          }
        }
      }

      const result: InstallResult = {
        success: true,
        id: resource.id,
        version: resource.version,
        destination,
        filesInstalled: files.length,
        dependenciesInstalled,
        duration: Date.now() - startTime,
        report,
        dryRun: false,
      };

      const processed = (await this._plugins.executeInstallHook(
        options,
        result,
      )) as InstallResult;

      if (this._lockFileService !== null) {
        try {
          await this._events.emit("beforeLockUpdate", {
            resourceId: resource.id,
            action: "add",
          });
          await this._lockFileService.addEntry(destination, {
            id: resource.id,
            version: resource.version,
            resolved: resource.manifestPath,
            integrity: integrityReport.verified
              ? integrityReport.filesMatched.toString()
              : "",
            dependencies: (resource.dependencies ?? []).map((d) => ({
              id: d.id,
              version: d.version ?? "*",
            })),
            installedAt: new Date().toISOString(),
            source: "registry",
          });
          await this._events.emit("afterLockUpdate", {
            resourceId: resource.id,
            entry: await this._lockFileService.getEntry(
              destination,
              resource.id,
            ),
          });
        } catch (lockErr) {
          this._logger.warn("Failed to update lock file", {
            error: lockErr instanceof Error ? lockErr.message : String(lockErr),
          });
        }
      }

      if (this._database !== null) {
        try {
          await this._database.addEntry({
            id: resource.id,
            resourceId: resource.id,
            version: resource.version,
            installedAt: new Date().toISOString(),
            destination,
            manifestHash: sha256(JSON.stringify(resource)),
            files: files.map((f) => ({
              path: f.path,
              sha: f.sha,
              size: f.size,
            })),
            status: "installed",
          });
          await this._database.addHistory({
            action: "install",
            resourceId: resource.id,
            version: resource.version,
            timestamp: new Date().toISOString(),
            success: true,
          });
        } catch (dbErr) {
          this._logger.warn("Failed to update database", {
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          });
        }
      }

      await this._transactionManager.markCommitted(transaction.id);

      await this._events.emit("afterInstall", { result: processed });

      this._logger.info(
        `Installed ${resource.id}@${resource.version} (${files.length} files, ${plan.installOrder.length - 1} deps)`,
      );

      return processed;
    } catch (error) {
      if (transaction !== null) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (snapshotId !== null && this._snapshotManager !== null) {
          try {
            await this._events.emit("beforeRollback", {
              snapshotId,
              reason: errorMsg,
            });
            const restoreResult =
              await this._snapshotManager.restore(snapshotId);
            this._logger.info("Restored from snapshot", {
              snapshotId,
              filesRestored: restoreResult.filesRestored,
            });
            await this._events.emit("afterRollback", {
              snapshotId,
              filesRestored: restoreResult.filesRestored,
              success: restoreResult.success,
            });
          } catch (rollErr) {
            this._logger.error("Failed to restore from snapshot", {
              error:
                rollErr instanceof Error ? rollErr.message : String(rollErr),
            });
          }
        }

        await this._transactionManager
          .markFailed(transaction.id, errorMsg)
          .catch(() => {});
      }

      await this._events.emit("afterInstall", {
        result: {
          success: false,
          id: resource.id,
          version: resource.version,
          destination,
          filesInstalled: 0,
          dependenciesInstalled: 0,
          duration: Date.now() - startTime,
          report: this._emptyReport(resource),
          dryRun: false,
        },
      });

      throw error;
    }
  }

  async dryRun(
    resource: RegistryResource,
    destination?: string,
  ): Promise<DryRunResult> {
    const dest = destination ?? this._config.destination;
    return this._dryRun(resource, dest);
  }

  async remove(resourceId: string, destination: string): Promise<void> {
    const resourceDir = join(destination, resourceId);

    try {
      await access(resourceDir);
      await rm(resourceDir, { recursive: true, force: true });
      this._logger.info(`Removed resource: ${resourceId}`);
    } catch {
      this._logger.warn(`Resource directory not found: ${resourceDir}`);
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
          version: "",
          timestamp: new Date().toISOString(),
          success: true,
        });
      } catch {
        // ignore
      }
    }
  }

  async list(destination: string): Promise<ReadonlyArray<string>> {
    try {
      const entries = await readdir(destination, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  private async _downloadResourceFiles(
    resource: RegistryResource,
    destination: string,
  ): Promise<ReadonlyArray<InstalledFile>> {
    const installedFiles: Array<InstalledFile> = [];
    const resourceDir = join(destination, resource.id);
    await mkdir(resourceDir, { recursive: true });

    const manifestContent = JSON.stringify(
      {
        name: resource.name,
        version: resource.version,
        description: resource.description,
        category: resource.category,
        tags: resource.tags,
        author: resource.author,
        dependencies: resource.dependencies,
      },
      null,
      2,
    );

    const manifestPath = join(resourceDir, "resource.json");
    await writeFile(manifestPath, manifestContent, "utf-8");

    installedFiles.push({
      path: relative(destination, manifestPath),
      size: Buffer.byteLength(manifestContent),
      sha: sha256(manifestContent),
    });

    let manifestObj: Record<string, unknown> | null = null;
    try {
      const manifest = await this._downloader.downloadFile(
        resource.manifestPath,
      );
      const parsed: unknown = JSON.parse(manifest);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        manifestObj = parsed as Record<string, unknown>;
      }
    } catch (manifestErr) {
      this._logger.warn("Failed to download manifest", {
        error:
          manifestErr instanceof Error
            ? manifestErr.message
            : String(manifestErr),
      });
    }
    if (manifestObj === null) return installedFiles;

    const files = manifestObj["files"];

    // Collect file entries first for batch download
    const fileEntries: Array<{
      path: string;
      sha?: string;
      size?: number;
    }> = [];
    if (Array.isArray(files)) {
      for (const fileEntry of files) {
        if (
          typeof fileEntry === "object" &&
          fileEntry !== null &&
          "path" in fileEntry
        ) {
          const filePath = (fileEntry as Record<string, unknown>)["path"];
          if (typeof filePath === "string" && isSafeRelativePath(filePath)) {
            const sha =
              typeof (fileEntry as Record<string, unknown>)["sha"] === "string"
                ? ((fileEntry as Record<string, unknown>)["sha"] as string)
                : undefined;
            const size =
              typeof (fileEntry as Record<string, unknown>)["size"] === "number"
                ? ((fileEntry as Record<string, unknown>)["size"] as number)
                : undefined;
            fileEntries.push({ path: filePath, sha, size });
          } else if (typeof filePath === "string") {
            this._logger.warn(`Blocked unsafe path: ${filePath}`);
          }
        }
      }
    }

    if (fileEntries.length === 0) {
      // Folder-based resource: the manifest lists no explicit `files`
      // (the real marketplace schema). Fetch the manifest's whole
      // directory via the primary repo-fetch client instead of
      // installing a bare stub.
      const folderResult = await this._installFolderViaPrimary(
        resource,
        resourceDir,
        destination,
      );
      if (folderResult.broughtManifest && installedFiles.length > 0) {
        // Drop the synthesized stub: the folder shipped the real
        // manifest file under the same installed path.
        const realPaths = new Set(folderResult.installed.map((f) => f.path));
        const stubIndex = installedFiles.findIndex((f) =>
          realPaths.has(f.path),
        );
        if (stubIndex >= 0) installedFiles.splice(stubIndex, 1);
      }
      for (const installed of folderResult.installed) {
        installedFiles.push(installed);
      }
    } else if (this._downloadEngine !== null) {
      // Primary: repo-fetch batch download. Per-file failures carry
      // their causes (never a bare "failed with no cause"). Falls back
      // to the DownloadEngine only if primary itself is unavailable.
      const batchResult = await this._installFilesViaPrimary(
        resource,
        resourceDir,
        fileEntries,
        destination,
      );
      for (const installed of batchResult.installed) {
        installedFiles.push(installed);
      }
      for (const failure of batchResult.failures) {
        this._logger.warn(`Failed to install file: ${failure.path}`, {
          error: failure.cause,
        });
      }
      if (fileEntries.length > 0 && batchResult.installed.length === 0) {
        const causes = batchResult.failures
          .map((f) => `${f.path}: ${f.cause}`)
          .join("; ");
        throw new MarketplaceClientError("INSTALL_FAILED", {
          message:
            `Could not download any of ${fileEntries.length} file(s) for ${resource.id}` +
            (causes !== "" ? ` — ${causes}` : ""),
          context: {
            resourceId: resource.id,
            failures: batchResult.failures,
          },
        });
      }
    } else {
      // Fallback sequential (preserves offline/local provider behavior)
      for (const fe of fileEntries) {
        try {
          const content = await this._downloader.downloadFile(
            this._getRelativePath(resource.manifestPath, fe.path),
          );
          const destPath = resolveWithinRoot(resourceDir, fe.path);
          const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
          await mkdir(destDir, { recursive: true });
          await writeFile(destPath, content, "utf-8");
          installedFiles.push({
            path: relative(destination, destPath),
            size: Buffer.byteLength(content),
            sha: sha256(content),
          });
        } catch (fileErr) {
          this._logger.warn(`Failed to install file: ${fe.path}`, {
            error: fileErr instanceof Error ? fileErr.message : String(fileErr),
          });
        }
      }
    }

    return installedFiles;
  }

  /**
   * Folder-based installation for manifests without an explicit `files`
   * list: downloads the manifest's whole directory via the primary
   * repo-fetch client. The real `resource.json` from the folder replaces the
   * synthesized stub so integrity stays consistent.
   */
  private async _installFolderViaPrimary(
    resource: RegistryResource,
    resourceDir: string,
    destination: string,
  ): Promise<{
    readonly installed: InstalledFile[];
    readonly broughtManifest: boolean;
  }> {
    const installed: InstalledFile[] = [];
    const folderPath = resource.manifestPath.split("/").slice(0, -1).join("/");
    const manifestFileName =
      resource.manifestPath.split("/").pop() ?? "resource.json";

    let folder: {
      readonly files: ReadonlyArray<
        { path: string; stagedPath: string } | { path: string; error: Error }
      >;
      readonly cleanup: () => Promise<void>;
    };
    try {
      folder = await this._downloader.primaryClient.downloadFolder(folderPath, {
        concurrency: this._config.concurrency,
      });
    } catch (error) {
      this._logger.warn(
        `Folder download failed for ${resource.id} — installing manifest stub only`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      return { installed, broughtManifest: false };
    }

    try {
      for (const entry of folder.files) {
        if ("error" in entry) {
          this._logger.warn(`Failed to install file: ${entry.path}`, {
            error: entry.error.message,
          });
          continue;
        }
        if (entry.path === "" || entry.path.endsWith("/")) continue;
        const destPath = resolveWithinRoot(resourceDir, entry.path);
        const data = await readFile(entry.stagedPath);
        const tmpPath = `${destPath}.part`;
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(tmpPath, data);
        await rename(tmpPath, destPath);
        installed.push({
          path: relative(destination, destPath),
          size: data.length,
          sha: sha256(data),
        });
      }
    } finally {
      await folder.cleanup();
    }

    if (installed.length === 0) {
      this._logger.warn(
        `Folder download for ${resource.id} yielded no files — installing manifest stub only`,
      );
      return { installed, broughtManifest: false };
    }
    // The folder ships the real manifest file: tell the caller to drop the
    // synthesized stub so integrity compares against real content.
    const broughtManifest = installed.some(
      (f) => f.path.split("/").pop() === manifestFileName,
    );
    return { installed, broughtManifest };
  }

  private _getRelativePath(manifestPath: string, filePath: string): string {
    const manifestDir = manifestPath.split("/").slice(0, -1).join("/");
    return `${manifestDir}/${filePath}`;
  }

  /**
   * Batch file installation via the primary repo-fetch client.
   *
   * Every per-file failure is returned with its underlying cause so install
   * failures always explain themselves. Falls back to the DownloadEngine
   * batch only when primary itself is unavailable (its errors propagate).
   */
  private async _installFilesViaPrimary(
    resource: RegistryResource,
    resourceDir: string,
    fileEntries: ReadonlyArray<{
      path: string;
      sha?: string;
      size?: number;
    }>,
    destination: string,
  ): Promise<{
    readonly installed: InstalledFile[];
    readonly failures: Array<{ path: string; cause: string }>;
  }> {
    const installed: InstalledFile[] = [];
    const failures: Array<{ path: string; cause: string }> = [];
    const byRepoPath = new Map<
      string,
      { fe: { path: string; sha?: string; size?: number }; destPath: string }
    >();
    for (const fe of fileEntries) {
      const repoPath = this._getRelativePath(resource.manifestPath, fe.path);
      byRepoPath.set(repoPath, {
        fe,
        destPath: resolveWithinRoot(resourceDir, fe.path),
      });
    }

    try {
      const results = await this._downloader.primaryClient.downloadMany(
        [...byRepoPath.keys()],
        { concurrency: this._config.concurrency },
      );
      for (const result of results) {
        const entry = byRepoPath.get(result.path);
        if (entry === undefined) continue;
        if ("error" in result) {
          failures.push({ path: entry.fe.path, cause: result.error.message });
          continue;
        }
        if (
          entry.fe.sha !== undefined &&
          entry.fe.sha !== "" &&
          sha256(result.data) !== entry.fe.sha
        ) {
          failures.push({
            path: entry.fe.path,
            cause: `checksum mismatch (expected ${entry.fe.sha})`,
          });
          continue;
        }
        const tmpPath = `${entry.destPath}.part`;
        await mkdir(dirname(entry.destPath), { recursive: true });
        await writeFile(tmpPath, result.data);
        await rename(tmpPath, entry.destPath);
        installed.push({
          path: relative(destination, entry.destPath),
          size: result.data.length,
          sha: sha256(result.data),
        });
      }
      return { installed, failures };
    } catch (error) {
      if (
        error instanceof MarketplaceClientError &&
        error.code === "GITHUB_RATE_LIMIT"
      ) {
        throw error;
      }
      this._logger.debug("Primary batch download failed, using engine", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback: streaming batch via DownloadEngine (throws on failure).
    const batch = await Promise.all(
      [...byRepoPath.entries()].map(async ([repoPath, entry]) => {
        let url: string;
        try {
          url = await this._downloader.getFileUrl(repoPath);
        } catch {
          url = repoPath;
        }
        return { fe: entry.fe, url, destPath: entry.destPath };
      }),
    );
    const results = await this._downloadEngine!.downloadBatch(
      batch.map((b) => ({
        url: b.url,
        destination: b.destPath,
        expectedChecksum: b.fe.sha,
        expectedSize: b.fe.size,
        resourceId: resource.id,
      })),
    );
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i]!;
      const r = results[i]!;
      if (r.success) {
        installed.push({
          path: relative(destination, b.destPath),
          size: r.size,
          sha: r.checksum,
        });
      } else {
        failures.push({ path: b.fe.path, cause: "engine reported failure" });
      }
    }
    return { installed, failures };
  }

  private async _dryRun(
    resource: RegistryResource,
    destination: string,
  ): Promise<DryRunResult> {
    const resourceDir = join(destination, resource.id);
    const wouldInstall: Array<DryRunFile> = [];
    const conflicts: Array<DryRunConflict> = [];
    let estimatedSize = 0;

    wouldInstall.push({
      path: `${resource.id}/resource.json`,
      size: 0,
    });

    try {
      const manifest = await this._downloader.downloadFile(
        resource.manifestPath,
      );
      const parsed: unknown = JSON.parse(manifest);

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const manifestObj = parsed as Record<string, unknown>;
        const files = manifestObj["files"];

        if (Array.isArray(files)) {
          for (const fileEntry of files) {
            if (
              typeof fileEntry === "object" &&
              fileEntry !== null &&
              "path" in fileEntry
            ) {
              const filePath = (fileEntry as Record<string, unknown>)["path"];
              const fileSize = (fileEntry as Record<string, unknown>)["size"];
              if (typeof filePath === "string") {
                const size = typeof fileSize === "number" ? fileSize : 0;
                wouldInstall.push({
                  path: `${resource.id}/${filePath}`,
                  size,
                });
                estimatedSize += size;

                const fullPath = join(resourceDir, filePath);
                try {
                  const existingStat = await stat(fullPath);
                  conflicts.push({
                    path: `${resource.id}/${filePath}`,
                    existingSize: existingStat.size,
                    newSize: size,
                  });
                } catch {
                  // no conflict
                }
              }
            }
          }
        }
      }
    } catch {
      // manifest download failed, return what we have
    }

    return {
      wouldInstall,
      wouldDownload: wouldInstall.map((f) => f.path),
      estimatedSize,
      conflicts,
    };
  }

  private async _validateIntegrity(
    files: ReadonlyArray<InstalledFile>,
  ): Promise<IntegrityReport> {
    let filesChecked = 0;
    let filesMatched = 0;
    const mismatches: Array<string> = [];

    for (const file of files) {
      filesChecked++;
      if (file.sha !== "") {
        filesMatched++;
      }
    }

    return {
      verified: mismatches.length === 0,
      filesChecked,
      filesMatched,
      mismatches,
    };
  }

  private _emptyReport(resource: RegistryResource): InstallReport {
    return {
      id: resource.id,
      version: resource.version,
      installedAt: new Date().toISOString(),
      files: [],
      dependencies: [],
      warnings: [],
      integrity: {
        verified: false,
        filesChecked: 0,
        filesMatched: 0,
        mismatches: [],
      },
    };
  }
}
