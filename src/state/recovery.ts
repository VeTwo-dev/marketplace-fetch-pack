import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import type { MarketplaceStateManager } from "./index.js";
import { createLogger, type Logger } from "../logger/index.js";

export class StateRecovery {
  private readonly _state: MarketplaceStateManager;
  private readonly _logger: Logger;

  constructor(state: MarketplaceStateManager, logger?: Logger) {
    this._state = state;
    this._logger = logger ?? createLogger({ prefix: "state-recovery" });
  }

  async detectCorruption(): Promise<boolean> {
    try {
      const metaPath = join(this._state.paths.state, "meta.json");
      const raw = await readFile(metaPath, "utf-8");
      JSON.parse(raw);
      return false;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ENOENT")) return false; // not existent is not corrupt
      this._logger.warn("State corruption detected", { error: msg });
      return true;
    }
  }

  async quarantine(): Promise<void> {
    const metaPath = join(this._state.paths.state, "meta.json");
    const quarantinePath = join(
      this._state.paths.state,
      `meta.corrupt.${Date.now()}.json`,
    );
    try {
      const { rename } = await import("node:fs/promises");
      await rename(metaPath, quarantinePath);
      this._logger.warn("Quarantined corrupt state", { quarantinePath });
    } catch {
      // ignore
    }
  }

  async recover(): Promise<boolean> {
    const isCorrupt = await this.detectCorruption();
    if (!isCorrupt) return true;
    await this.quarantine();
    try {
      await this._state.ensureMeta();
      this._logger.info("State recovered via rebuild");
      return true;
    } catch (e) {
      this._logger.error("State recovery failed", { error: String(e) });
      return false;
    }
  }

  async cleanupObsolete(): Promise<number> {
    // remove .tmp files older than 7 days in state dir, preserve active locks/snapshots
    let removed = 0;
    try {
      const { readdir, stat } = await import("node:fs/promises");
      const files = await readdir(this._state.paths.state);
      const now = Date.now();
      for (const f of files) {
        if (!f.endsWith(".tmp") && !f.startsWith("meta.corrupt")) continue;
        const p = join(this._state.paths.state, f);
        try {
          const s = await stat(p);
          if (now - s.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
            await rm(p, { force: true });
            removed++;
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    return removed;
  }
}
