import { mkdir, writeFile, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, type Logger } from "../logger/index.js";

/**
 * Namespaced persistent state for plugins.
 *
 * All state lives under <stateDir>/<plugin-id>/state.json — never at the
 * project root. Writes are atomic (tmp + rename).
 */
export class PluginStateStore {
  private readonly _stateDir: string;
  private readonly _logger: Logger;
  private readonly _cache = new Map<string, Record<string, unknown>>();
  private readonly _pending = new Set<Promise<void>>();
  private readonly _chains = new Map<string, Promise<void>>();

  constructor(stateDir: string, logger?: Logger) {
    this._stateDir = stateDir;
    this._logger = logger ?? createLogger({ prefix: "plugin-state" });
  }

  pluginDir(pluginId: string): string {
    // Sanitize plugin id to prevent path traversal (no dots, slashes, etc.)
    const safe = pluginId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this._stateDir, safe);
  }

  load(pluginId: string): Record<string, unknown> {
    const cached = this._cache.get(pluginId);
    if (cached !== undefined) return cached;

    try {
      const content = readFileSyncSafe(this.pluginDir(pluginId));
      if (content === null) {
        this._cache.set(pluginId, {});
        return {};
      }
      const parsed = JSON.parse(content) as Record<string, unknown>;
      this._cache.set(pluginId, parsed);
      return parsed;
    } catch {
      this._cache.set(pluginId, {});
      return {};
    }
  }

  save(pluginId: string, data: Record<string, unknown>): void {
    // Always store the newest snapshot; serialized per-plugin so writes
    // land in call order and the final file reflects every mutation.
    this._cache.set(pluginId, data);
    const prev = this._chains.get(pluginId) ?? Promise.resolve();
    const next = prev
      .then(() => this._doSave(pluginId, this._cache.get(pluginId)!))
      .catch((error: unknown) => {
        this._logger.error(`Failed to save plugin state: ${pluginId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    this._chains.set(pluginId, next);
    this._pending.add(next);
    void next.finally(() => {
      this._pending.delete(next);
    });
  }

  private async _doSave(
    pluginId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const dir = this.pluginDir(pluginId);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, "state.json");
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, filePath);
    this._logger.debug(`Saved plugin state: ${pluginId}`);
  }

  /** Waits for all in-flight state writes to complete. */
  async flush(): Promise<void> {
    await Promise.all(Array.from(this._pending));
  }

  async clear(pluginId: string): Promise<void> {
    this._cache.delete(pluginId);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(this.pluginDir(pluginId), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function readFileSyncSafe(dir: string): string | null {
  try {
    // Synchronous read is acceptable here: small JSON file, called rarely.
    return readFileSync(join(dir, "state.json"), "utf-8");
  } catch {
    return null;
  }
}
