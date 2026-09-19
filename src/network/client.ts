import type {
  Transport,
  NetworkRequest,
  NetworkResponse,
  NetworkJsonResponse,
  NetworkClientConfig,
  RetryPolicy,
  RateLimitInfo,
  HttpCacheEntry,
} from "./types.js";
import { isRetryableStatus, defaultNetworkConfig } from "./types.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { NodeTransport } from "./node-transport.js";

interface InFlightRequest {
  readonly promise: Promise<NetworkResponse>;
  readonly refCount: number;
}

export class NetworkClient {
  private readonly _transport: Transport;
  private readonly _config: NetworkClientConfig;
  private readonly _logger: Logger;
  private readonly _inFlight = new Map<string, InFlightRequest>();
  private readonly _cache = new Map<string, HttpCacheEntry>();
  private _rateLimit: RateLimitInfo | null = null;
  private _activeRequests = 0;
  private readonly _queue: Array<() => void> = [];

  constructor(
    transport?: Transport,
    config?: Partial<NetworkClientConfig>,
    logger?: Logger,
  ) {
    this._transport = transport ?? new NodeTransport();
    this._config = { ...defaultNetworkConfig(), ...config };
    this._logger = logger ?? createLogger({ prefix: "network" });
  }

  get rateLimit(): RateLimitInfo | null {
    return this._rateLimit;
  }

  get activeRequests(): number {
    return this._activeRequests;
  }

  async fetch(request: NetworkRequest): Promise<NetworkResponse> {
    const dedupeKey = this._dedupeKey(request);

    const existing = this._inFlight.get(dedupeKey);
    if (existing !== undefined) {
      this._logger.debug("Deduplicating request", { url: request.url });
      const updatedRefCount = { ...existing, refCount: existing.refCount + 1 };
      this._inFlight.set(dedupeKey, updatedRefCount);
      try {
        return await existing.promise;
      } finally {
        this._decrementRefCount(dedupeKey);
      }
    }

    await this._waitForSlot();

    const promise = this._executeWithRetry(request);
    this._inFlight.set(dedupeKey, { promise, refCount: 1 });

    try {
      this._activeRequests++;
      return await promise;
    } finally {
      this._activeRequests--;
      this._decrementRefCount(dedupeKey);
      this._processQueue();
    }
  }

  async fetchJson<T = unknown>(
    request: NetworkRequest,
  ): Promise<NetworkJsonResponse<T>> {
    const response = await this.fetch(request);

    if (response.status === 304 && response.fromCache) {
      return {
        ...response,
        data: null as unknown as T,
      };
    }

    if (response.status >= 400) {
      throw this._normalizeHttpError(response);
    }

    try {
      const data = JSON.parse(response.body) as T;
      return { ...response, data };
    } catch {
      throw new MarketplaceClientError("MANIFEST_PARSE_ERROR", {
        message: `Invalid JSON response from ${request.url}`,
        context: { url: request.url, status: response.status },
      });
    }
  }

  getCachedEntry(url: string): HttpCacheEntry | undefined {
    return this._cache.get(url);
  }

  setCachedEntry(url: string, entry: HttpCacheEntry): void {
    this._cache.set(url, entry);
  }

  clearCache(): void {
    this._cache.clear();
  }

