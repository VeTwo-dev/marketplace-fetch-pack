export interface NetworkRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
  readonly cache?: HttpCacheEntry;
}

export interface NetworkResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly fromCache: boolean;
  readonly duration: number;
}

export interface NetworkJsonResponse<T = unknown> extends NetworkResponse {
  readonly data: T;
}

export interface HttpCacheEntry {
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly jitter: boolean;
}

export interface NetworkClientConfig {
  readonly defaultTimeout: number;
  readonly retry: RetryPolicy;
  readonly maxConcurrency: number;
  readonly userAgent: string;
}

export interface Transport {
  fetch(request: NetworkRequest): Promise<NetworkResponse>;
}

export interface RateLimitInfo {
  readonly remaining: number;
  readonly limit: number;
  readonly resetAt: number | null;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 502 || status === 500;
}

export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 10_000,
    backoffMultiplier: 2,
    jitter: true,
  };
}

export function defaultNetworkConfig(): NetworkClientConfig {
  return {
    defaultTimeout: 30_000,
    retry: defaultRetryPolicy(),
    maxConcurrency: 10,
    userAgent: "@vetwo/marketplace",
  };
}
