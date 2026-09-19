import { createHash } from "node:crypto";

// ─── Timeout model (Step 5) ──────────────────────────────────────────

export interface TimeoutModel {
  /** TCP/connection establishment (ms) */
  readonly connection: number;
  /** Per-request total duration (ms) */
  readonly request: number;
  /** Download streaming duration (ms) */
  readonly download: number;
  /** Registry metadata operations (ms) */
  readonly registry: number;
}

export const DEFAULT_TIMEOUTS: TimeoutModel = {
  connection: 10_000,
  request: 30_000,
  download: 120_000,
  registry: 15_000,
};

// ─── Retry budget (Step 7) — prevents retry storms ───────────────────

export interface RetryBudgetOptions {
  /** Maximum retries allowed per window */
  readonly maxRetries: number;
  /** Window length in ms before the budget refills */
  readonly windowMs: number;
}

interface BudgetEntry {
  used: number;
  windowStart: number;
}

/**
 * Token-bucket retry budget keyed by endpoint. A failing endpoint cannot
 * consume uncontrolled retries: once the budget is exhausted within the
 * window, further attempts fail fast until the window elapses.
 */
export class RetryBudget {
  private readonly _entries = new Map<string, BudgetEntry>();
  private readonly _maxRetries: number;
  private readonly _windowMs: number;

  constructor(options?: Partial<RetryBudgetOptions>) {
    this._maxRetries = options?.maxRetries ?? 10;
    this._windowMs = options?.windowMs ?? 60_000;
  }

  /** Returns true and consumes one unit when a retry is permitted. */
  tryConsume(key: string): boolean {
    const now = Date.now();
    let entry = this._entries.get(key);
    if (entry === undefined || now - entry.windowStart >= this._windowMs) {
      entry = { used: 0, windowStart: now };
      this._entries.set(key, entry);
    }
    if (entry.used >= this._maxRetries) return false;
    entry.used += 1;
    return true;
  }

  remaining(key: string): number {
    const entry = this._entries.get(key);
    if (
      entry === undefined ||
      Date.now() - entry.windowStart >= this._windowMs
    ) {
      return this._maxRetries;
    }
    return Math.max(0, this._maxRetries - entry.used);
  }

  reset(): void {
    this._entries.clear();
  }
}

// ─── Network telemetry (Step 24) — bounded counters ───────────────────

export interface NetworkTelemetrySnapshot {
  readonly requests: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly deduplicated: number;
  readonly retries: number;
  readonly timeouts: number;
  readonly rateLimited: number;
  readonly bytesDownloaded: number;
  readonly bytesReused: number;
}

export class NetworkTelemetry {
  private _requests = 0;
  private _cacheHits = 0;
  private _cacheMisses = 0;
  private _deduplicated = 0;
  private _retries = 0;
  private _timeouts = 0;
  private _rateLimited = 0;
  private _bytesDownloaded = 0;
  private _bytesReused = 0;

  recordRequest(): void {
    this._requests++;
  }
  recordCacheHit(): void {
    this._cacheHits++;
  }
  recordCacheMiss(): void {
    this._cacheMisses++;
  }
  recordDeduplicated(): void {
    this._deduplicated++;
  }
  recordRetry(): void {
    this._retries++;
  }
  recordTimeout(): void {
    this._timeouts++;
  }
  recordRateLimited(): void {
    this._rateLimited++;
  }
  recordBytes(n: number): void {
    this._bytesDownloaded += n;
  }
  recordBytesReused(n: number): void {
    this._bytesReused += n;
  }

  snapshot(): NetworkTelemetrySnapshot {
    return {
      requests: this._requests,
      cacheHits: this._cacheHits,
      cacheMisses: this._cacheMisses,
      deduplicated: this._deduplicated,
      retries: this._retries,
      timeouts: this._timeouts,
      rateLimited: this._rateLimited,
      bytesDownloaded: this._bytesDownloaded,
      bytesReused: this._bytesReused,
    };
  }

  get hitRate(): number {
    const total = this._cacheHits + this._cacheMisses;
    return total === 0 ? 0 : this._cacheHits / total;
  }

  reset(): void {
    this._requests = 0;
    this._cacheHits = 0;
    this._cacheMisses = 0;
    this._deduplicated = 0;
    this._retries = 0;
    this._timeouts = 0;
    this._rateLimited = 0;
    this._bytesDownloaded = 0;
    this._bytesReused = 0;
  }
}

// ─── Category concurrency limiter (Steps 21–22) ──────────────────────

