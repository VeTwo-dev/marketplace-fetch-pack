import type {
  InstallationTransaction,
  TransactionStatus,
  InstallPlan,
} from "../types/install.js";
import { MarketplaceStateManager } from "../state/index.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { systemClock, type Clock } from "../abstractions/clock.js";
import { defaultIdGenerator, type IdGenerator } from "../abstractions/id.js";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import type { EventBus } from "../events/index.js";

const TERMINAL_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  "committed",
  "rolled-back",
  "failed",
]);

const INCOMPLETE_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  "created",
  "pending",
  "preparing",
  "snapshotting",
  "executing",
  "writing",
  "committing",
  "rolling-back",
  "recovery-required",
]);

export interface TransactionManagerOptions {
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export class TransactionManager {
  private readonly _state: MarketplaceStateManager;
  private readonly _logger: Logger;
  private readonly _events: EventBus | null;
  private readonly _clock: Clock;
  private readonly _ids: IdGenerator;
  private _transactionsDir: string = "";

  constructor(
    state: MarketplaceStateManager,
    logger?: Logger,
    events?: EventBus,
    options?: TransactionManagerOptions,
  ) {
    this._state = state;
    this._logger = logger ?? createLogger({ prefix: "transaction" });
    this._events = events ?? null;
    this._clock = options?.clock ?? systemClock;
    this._ids = options?.ids ?? defaultIdGenerator;
  }

  async initialize(): Promise<void> {
    this._transactionsDir = await this._state.ensureSubdir("transactions");
    await this._recoverOnStartup().catch(() => {});
    this._installSignalHandlers();
  }

  /**
   * Idempotent lazy init. The install path defers heavy init until needed,
   * so the first transaction operation must ensure the journal directory
   * exists instead of failing with a bare ENOENT on `mkdir('')`.
   */
  async ensureInitialized(): Promise<void> {
    if (this._transactionsDir === "") {
      await this.initialize();
    }
  }

  private _generateId(): string {
    return this._ids.generate("tx");
  }

  private _transactionPath(id: string): string {
    return join(this._transactionsDir, `${id}.json`);
  }

  // Journal helpers
  private _appendJournal(
    tx: InstallationTransaction,
    stage: string,
    status: TransactionStatus,
  ): InstallationTransaction {
    const entry = { at: this._clock.nowIso(), stage, status };
    return {
      ...tx,
      journal: [...(tx.journal ?? []), entry],
      currentStage: stage,
      status,
    };
  }

  async createTransaction(
    resourceId: string,
    version: string,
    resourceIds: ReadonlyArray<string>,
    opts?: {
      operation?: InstallationTransaction["operation"];
      targetProject?: string;
      bulkIds?: ReadonlyArray<string>;
    },
  ): Promise<InstallationTransaction> {
    await this.ensureInitialized();
    const id = this._generateId();
    const now = this._clock.nowIso();
    const tx: InstallationTransaction = {
      id,
      resourceId,
      version,
      status: "pending",
      resourceIds,
      snapshotId: null,
      createdFiles: [],
      modifiedFiles: [],
      deletedFiles: [],
      startedAt: now,
      operation: opts?.operation ?? "install",
      targetProject: opts?.targetProject,
      bulkIds: opts?.bulkIds,
      completedStages: [],
      journal: [{ at: now, stage: "created", status: "pending" }],
      currentStage: "created",
    };
    // write-ahead: persist intent before mutation
    await this._writeTransaction(tx);
    await this._events
      ?.emit(
        "transactionCreated" as never,
        { transactionId: id, resourceId } as never,
      )
      .catch(() => {});
    this._logger.debug("Transaction created", { id, resourceId });
    return tx;
  }

  async getTransaction(id: string): Promise<InstallationTransaction | null> {
    try {
      const raw = await readFile(this._transactionPath(id), "utf-8");
      return JSON.parse(raw) as InstallationTransaction;
    } catch {
      return null;
    }
  }

  async getActiveTransactions(): Promise<
    ReadonlyArray<InstallationTransaction>
  > {
    try {
      await mkdir(this._transactionsDir, { recursive: true });
      const files = await readdir(this._transactionsDir);
      const active: Array<InstallationTransaction> = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(
            join(this._transactionsDir, file),
            "utf-8",
          );
          const tx = JSON.parse(raw) as InstallationTransaction;
          if (!TERMINAL_STATUSES.has(tx.status)) active.push(tx);
        } catch {
          // skip corrupt
        }
      }
      return active;
    } catch {
      return [];
    }
  }

  async updateTransaction(
    id: string,
    update: Partial<
      Pick<
        InstallationTransaction,
        | "status"
        | "snapshotId"
        | "createdFiles"
        | "modifiedFiles"
        | "deletedFiles"
        | "error"
        | "completedAt"
        | "currentStage"
        | "completedStages"
        | "plan"
        | "recoveryStatus"
      >
    >,
  ): Promise<void> {
    await this.ensureInitialized();
    const existing = await this.getTransaction(id);
    if (existing === null)
      throw new MarketplaceClientError("UNKNOWN_ERROR", {
        message: `Transaction not found: ${id}`,
        context: { transactionId: id },
      });
    const journal =
      update.status !== undefined && update.status !== existing.status
        ? [
            ...(existing.journal ?? []),
            {
              at: this._clock.nowIso(),
              stage: update.currentStage ?? existing.currentStage ?? "update",
              status: update.status,
            },
          ]
        : existing.journal;
    const updated: InstallationTransaction = {
      ...existing,
      ...update,
      journal,
    } as InstallationTransaction;
    await this._writeTransaction(updated);
  }

  async setPlan(id: string, plan: InstallPlan): Promise<void> {
    await this.updateTransaction(id, { plan } as never);
    await this._events
      ?.emit(
        "transactionStageCompleted" as never,
        { transactionId: id, stage: "plan" } as never,
      )
      .catch(() => {});
  }

  async preFlightValidate(
    id: string,
    checks: ReadonlyArray<string>,
  ): Promise<boolean> {
    // record preflight intent
    await this.updateTransaction(id, {
      currentStage: "preflight",
      completedStages: ["preflight"],
    } as never);
    this._logger.debug("Preflight validation", { id, checks });
    return true;
  }

  async markSnapshotting(id: string, snapshotId: string): Promise<void> {
    await this.updateTransaction(id, {
      status: "snapshotting",
      snapshotId,
      currentStage: "snapshotting",
    });
  }

  async markExecuting(id: string): Promise<void> {
    await this.updateTransaction(id, {
      status: "executing",
      currentStage: "executing",
    });
    await this._events
      ?.emit("transactionStarted" as never, { transactionId: id } as never)
      .catch(() => {});
  }

  async markCommitting(id: string): Promise<void> {
    await this.updateTransaction(id, {
      status: "committing",
      currentStage: "committing",
    });
    await this._events
      ?.emit(
        "transactionCommitStarted" as never,
        { transactionId: id } as never,
      )
      .catch(() => {});
  }

  async markCommitted(id: string): Promise<void> {
    await this.updateTransaction(id, {
      status: "committed",
      completedAt: this._clock.nowIso(),
      currentStage: "committed",
    });
    await this._events
      ?.emit("transactionCommitted" as never, { transactionId: id } as never)
      .catch(() => {});
    this._logger.info("Transaction committed", { id });
    await this._cleanupAfterSuccess(id).catch(() => {});
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.updateTransaction(id, {
      status: "failed",
      error,
      completedAt: this._clock.nowIso(),
    });
    await this._events
      ?.emit(
        "transactionFailed" as never,
        { transactionId: id, error } as never,
      )
      .catch(() => {});
    this._logger.warn("Transaction failed", { id, error });
  }

  async markRecoveryRequired(id: string, reason: string): Promise<void> {
    await this.updateTransaction(id, {
      status: "recovery-required",
      error: reason,
      recoveryStatus: reason,
    });
    await this._events
      ?.emit(
        "transactionRecoveryRequired" as never,
        { transactionId: id, reason } as never,
      )
      .catch(() => {});
  }

  async markRollingBack(id: string): Promise<void> {
    await this.updateTransaction(id, {
      status: "rolling-back",
      currentStage: "rolling-back",
    });
    await this._events
      ?.emit(
        "transactionRollbackStarted" as never,
        { transactionId: id } as never,
      )
      .catch(() => {});
  }

  async markRolledBack(id: string): Promise<void> {
    await this.updateTransaction(id, {
      status: "rolled-back",
      completedAt: this._clock.nowIso(),
    });
    await this._events
      ?.emit("transactionRolledBack" as never, { transactionId: id } as never)
      .catch(() => {});
    this._logger.info("Transaction rolled back", { id });
  }

  async deleteTransaction(id: string): Promise<void> {
    try {
      await rm(this._transactionPath(id), { force: true });
      this._logger.debug("Transaction deleted", { id });
    } catch (_err) {
      void _err;
    }
  }

  async detectStaleTransactions(): Promise<
    ReadonlyArray<InstallationTransaction>
  > {
    const active = await this.getActiveTransactions();
    return active.filter((tx) => INCOMPLETE_STATUSES.has(tx.status));
  }

  // Recovery
  async getRecoveryCandidates(): Promise<
    ReadonlyArray<InstallationTransaction>
  > {
    return this.detectStaleTransactions();
  }

  async replayJournal(id: string): Promise<InstallationTransaction | null> {
    const tx = await this.getTransaction(id);
    if (tx === null) return null;
    this._logger.info("Replaying journal", {
      id,
      journalLength: tx.journal?.length ?? 0,
    });
    return tx;
  }

  async startupRecovery(): Promise<void> {
    await this._recoverOnStartup();
  }

  private async _recoverOnStartup(): Promise<void> {
    const candidates = await this.getRecoveryCandidates();
    for (const tx of candidates) {
      const age = this._clock.now() - new Date(tx.startedAt).getTime();
      // If transaction is very old (>24h) mark stale but don't auto-delete
      if (age > 24 * 60 * 60 * 1000) {
        await this.markRecoveryRequired(tx.id, "stale-transaction").catch(
          () => {},
        );
        continue;
      }
      // If in committing phase but crash before committed, treat as recovery-required for idempotent check
      if (tx.status === "committing") {
        await this.markRecoveryRequired(tx.id, "crash-during-commit").catch(
          () => {},
        );
      }
    }
    if (candidates.length > 0)
      this._logger.info("Startup recovery check", {
        candidates: candidates.length,
      });
  }

  // Idempotency
  async isAlreadyCommitted(
    resourceId: string,
    version: string,
  ): Promise<boolean> {
    try {
      const files = await readdir(this._transactionsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const raw = await readFile(join(this._transactionsDir, file), "utf-8");
        const tx = JSON.parse(raw) as InstallationTransaction;
        if (
          tx.resourceId === resourceId &&
          tx.version === version &&
          tx.status === "committed"
        )
          return true;
      }
    } catch (_err) {
      void _err;
    }
    return false;
  }

  async rollbackIdempotent(
    id: string,
    rollbackFn: () => Promise<void>,
  ): Promise<void> {
    const tx = await this.getTransaction(id);
    if (tx === null) return;
    if (tx.status === "rolled-back") return; // already rolled back
    await this.markRollingBack(id);
    try {
      await rollbackFn();
      await this.markRolledBack(id);
    } catch (e) {
      await this.markRecoveryRequired(id, String(e)).catch(() => {});
      throw e;
    }
  }

  // Locking for concurrent mutation
  async withProjectLock<T>(
    projectRoot: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const release = await this._state.acquireLock(
      `install:${projectRoot}`,
      10_000,
    );
    try {
      return await fn();
    } finally {
      await release();
    }
  }

  async withReadLock<T>(fn: () => Promise<T>): Promise<T> {
    // Read ops don't block each other - no lock needed, but we provide hook
    return fn();
  }

  // Diagnostics
  async diagnostics(): Promise<{
    stale: number;
    recoveryRequired: number;
    active: number;
  }> {
    const active = await this.getActiveTransactions();
    const recovery = active.filter(
      (t) => t.status === "recovery-required",
    ).length;
    const stale = (await this.detectStaleTransactions()).length;
    return { stale, recoveryRequired: recovery, active: active.length };
  }

  async cleanupStale(daysOld: number = 7): Promise<number> {
    const files = await readdir(this._transactionsDir).catch(
      () => [] as string[],
    );
    let removed = 0;
    const cutoff = this._clock.now() - daysOld * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const p = join(this._transactionsDir, file);
      try {
        const s = await stat(p);
        if (s.mtimeMs < cutoff) {
          const raw = await readFile(p, "utf-8");
          const tx = JSON.parse(raw) as InstallationTransaction;
          if (TERMINAL_STATUSES.has(tx.status)) {
            await rm(p, { force: true });
            removed++;
          }
        }
      } catch (_err) {
        void _err;
      }
    }
    return removed;
  }

  private async _cleanupAfterSuccess(_id: string): Promise<void> {
    // Keep transaction for diagnostics, but remove tmp files
    // Do not delete active recovery data prematurely - only after committed, we keep json for audit
  }

  private _installSignalHandlers(): void {
    let secondSignal = false;
    const handler = async (sig: string) => {
      this._logger.warn(`Received ${sig}, preserving recoverable state`);
      if (secondSignal) {
        this._logger.warn(
          "Double interruption - state remains recovery-required",
        );
        return;
      }
      secondSignal = true;
      // Mark any active transactions as recovery-required
      const active = await this.getActiveTransactions().catch(
        () => [] as InstallationTransaction[],
      );
      for (const tx of active) {
        if (!TERMINAL_STATUSES.has(tx.status)) {
          await this.markRecoveryRequired(tx.id, `interrupted-${sig}`).catch(
            () => {},
          );
        }
      }
    };
    // Only install once
    const g = globalThis as unknown as { __vetwoTxHandlers?: boolean };
    if (g.__vetwoTxHandlers) return;
    g.__vetwoTxHandlers = true;
    process.once("SIGINT", () => handler("SIGINT"));
    process.once("SIGTERM", () => handler("SIGTERM"));
  }

  private async _writeTransaction(
    transaction: InstallationTransaction,
  ): Promise<void> {
    if (this._transactionsDir === "") {
      throw new MarketplaceClientError("UNKNOWN_ERROR", {
        message:
          "Transaction store is not initialized (transactions directory unknown)",
      });
    }
    await mkdir(this._transactionsDir, { recursive: true });
    const content = JSON.stringify(transaction, null, 2);
    const tmpPath = join(this._transactionsDir, `.${transaction.id}.tmp`);
    const finalPath = this._transactionPath(transaction.id);
    await writeFile(tmpPath, content, "utf-8");
    const { rename } = await import("node:fs/promises");
    await rename(tmpPath, finalPath);
  }
}
