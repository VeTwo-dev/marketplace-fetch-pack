import { access, readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import type {
  DoctorCheck,
  DoctorResult,
  DoctorReport,
  DoctorRepairAction,
  DoctorRepairResult,
} from "../types/doctor.js";
import type { DiagnosticSeverity } from "../diagnostics/collector.js";
import type { ResolvedConfig } from "../types/config.js";
import type { InstalledStateManager } from "../installed-state/index.js";
import type { TransactionManager } from "../transaction/index.js";
import type { ResourceTypeRegistry } from "../resource-types/index.js";
import type { MarketplaceStateManager } from "../state/index.js";
import type { CacheManager } from "../cache/CacheManager.js";
import { getHealth } from "../health/index.js";
import { Cache } from "../cache/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { resolveStatePaths, resolveStateRoot } from "../state/index.js";
import { OFFICIAL_MARKETPLACE_REPOSITORY } from "../constants.js";

export interface DoctorDeps {
  readonly projectRoot?: string;
  readonly installedState?: InstalledStateManager;
  readonly transactionManager?: TransactionManager;
  readonly typeRegistry?: ResourceTypeRegistry;
  readonly stateManager?: MarketplaceStateManager;
  readonly cacheManager?: CacheManager;
  /** Zero-network local registry availability probe (never fetched live). */
  readonly registryProbe?: () => Promise<boolean>;
}

export class Doctor {
  private readonly _config: ResolvedConfig;
  private readonly _cache: Cache;
  private readonly _logger: Logger;
  private _deps: DoctorDeps;

  constructor(
    config: ResolvedConfig,
    cache: Cache,
    logger?: Logger,
    deps?: DoctorDeps,
  ) {
    this._config = config;
    this._cache = cache;
    this._logger = logger ?? createLogger({ prefix: "doctor" });
    this._deps = deps ?? {};
  }

  /** Refresh runtime wiring (managers are rebuilt on every marketplace load). */
  updateDeps(deps: Partial<DoctorDeps>): void {
    this._deps = { ...this._deps, ...deps };
  }

  async run(): Promise<DoctorReport> {
    const startTime = Date.now();
    const checks: Array<DoctorCheck> = [];

    // Independent checks: one failure never prevents unrelated checks.
    const tasks: Array<Promise<DoctorCheck | null>> = [
      this._guard("node-version", () => this._checkNodeVersion()),
      this._guard("internet", () =>
        this._config.offline
          ? Promise.resolve(
              this._skip("Internet", "internet", "Skipped (offline mode)"),
            )
          : this._checkInternet(),
      ),
      this._guard("github", () =>
        this._config.offline
          ? Promise.resolve(
              this._skip("GitHub", "github", "Skipped (offline mode)"),
            )
          : this._checkGitHub(),
      ),
      this._guard("permissions", () => this._checkPermissions()),
      this._guard("cache", () => this._checkCache()),
      this._guard("registry", () =>
        this._config.offline
          ? Promise.resolve(
              this._skip("Registry", "registry", "Skipped (offline mode)"),
            )
          : this._checkRegistry(),
      ),
      this._guard("configuration", () => this._checkConfiguration()),
      this._guard("state-directory", () => this._checkStateDirectory()),
      this._guard("lockfile", () => this._checkLockfile()),
      this._guard("stale-locks", () => this._checkStaleLocks()),
      this._guard("transactions", () => this._checkTransactions()),
      this._guard("health", () => this._checkHealth()),
      this._guard("disk-space", () => this._checkDiskSpace()),
      this._guard("installed-state", () => this._checkInstalledState()),
      this._guard("resource-types", () => this._checkResourceTypes()),
    ];

    const results = await Promise.all(tasks);
    for (const check of results) {
      if (check !== null) checks.push(check);
    }

    checks.sort((a, b) => a.code.localeCompare(b.code));

    const duration = Date.now() - startTime;
    const passed = checks.filter((c) => c.status === "pass").length;
    const warned = checks.filter((c) => c.status === "warn").length;
    const failed = checks.filter((c) => c.status === "fail").length;
    const skipped = checks.filter((c) => c.status === "skip").length;

    const result: DoctorResult = {
      checks,
      passed,
      warned,
      failed,
      skipped,
      duration,
    };

    return {
      result,
      healthy: failed === 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Executes a safe repair action on explicit request.
   * Dangerous operations (deleting resources/cache content) are NOT automatic.
   */
  async repair(action: DoctorRepairAction): Promise<DoctorRepairResult> {
    const paths = resolveStatePaths(
      resolveStateRoot(this._deps.projectRoot ?? process.cwd()),
    );

    switch (action) {
      case "remove-stale-locks": {
        let removed = 0;
        try {
          const lockDirs = [paths.locks, paths.cache];
          const cutoff = Date.now() - 10 * 60 * 1000; // 10 min stale threshold
          for (const dir of lockDirs) {
            const files = await this._safeReaddir(dir);
            for (const file of files) {
              if (!file.endsWith(".lock")) continue;
              const full = join(dir, file);
              try {
                const info = await stat(full);
                if (info.mtimeMs < cutoff) {
                  const { rm } = await import("node:fs/promises");
                  await rm(full, { force: true });
                  removed++;
                }
              } catch {
                // unreadable lock — leave it alone
              }
            }
          }
        } catch {
          // ignore
        }
        return {
          action,
          performed: removed > 0,
          itemsAffected: removed,
          message: `Removed ${removed} stale lock(s)`,
        };
      }

      case "clean-temp-files": {
        let removed = 0;
        try {
          const entries = await this._safeReaddir(paths.tmp);
          for (const entry of entries) {
            try {
              const full = join(paths.tmp, entry);
              const info = await stat(full);
              // Only remove temp artifacts older than 1 hour
              if (Date.now() - info.mtimeMs > 60 * 60 * 1000) {
                const { rm } = await import("node:fs/promises");
                await rm(full, { recursive: true, force: true });
                removed++;
              }
            } catch {
              // ignore individual failures
            }
          }
        } catch {
          // ignore
        }
        return {
          action,
          performed: removed > 0,
          itemsAffected: removed,
          message: `Removed ${removed} abandoned temporary item(s)`,
        };
      }

      case "rebuild-registry-index": {
        try {
          const indexPath = join(paths.indexes, "registry-index.json");
          const { rm } = await import("node:fs/promises");
          await rm(indexPath, { force: true });
          return {
            action,
            performed: true,
            itemsAffected: 1,
            message:
              "Registry index invalidated; it will be rebuilt on next load",
          };
        } catch {
          return {
            action,
            performed: false,
            itemsAffected: 0,
            message: "Could not invalidate registry index",
          };
        }
      }

      case "clean-incomplete-downloads": {
        let removed = 0;
        try {
          const downloadTmp = join(paths.tmp, "downloads");
          const entries = await this._safeReaddir(downloadTmp);
          for (const entry of entries) {
            try {
              const { rm } = await import("node:fs/promises");
              await rm(join(downloadTmp, entry), {
                recursive: true,
                force: true,
              });
              removed++;
            } catch {
              // ignore
            }
          }
        } catch {
          // directory absent → nothing incomplete
        }
        return {
          action,
          performed: removed > 0,
          itemsAffected: removed,
          message: `Removed ${removed} incomplete download(s)`,
        };
      }
    }
  }

  // ─── guards ─────────────────────────────────────────────────────────

  private async _guard(
    code: string,
    fn: () => Promise<DoctorCheck>,
  ): Promise<DoctorCheck | null> {
    try {
      return await fn();
    } catch (error) {
      return this._makeCheck(
        code,
        code,
        "fail",
        "error",
        `Check crashed: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
    }
  }

  // ─── existing checks (extended model) ───────────────────────────────

  private async _checkNodeVersion(): Promise<DoctorCheck> {
    const startTime = Date.now();
    const version = process.version;
    const major = parseInt(version.replace("v", "").split(".")[0] ?? "0", 10);

    if (major >= 20) {
      return this._pass(
        "Node Version",
        "node-version",
        `Node.js ${version} is supported`,
        Date.now() - startTime,
      );
    }
    return this._fail(
      "Node Version",
      "node-version",
      `Node.js ${version} is below the minimum requirement (>=20)`,
      "Update Node.js to version 20 or later",
      Date.now() - startTime,
    );
  }

  private async _checkInternet(): Promise<DoctorCheck> {
    const startTime = Date.now();
    try {
      const response = await fetch("https://api.github.com", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok || response.status === 403 || response.status === 404) {
        return this._pass(
          "Internet",
          "internet",
          "Internet connection is available",
          Date.now() - startTime,
        );
      }
      return this._warn(
        "Internet",
        "internet",
        `Internet check returned status ${response.status}`,
        Date.now() - startTime,
      );
    } catch {
      return this._fail(
        "Internet",
        "internet",
        "No internet connection detected",
        "Check your network connection",
        Date.now() - startTime,
      );
    }
  }

  private async _checkGitHub(): Promise<DoctorCheck> {
    const startTime = Date.now();
    try {
      const url = `https://api.github.com/repos/${this._getRepoPath()}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "@vetwo/marketplace",
      };
      // Token used for the request but NEVER recorded in results.
      const token = process.env["GITHUB_TOKEN"];
      if (token !== undefined && token !== "") {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return this._pass(
          "GitHub",
          "github",
          "Marketplace repository is accessible",
          Date.now() - startTime,
        );
      }
      if (response.status === 403) {
        return this._warn(
          "GitHub",
          "github",
          "GitHub API rate limit may be reached",
          Date.now() - startTime,
        );
      }
      return this._fail(
        "GitHub",
        "github",
        `GitHub API returned status ${response.status}`,
        "Verify the repository URL is correct",
        Date.now() - startTime,
      );
    } catch {
      return this._fail(
        "GitHub",
        "github",
        "Cannot reach GitHub API",
        "Check your network connection and GitHub status",
        Date.now() - startTime,
      );
    }
  }

  private async _checkPermissions(): Promise<DoctorCheck> {
    const startTime = Date.now();

    try {
      const destDir = join(process.cwd(), this._config.destination);
      await access(destDir);
      return this._pass(
        "Permissions",
        "permissions",
        `Destination directory is writable: ${destDir}`,
        Date.now() - startTime,
      );
    } catch {
      try {
        const { mkdir } = await import("node:fs/promises");
        const destDir = join(process.cwd(), this._config.destination);
        await mkdir(destDir, { recursive: true });
        return this._pass(
          "Permissions",
          "permissions",
          `Created destination directory: ${destDir}`,
          Date.now() - startTime,
        );
      } catch {
        return this._fail(
          "Permissions",
          "permissions",
          "Cannot create or access the destination directory",
          "Check file system permissions",
          Date.now() - startTime,
        );
      }
    }
  }

  private async _checkCache(): Promise<DoctorCheck> {
    const startTime = Date.now();
    try {
      const stats = await this._cache.stats();
      return this._pass(
        "Cache",
        "cache",
        `${stats.entries} entries`,
        Date.now() - startTime,
        { ...stats },
      );
    } catch {
      return this._warn(
        "Cache",
        "cache",
        "Cache not initialized",
        Date.now() - startTime,
      );
    }
  }

  private async _checkRegistry(): Promise<DoctorCheck> {
    const startTime = Date.now();
    try {
      const { GitHubRepositoryTransport } =
        await import("../transport/github-repository.js");
      const repos = new GitHubRepositoryTransport({
        repository: this._config.repository,
        branch: this._config.branch,
        timeout: this._config.timeout,
        token: this._config.token,
      });
      await repos.readText("registry.json");
      return this._pass(
        "Registry",
        "registry",
        "registry.json is accessible",
        Date.now() - startTime,
      );
    } catch {
      return this._warn(
        "Registry",
        "registry",
        "registry.json not found, will use manifest scanning",
        Date.now() - startTime,
        undefined,
        true,
      );
    }
  }

  private async _checkConfiguration(): Promise<DoctorCheck> {
    const startTime = Date.now();

    const configFiles = [
      "marketplace.config.ts",
      "marketplace.config.js",
      "marketplace.config.json",
    ];

    for (const file of configFiles) {
      try {
        await access(join(process.cwd(), file));
        return this._pass(
          "Configuration",
          "configuration",
          `Found configuration: ${file}`,
          Date.now() - startTime,
        );
      } catch {
        continue;
      }
    }

    return this._pass(
      "Configuration",
      "configuration",
      "Using default configuration",
      Date.now() - startTime,
    );
  }

  // ─── new Phase 15 checks ────────────────────────────────────────────

  private async _checkStateDirectory(): Promise<DoctorCheck> {
    const startTime = Date.now();
    const paths = resolveStatePaths(
      resolveStateRoot(this._deps.projectRoot ?? process.cwd()),
    );
    try {
      await access(paths.root);
      return this._pass(
        "State Directory",
        "state-directory",
        `.vetwo/marketplace exists at ${paths.root}`,
        Date.now() - startTime,
        { root: paths.root },
      );
    } catch {
      return this._pass(
        "State Directory",
        "state-directory",
        "State directory not yet created (created on first use)",
        Date.now() - startTime,
      );
    }
  }

  private async _checkLockfile(): Promise<DoctorCheck> {
    const startTime = Date.now();
    const lockPath = join(
      this._deps.projectRoot ?? process.cwd(),
      this._config.destination,
      "vetwo.lock.json",
    );
    try {
      const raw = await readFile(lockPath, "utf-8");
      try {
        const parsed = JSON.parse(raw) as { resources?: unknown[] };
        const count = Array.isArray(parsed.resources)
          ? parsed.resources.length
          : 0;
        return this._pass(
          "Lockfile",
          "lockfile",
          `Valid lockfile (${count} entries)`,
          Date.now() - startTime,
          { entries: count },
        );
      } catch {
        return this._fail(
          "Lockfile",
          "lockfile",
          "Lockfile contains invalid JSON",
          "Run repair or reinstall affected resources",
          Date.now() - startTime,
          undefined,
          true,
        );
      }
    } catch {
      return this._pass(
        "Lockfile",
        "lockfile",
        "No lockfile present (nothing installed)",
        Date.now() - startTime,
      );
    }
  }

  private async _checkStaleLocks(): Promise<DoctorCheck> {
    const startTime = Date.now();
    const paths = resolveStatePaths(
      resolveStateRoot(this._deps.projectRoot ?? process.cwd()),
    );
    const cutoff = Date.now() - 10 * 60 * 1000;
    let stale = 0;

    for (const dir of [paths.locks, paths.cache]) {
      const files = await this._safeReaddir(dir);
      for (const file of files) {
        if (!file.endsWith(".lock")) continue;
        try {
          const info = await stat(join(dir, file));
          if (info.mtimeMs < cutoff) stale++;
        } catch {
          // ignore
        }
      }
    }

    if (stale === 0) {
      return this._pass(
        "Stale Locks",
        "stale-locks",
        "No stale locks detected",
        Date.now() - startTime,
      );
    }
    return this._warn(
      "Stale Locks",
      "stale-locks",
      `${stale} stale lock(s) found (older than 10 min)`,
      Date.now() - startTime,
      { stale },
      true,
    );
  }

  private async _checkTransactions(): Promise<DoctorCheck> {
    const startTime = Date.now();
    if (this._deps.transactionManager === undefined) {
      return this._skip("Transactions", "transactions");
    }
    try {
      const active =
        await this._deps.transactionManager.getActiveTransactions();
      const diag = await this._deps.transactionManager
        .diagnostics()
        .catch(() => ({
          active: active.length,
          recoveryRequired: 0,
          stale: 0,
        }));
      const recovery = diag.recoveryRequired;
      const stale = (diag as unknown as { stale?: number }).stale ?? 0;
      const incomplete = active.filter(
        (t) =>
          (t.status as string) === "preparing" ||
          (t.status as string) === "writing" ||
          (t.status as string) === "recovery-required" ||
          (t.status as string) === "executing",
      );
      if (incomplete.length === 0 && recovery === 0) {
        return this._pass(
          "Transactions",
          "transactions",
          "No incomplete transactions",
          Date.now() - startTime,
        );
      }
      const msg =
        recovery > 0
          ? `${recovery} recovery-required, ${incomplete.length} incomplete`
          : `${incomplete.length} interrupted transaction(s) found`;
      return this._warn(
        "Transactions",
        "transactions",
        msg,
        Date.now() - startTime,
        {
          ids: incomplete.map((t) => t.id).slice(0, 5),
          stale,
          recoveryRequired: recovery,
          active: active.length,
        },
        true,
      );
    } catch {
      return this._skip("Transactions", "transactions");
    }
  }

  /**
   * Aggregate runtime health (state, cache, transactions, local registry).
   * Explicit and lazy: runs only inside `doctor run`, never at startup, and
   * the registry signal comes from a zero-network local probe.
   */
  private async _checkHealth(): Promise<DoctorCheck> {
    const startTime = Date.now();
    const hasInputs =
      this._deps.stateManager !== undefined ||
      this._deps.cacheManager !== undefined ||
      this._deps.transactionManager !== undefined;
    if (!hasInputs) {
      return this._skip("Health", "health", "No runtime managers wired");
    }
    const health = await getHealth(
      this._deps.stateManager ?? null,
      this._deps.cacheManager ?? null,
      this._deps.transactionManager ?? null,
      this._config.offline,
      this._deps.registryProbe,
    );
    const problems: Array<string> = [];
    if (!health.stateHealthy) problems.push("state unhealthy");
    if (!health.cacheHealthy) problems.push("cache disabled");
    if (!health.transactionHealthy) problems.push("transactions need recovery");
    if (!health.registryAvailable) problems.push("no local registry");
    if (problems.length === 0) {
      return this._pass(
        "Health",
        "health",
        `runtime healthy${health.offline ? " (offline)" : ""}`,
        Date.now() - startTime,
        { ...health.details },
      );
    }
    return this._warn(
      "Health",
      "health",
      problems.join("; "),
      Date.now() - startTime,
      { ...health.details },
    );
  }

  private async _checkDiskSpace(): Promise<DoctorCheck> {
    const startTime = Date.now();
    try {
      const stats = await stat(this._deps.projectRoot ?? process.cwd());
      void stats;
      // Node has no portable free-space API; verify writability as proxy
      const testFile = join(
        this._deps.projectRoot ?? process.cwd(),
        ".vetwo",
        ".doctor-write-test",
      );
      try {
        const { writeFile, rm } = await import("node:fs/promises");
        await mkdirRecursive(
          join(this._deps.projectRoot ?? process.cwd(), ".vetwo"),
        );
        await writeFile(testFile, "probe");
        await rm(testFile, { force: true });
      } catch {
        return this._warn(
          "Disk Availability",
          "disk-space",
          "State root not writable",
          Date.now() - startTime,
        );
      }
      return this._pass(
        "Disk Availability",
        "disk-space",
        "State root is writable",
        Date.now() - startTime,
        { platform: os.platform(), arch: os.arch() },
      );
    } catch {
      return this._warn(
        "Disk Availability",
        "disk-space",
        "Could not evaluate disk availability",
        Date.now() - startTime,
      );
    }
  }

  private async _checkInstalledState(): Promise<DoctorCheck> {
    const startTime = Date.now();
    if (this._deps.installedState === undefined) {
      return this._skip("Installed State", "installed-state");
    }
    try {
      const resources = await this._deps.installedState.getAllResources();
      const broken = resources.filter(
        (r) => r.state === "missing" || r.state === "failed",
      );
      if (broken.length === 0) {
        return this._pass(
          "Installed State",
          "installed-state",
          `${resources.length} installed resource(s), all healthy`,
          Date.now() - startTime,
          { count: resources.length },
        );
      }
      return this._warn(
        "Installed State",
        "installed-state",
        `${broken.length} resource(s) in broken state`,
        Date.now() - startTime,
        { broken: broken.map((r) => r.id).slice(0, 5) },
        true,
      );
    } catch {
      return this._skip("Installed State", "installed-state");
    }
  }

  private async _checkResourceTypes(): Promise<DoctorCheck> {
    const startTime = Date.now();
    if (this._deps.typeRegistry === undefined) {
      return this._skip("Resource Types", "resource-types");
    }
    try {
      const all = this._deps.typeRegistry.getAll();
      return this._pass(
        "Resource Types",
        "resource-types",
        `${all.length} resource type(s) registered`,
        Date.now() - startTime,
        {
          builtin: all.filter((r) => r.source === "builtin").length,
          plugin: all.filter((r) => r.source === "plugin").length,
        },
      );
    } catch {
      return this._skip("Resource Types", "resource-types");
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────

  private _makeCheck(
    name: string,
    code: string,
    status: DoctorCheck["status"],
    severity: DiagnosticSeverity,
    message: string,
    duration: number,
    details?: Record<string, unknown>,
    repairable?: boolean,
  ): DoctorCheck {
    return {
      name,
      description: name,
      code,
      status,
      severity,
      message,
      duration,
      ...(details !== undefined ? { details } : {}),
      ...(repairable === true ? { repairable: true } : {}),
    };
  }

  private _pass(
    name: string,
    code: string,
    message: string,
    duration: number,
    details?: Record<string, unknown>,
  ): DoctorCheck {
    return this._makeCheck(
      name,
      code,
      "pass",
      "info",
      message,
      duration,
      details,
    );
  }

  private _warn(
    name: string,
    code: string,
    message: string,
    duration: number,
    details?: Record<string, unknown>,
    repairable?: boolean,
  ): DoctorCheck {
    return this._makeCheck(
      name,
      code,
      "warn",
      "warning",
      message,
      duration,
      details,
      repairable,
    );
  }

  private _fail(
    name: string,
    code: string,
    message: string,
    suggestion: string,
    duration: number,
    details?: Record<string, unknown>,
    repairable?: boolean,
  ): DoctorCheck {
    const check = {
      name,
      description: name,
      code,
      status: "fail" as const,
      severity: "error" as DiagnosticSeverity,
      message,
      suggestion,
      duration,
      ...(details !== undefined ? { details } : {}),
      ...(repairable === true ? { repairable: true } : {}),
    };
    return check;
  }

  private _skip(
    name: string,
    code: string,
    reason = "Not applicable",
  ): DoctorCheck {
    return this._makeCheck(name, code, "skip", "info", reason, 0);
  }

  private async _safeReaddir(dir: string): Promise<Array<string>> {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  private _getRepoPath(): string {
    const repo = this._config.repository;
    const url = repo.replace(/\.git$/, "");
    const parts = url.split("/");
    const owner = parts.at(-2);
    const name = parts.at(-1);
    const fallbackParts = OFFICIAL_MARKETPLACE_REPOSITORY.replace(
      /\.git$/,
      "",
    ).split("/");
    return `${owner ?? fallbackParts.at(-2)}/${name ?? fallbackParts.at(-1)}`;
  }
}

async function mkdirRecursive(dir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
}
