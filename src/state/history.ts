import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { MarketplaceStateManager } from "./index.js";

type OperationKind =
  | "install"
  | "remove"
  | "update"
  | "rollback"
  | "cache-refresh"
  | "registry-sync";

export interface OperationRecord {
  readonly id: string;
  readonly kind: OperationKind;
  readonly resourceId?: string;
  readonly version?: string;
  readonly at: string;
  readonly durationMs?: number;
  readonly success: boolean;
  readonly source?: string;
  readonly error?: string;
}

const HISTORY_FILE = "history.json";
const MAX_RECORDS = 200;

export class OperationHistory {
  private readonly _state: MarketplaceStateManager;

  constructor(state: MarketplaceStateManager) {
    this._state = state;
  }

  private _path(): string {
    return join(this._state.paths.state, HISTORY_FILE);
  }

  async append(record: OperationRecord): Promise<void> {
    const existing = await this.readAll();
    const updated = [...existing, record].slice(-MAX_RECORDS);
    await this._state.writeAtomic(
      this._path(),
      JSON.stringify(updated, null, 2),
    );
  }

  async readAll(): Promise<ReadonlyArray<OperationRecord>> {
    try {
      const raw = await readFile(this._path(), "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Array<OperationRecord>;
      return [];
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    await this._state.writeAtomic(this._path(), JSON.stringify([], null, 2));
  }
}
