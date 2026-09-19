interface SingleFlightResult<T> {
  readonly data: T;
  readonly fromCache: boolean;
}

export class SingleFlight {
  private readonly _inflight = new Map<string, Promise<unknown>>();
  private readonly _negativeCache = new Map<
    string,
    { error: unknown; timestamp: number }
  >();
  private readonly _negativeCacheTtlMs: number;

  constructor(negativeCacheTtlMs: number = 60_000) {
    this._negativeCacheTtlMs = negativeCacheTtlMs;
  }

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this._inflight.get(key);
    if (existing !== undefined) {
      return existing as Promise<T>;
    }

    const promise = fn()
      .then((result) => {
        this._inflight.delete(key);
        this._negativeCache.delete(key);
        return result;
      })
      .catch((error) => {
        this._inflight.delete(key);
        this._negativeCache.set(key, { error, timestamp: Date.now() });
        throw error;
      });

    this._inflight.set(key, promise);
    return promise;
  }

  getNegativeCache(key: string): unknown | null {
    const entry = this._negativeCache.get(key);
    if (entry === undefined) return null;
    if (Date.now() - entry.timestamp > this._negativeCacheTtlMs) {
      this._negativeCache.delete(key);
      return null;
    }
    return entry.error;
  }

  clearNegativeCache(key?: string): void {
    if (key !== undefined) {
      this._negativeCache.delete(key);
    } else {
      this._negativeCache.clear();
    }
  }

  get inflightCount(): number {
    return this._inflight.size;
  }

  clear(): void {
    this._inflight.clear();
    this._negativeCache.clear();
  }
}

export class RequestDeduplicator {
  private readonly _singleFlight: SingleFlight;

  constructor(singleFlight?: SingleFlight) {
    this._singleFlight = singleFlight ?? new SingleFlight();
  }

  deduplicate<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this._singleFlight.do(key, fn);
  }

  async deduplicateMultiple<T>(
    keys: ReadonlyArray<string>,
    fns: ReadonlyArray<() => Promise<T>>,
  ): Promise<Array<T>> {
    const results = await Promise.allSettled(
      keys.map((key, i) => this._singleFlight.do(key, fns[i]!)),
    );

    return results.map((r) => {
      if (r.status === "fulfilled") return r.value;
      throw r.reason;
    });
  }

  clear(): void {
    this._singleFlight.clear();
  }

  get inflightCount(): number {
    return this._singleFlight.inflightCount;
  }
}

export function buildRegistryFetchKey(
  repository: string,
  branch: string,
): string {
  return `registry:${repository}:${branch}`;
}

export function buildManifestFetchKey(
  repository: string,
  path: string,
): string {
  return `manifest:${repository}:${path}`;
}

export function buildResourceFetchKey(
  repository: string,
  resourceId: string,
): string {
  return `resource:${repository}:${resourceId}`;
}
