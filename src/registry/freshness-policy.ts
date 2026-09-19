export type FreshnessPolicy =
  "cache-only" | "prefer-cache" | "normal" | "refresh" | "strict";

export interface FreshnessConfig {
  readonly policy: FreshnessPolicy;
  readonly maxStaleMs?: number;
}

export interface FreshnessResult {
  readonly state: FreshnessState;
  readonly ageMs: number;
  readonly maxAgeMs: number;
  readonly source: string;
  readonly revision?: string;
}

export type FreshnessState =
  "fresh" | "stale" | "expired" | "offline" | "remote-failed" | "no-cache";

const POLICY_DEFAULTS: Record<
  FreshnessPolicy,
  { maxAgeMs: number; maxStaleMs: number }
> = {
  "cache-only": { maxAgeMs: Infinity, maxStaleMs: Infinity },
  "prefer-cache": { maxAgeMs: 5 * 60_000, maxStaleMs: 60 * 60_000 },
  normal: { maxAgeMs: 5 * 60_000, maxStaleMs: 15 * 60_000 },
  refresh: { maxAgeMs: 0, maxStaleMs: 0 },
  strict: { maxAgeMs: 0, maxStaleMs: 0 },
};

export function getPolicyDefaults(policy: FreshnessPolicy): {
  maxAgeMs: number;
  maxStaleMs: number;
} {
  return POLICY_DEFAULTS[policy];
}

export function evaluateFreshness(
  cachedAt: string,
  policy: FreshnessPolicy,
  overrides?: Partial<FreshnessConfig>,
): FreshnessResult {
  const effectivePolicy = overrides?.policy ?? policy;
  const defaults = POLICY_DEFAULTS[effectivePolicy];
  const maxAgeMs = overrides?.maxStaleMs ?? defaults.maxAgeMs;
  const maxStaleMs = overrides?.maxStaleMs ?? defaults.maxStaleMs;

  const ageMs = Date.now() - new Date(cachedAt).getTime();

  if (ageMs < 0) {
    return { state: "fresh", ageMs: 0, maxAgeMs, source: "future-dated" };
  }

  switch (effectivePolicy) {
    case "cache-only":
      return {
        state: "fresh",
        ageMs,
        maxAgeMs: Infinity,
        source: "cache-only",
      };

    case "prefer-cache":
      if (ageMs < maxAgeMs) {
        return { state: "fresh", ageMs, maxAgeMs, source: "cache" };
      }
      if (ageMs < maxStaleMs) {
        return { state: "stale", ageMs, maxAgeMs: maxStaleMs, source: "cache" };
      }
      return { state: "expired", ageMs, maxAgeMs: maxStaleMs, source: "cache" };

    case "normal":
      if (ageMs < maxAgeMs) {
        return { state: "fresh", ageMs, maxAgeMs, source: "cache" };
      }
      if (ageMs < maxStaleMs) {
        return { state: "stale", ageMs, maxAgeMs: maxStaleMs, source: "cache" };
      }
      return { state: "expired", ageMs, maxAgeMs: maxStaleMs, source: "cache" };

    case "refresh":
      return { state: "expired", ageMs, maxAgeMs: 0, source: "refresh-policy" };

    case "strict":
      return { state: "expired", ageMs, maxAgeMs: 0, source: "strict-policy" };
  }
}

export function shouldUseCache(result: FreshnessResult): boolean {
  switch (result.state) {
    case "fresh":
      return true;
    case "stale":
      return true;
    case "expired":
      return false;
    case "offline":
      return true;
    case "remote-failed":
      return true;
    case "no-cache":
      return false;
  }
}

export function shouldRevalidate(result: FreshnessResult): boolean {
  return result.state === "stale";
}

export function shouldBlockOnNetwork(policy: FreshnessPolicy): boolean {
  return policy === "refresh" || policy === "strict";
}
