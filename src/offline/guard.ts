import type { OfflinePolicy } from "./policy.js";
import { MarketplaceClientError } from "../errors/index.js";
import type { Logger } from "../logger/index.js";
import { createLogger } from "../logger/index.js";

export class NetworkAccessGuard {
  private readonly _policy: OfflinePolicy;
  private readonly _logger: Logger;

  constructor(policy: OfflinePolicy, logger?: Logger) {
    this._policy = policy;
    this._logger = logger ?? createLogger({ prefix: "network-guard" });
  }

  /** Throws if network access is blocked under current policy */
  ensureNetworkAllowed(operation: string, url?: string): void {
    if (this._policy.isOffline()) {
      this._logger.warn("Network access blocked (offline mode)", {
        operation,
        url,
      });
      throw new MarketplaceClientError("INTERNET_UNAVAILABLE", {
        message: `Network access blocked in offline mode for: ${operation}`,
        context: { operation, url, mode: this._policy.mode },
      });
    }
  }

  /** Wrap a network operation; centralizes check */
  async guard<T>(
    operation: string,
    fn: () => Promise<T>,
    url?: string,
  ): Promise<T> {
    this.ensureNetworkAllowed(operation, url);
    return fn();
  }

  /** Returns whether a network call would be allowed */
  isAllowed(): boolean {
    return this._policy.mayUseNetwork();
  }

  /** Used by transport boundary to enforce offline */
  checkOrThrow(operation: string): void {
    this.ensureNetworkAllowed(operation);
  }
}
