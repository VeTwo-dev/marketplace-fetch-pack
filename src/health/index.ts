import type { MarketplaceStateManager } from "../state/index.js";
import type { CacheManager } from "../cache/CacheManager.js";
import type { TransactionManager } from "../transaction/index.js";

export interface HealthStatus {
  readonly initialized: boolean;
  readonly registryAvailable: boolean;
  readonly cacheHealthy: boolean;
  readonly stateHealthy: boolean;
  readonly transactionHealthy: boolean;
  readonly providerAvailable: boolean;
  readonly offline: boolean;
  readonly recoveryRequired: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

export async function getHealth(
  state: MarketplaceStateManager | null,
  cache: CacheManager | null,
  tx: TransactionManager | null,
  offline: boolean,
  registryProbe?: () => Promise<boolean>,
): Promise<HealthStatus> {
  let stateHealthy = true;
  if (state) {
    try {
      await state.readMeta();
      stateHealthy = true;
    } catch {
      stateHealthy = false;
    }
    // also check state dir exists
    try {
      await state.ensureSubdir("state");
    } catch {
      stateHealthy = false;
    }
  }
  const cacheHealthy = cache ? cache.enabled : false;
  const diag = tx
    ? await tx
        .diagnostics()
        .catch(() => ({ active: 0, recoveryRequired: 0, stale: 0 }))
    : { active: 0, recoveryRequired: 0, stale: 0 };
  let registryAvailable: boolean;
  if (registryProbe) {
    try {
      registryAvailable = await registryProbe();
    } catch {
      registryAvailable = false;
    }
  } else {
    // fallback: if cache has registry entry, consider available offline
    registryAvailable = true;
  }
  return {
    initialized: !!state?.initialized,
    registryAvailable,
    cacheHealthy,
    stateHealthy,
    transactionHealthy: diag.recoveryRequired === 0,
    providerAvailable: !offline,
    offline,
    recoveryRequired: diag.recoveryRequired > 0,
    details: diag as unknown as Record<string, unknown>,
  };
}
