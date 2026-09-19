import type { ResolvedConfig, NetworkMode } from "../types/config.js";
import { createLogger, type Logger } from "../logger/index.js";

export type OfflineMode = NetworkMode | "auto"; // "online" | "offline" | "auto" | "prefer-offline"
export type ResultSource =
  "network" | "cache" | "stale-cache" | "local-state" | "fallback" | "unknown";

interface OfflinePolicyOptions {
  readonly mode: OfflineMode;
  readonly logger?: Logger;
}

export class OfflinePolicy {
  private _mode: OfflineMode;
  private readonly _logger: Logger;

  constructor(config: ResolvedConfig, logger?: Logger) {
    // Prefer config.networkMode, fallback to legacy offline boolean
    this._mode = config.networkMode ?? (config.offline ? "offline" : "online");
    this._logger = logger ?? createLogger({ prefix: "offline-policy" });
    this._logger.debug("OfflinePolicy initialized", { mode: this._mode });
  }

  get mode(): OfflineMode {
    return this._mode;
  }

  setMode(mode: OfflineMode): void {
    this._mode = mode;
    this._logger.info("Network mode changed", { mode });
  }

  isOnline(): boolean {
    return this._mode === "online";
  }

  isOffline(): boolean {
    return this._mode === "offline";
  }

  isAuto(): boolean {
    return this._mode === "auto" || this._mode === "prefer-offline";
  }

  /** Prefer cache first? (auto & prefer-offline) */
  shouldPreferCache(): boolean {
    return (
      this._mode === "offline" ||
      this._mode === "auto" ||
      this._mode === "prefer-offline"
    );
  }

  /** May attempt network? */
  mayUseNetwork(): boolean {
    return this._mode !== "offline";
  }

  classifySource(from: ResultSource): ResultSource {
    return from;
  }

  /** For logging/metrics */
  describe(): string {
    return `mode=${this._mode}`;
  }
}

function resolveNetworkMode(config: ResolvedConfig): OfflineMode {
  if (config.networkMode !== undefined) return config.networkMode;
  return config.offline ? "offline" : "online";
}