  private async _executeWithRetry(
    request: NetworkRequest,
  ): Promise<NetworkResponse> {
    const retry = this._config.retry;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      try {
        const mergedRequest = this._mergeCacheEntry(request);
        const response = await this._transport.fetch(mergedRequest);

        this._updateRateLimit(response.headers);

        if (response.status === 304) {
          return response;
        }

        if (response.status >= 200 && response.status < 300) {
          this._updateCacheFromResponse(request.url, response);
          return response;
        }

        if (!isRetryableStatus(response.status)) {
          throw this._normalizeHttpError(response);
        }

        lastError = this._normalizeHttpError(response);

        if (attempt < retry.maxRetries) {
          const delay = this._computeDelay(attempt, retry);
          this._logger.debug("Retrying request", {
            url: request.url,
            attempt: attempt + 1,
            delay,
            status: response.status,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        if (error instanceof MarketplaceClientError) {
          if (
            error.code === "DOWNLOAD_TIMEOUT" ||
            error.code === "NETWORK_ERROR"
          ) {
            lastError = error;
            if (attempt < retry.maxRetries) {
              const delay = this._computeDelay(attempt, retry);
              this._logger.debug("Retrying after error", {
                url: request.url,
                attempt: attempt + 1,
                delay,
              });
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
          }
          throw error;
        }
        throw error;
      }
    }

    throw (
      lastError ??
      new MarketplaceClientError("NETWORK_ERROR", {
        message: "All retry attempts failed",
        context: { url: request.url },
      })
    );
  }

  private _mergeCacheEntry(request: NetworkRequest): NetworkRequest {
    const cached = this._cache.get(request.url);
    if (cached === undefined) return request;

    return {
      ...request,
      cache: {
        etag: cached.etag,
        lastModified: cached.lastModified,
      },
    };
  }

  private _updateCacheFromResponse(
    url: string,
    response: NetworkResponse,
  ): void {
    const etag = response.headers["etag"];
    const lastModified = response.headers["last-modified"];

    if (etag !== undefined || lastModified !== undefined) {
      this._cache.set(url, {
        etag: etag ?? undefined,
        lastModified: lastModified ?? undefined,
      });
    }
  }

  private _updateRateLimit(headers: Record<string, string>): void {
    const remaining = headers["x-ratelimit-remaining"];
    const limit = headers["x-ratelimit-limit"];
    const reset = headers["x-ratelimit-reset"];

    if (remaining !== undefined && limit !== undefined) {
      this._rateLimit = {
        remaining: parseInt(remaining, 10),
        limit: parseInt(limit, 10),
        resetAt: reset !== undefined ? parseInt(reset, 10) * 1000 : null,
      };
    }
  }

  private _computeDelay(attempt: number, retry: RetryPolicy): number {
    let delay = retry.baseDelayMs * Math.pow(retry.backoffMultiplier, attempt);
    delay = Math.min(delay, retry.maxDelayMs);

    if (retry.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.floor(delay);
  }

  private _normalizeHttpError(
    response: NetworkResponse,
  ): MarketplaceClientError {
    const context = {
      url: response.statusText,
      status: response.status,
      statusText: response.statusText,
    };

    if (response.status === 429) {
      return new MarketplaceClientError("GITHUB_RATE_LIMIT", {
        message: `Rate limit exceeded`,
        context,
      });
    }

    if (response.status === 401 || response.status === 403) {
      return new MarketplaceClientError("GITHUB_API_ERROR", {
        message: `Authentication/authorization failed (${response.status})`,
        context,
      });
    }

    if (response.status === 404) {
      return new MarketplaceClientError("RESOURCE_NOT_FOUND", {
        message: `Resource not found: ${response.statusText}`,
        context,
      });
    }

    return new MarketplaceClientError("NETWORK_ERROR", {
      message: `HTTP ${response.status}: ${response.statusText}`,
      context,
    });
  }

  private _dedupeKey(request: NetworkRequest): string {
    return `${request.method ?? "GET"}:${request.url}`;
  }

  private _decrementRefCount(key: string): void {
    const entry = this._inFlight.get(key);
    if (entry === undefined) return;

    if (entry.refCount <= 1) {
      this._inFlight.delete(key);
    } else {
      this._inFlight.set(key, { ...entry, refCount: entry.refCount - 1 });
    }
  }

  private async _waitForSlot(): Promise<void> {
    if (this._activeRequests < this._config.maxConcurrency) return;

    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  private _processQueue(): void {
    while (
      this._queue.length > 0 &&
      this._activeRequests < this._config.maxConcurrency
    ) {
      const next = this._queue.shift();
      if (next !== undefined) next();
    }
  }
}

export function createNetworkClient(
  transport?: Transport,
  config?: Partial<NetworkClientConfig>,
  logger?: Logger,
): NetworkClient {
  return new NetworkClient(transport, config, logger);
}
