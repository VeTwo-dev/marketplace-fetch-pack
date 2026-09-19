export interface DownloadRequest {
  readonly url: string;
  readonly destination: string;
  readonly expectedChecksum?: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly overwrite?: boolean;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly resourceId?: string;
  readonly priority?: DownloadPriority;
  readonly resume?: boolean;
  readonly expectedSize?: number;
  readonly ifNoneMatch?: string;
  readonly ifModifiedSince?: string;
}

export type DownloadPriority =
  "critical" | "high" | "normal" | "low" | "background";

export interface DownloadResult {
  readonly success: boolean;
  readonly path: string;
  readonly size: number;
  readonly checksum: string;
  readonly duration: number;
  readonly fromCache: boolean;
  readonly attempts: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly resumed?: boolean;
}

export interface DownloadMetadata {
  readonly url: string;
  readonly repository?: string;
  readonly revision?: string;
  readonly resourceId?: string;
  readonly version?: string;
  readonly filePath?: string;
  readonly checksum: string;
  readonly size: number;
  readonly downloadedAt: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly source?: string;
  readonly algorithm?: string;
}

export interface ConcurrentQueueConfig {
  readonly maxConcurrency: number;
  readonly maxQueueSize?: number;
}

export interface RetryConfig {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterFactor: number;
  readonly retryOn: ReadonlyArray<string>;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterFactor: 0.3,
  retryOn: ["timeout", "connect", "dns", "unknown", "rate-limit"],
};