export type RequestCategory =
  "registry" | "metadata" | "download" | "background";

const DEFAULT_CATEGORY_LIMITS: Readonly<Record<RequestCategory, number>> = {
  registry: 4,
  metadata: 6,
  download: 8,
  background: 2,
};

/**
 * Separate concurrency pools per request category so background work can
 * never starve interactive operations.
 */
export class CategoryConcurrencyLimiter {
  private readonly _limits: Record<RequestCategory, number>;
  private readonly _active: Record<RequestCategory, number> = {
    registry: 0,
    metadata: 0,
    download: 0,
    background: 0,
  };
  private readonly _queues: Record<RequestCategory, Array<() => void>> = {
    registry: [],
    metadata: [],
    download: [],
    background: [],
  };

  constructor(limits?: Partial<Record<RequestCategory, number>>) {
    this._limits = { ...DEFAULT_CATEGORY_LIMITS, ...limits };
  }

  async run<T>(category: RequestCategory, fn: () => Promise<T>): Promise<T> {
    await this._acquire(category);
    try {
      return await fn();
    } finally {
      this._release(category);
    }
  }

  activeCount(category: RequestCategory): number {
    return this._active[category];
  }

  private _acquire(category: RequestCategory): Promise<void> {
    if (this._active[category] < this._limits[category]) {
      this._active[category] += 1;
      return Promise.resolve();
    }
    return new Promise((resolveWait) => {
      this._queues[category].push(() => {
        this._active[category] += 1;
        resolveWait();
      });
    });
  }

  private _release(category: RequestCategory): void {
    this._active[category] -= 1;
    const next = this._queues[category].shift();
    if (next !== undefined) next();
  }
}

// ─── Stale-while-revalidate (Step 16) ────────────────────────────────

export type SwrState = "fresh" | "stale" | "expired";

export interface SwrOptions {
  /** Data younger than freshTtl is served without revalidation */
  readonly freshTtlMs: number;
  /** Data older than staleTtl must be fetched synchronously */
  readonly staleTtlMs: number;
}

interface SwrRecord<T> {
  value: T;
  fetchedAt: number;
}

/**
 * Stale-while-revalidate value holder:
 * fresh → return immediately
 * stale → return immediately + trigger background refresh once
 * expired → fetch synchronously
 */
export class StaleWhileRevalidate<T> {
  private _record: SwrRecord<T> | null = null;
  private _refreshing: Promise<T> | null = null;
  private readonly _options: SwrOptions;

  constructor(options: SwrOptions) {
    this._options = options;
  }

  state(): SwrState {
    if (this._record === null) return "expired";
    const age = Date.now() - this._record.fetchedAt;
    if (age < this._options.freshTtlMs) return "fresh";
    if (age < this._options.staleTtlMs) return "stale";
    return "expired";
  }

  async get(fetcher: () => Promise<T>): Promise<{ value: T; state: SwrState }> {
    const current = this.state();

    if (current === "fresh") {
      return { value: this._record!.value, state: "fresh" };
    }

    if (current === "stale") {
      // Kick off a single background refresh (deduplicated)
      if (this._refreshing === null) {
        this._refreshing = fetcher()
          .then((value) => {
            this._record = { value, fetchedAt: Date.now() };
            return value;
          })
          .finally(() => {
            this._refreshing = null;
          });
      }
      return { value: this._record!.value, state: "stale" };
    }

    // Expired / never fetched → synchronous fetch
    const value = await this._refreshOrFetch(fetcher);
    return { value, state: "expired" };
  }

  invalidate(): void {
    this._record = null;
  }

  peek(): T | undefined {
    return this._record?.value;
  }

  private async _refreshOrFetch(fetcher: () => Promise<T>): Promise<T> {
    const value = await fetcher();
    this._record = { value, fetchedAt: Date.now() };
    return value;
  }
}

// ─── Namespaced cache keys (Phase 20 Step 31) ────────────────────────

export interface CacheKeyContext {
  readonly provider: string;
  readonly repository: string;
  readonly ref: string;
  readonly resource?: string;
  readonly version?: string;
  readonly schemaVersion: string;
}

/** Deterministic collision-safe cache key binding data identity to context. */
export function buildNamespacedCacheKey(
  ctx: CacheKeyContext,
  label: string,
): string {
  const raw = [
    ctx.provider,
    ctx.repository,
    ctx.ref,
    ctx.resource ?? "*",
    ctx.version ?? "*",
    ctx.schemaVersion,
    label,
  ].join("\u0000");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
