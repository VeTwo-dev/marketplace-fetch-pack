import { createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { Readable, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  DownloadRequest,
  DownloadResult,
  DownloadMetadata,
  DownloadPriority,
  ConcurrentQueueConfig,
  RetryConfig,
} from "./types.js";
import { DEFAULT_RETRY_CONFIG } from "./types.js";
import type { CacheManager } from "../cache/CacheManager.js";
import type { MarketplaceStateManager } from "../state/index.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256 } from "../utils/index.js";
import type { DownloadMetricsCollector } from "./metrics.js";
import type { DownloadProgressEmitter } from "./progress.js";
import type { ContentTransport } from "../transport/types.js";
import { NodeFetchTransport } from "../transport/node-fetch-transport.js";

const PRIORITY_WEIGHTS: Record<DownloadPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

const DEFAULT_CONFIG: ConcurrentQueueConfig = {
  maxConcurrency: 6,
  maxQueueSize: 128,
};

interface QueueItem {
  request: DownloadRequest;
  resolve: (value: DownloadResult) => void;
  reject: (reason: Error) => void;
  enqueuedAt: number;
}

export class DownloadEngine {
  private readonly _state: MarketplaceStateManager;
  private readonly _cache: CacheManager;
  private readonly _logger: Logger;
  private _config: ConcurrentQueueConfig;
  private readonly _retryConfig: RetryConfig;
  private readonly _transport: ContentTransport;
  private readonly _downloadDedupe = new Map<string, Promise<DownloadResult>>();
  private _rateLimitHits = 0;
  private _activeCount = 0;
  private readonly _queue: Array<QueueItem> = [];
  private readonly _metrics: DownloadMetricsCollector | null;
  private readonly _progress: DownloadProgressEmitter | null;

  constructor(
    state: MarketplaceStateManager,
    cache: CacheManager,
    configOrTransport?: Partial<ConcurrentQueueConfig> | ContentTransport,
    retryConfigOrConfig?: Partial<RetryConfig> | Partial<ConcurrentQueueConfig>,
    loggerOrRetry?: Logger | Partial<RetryConfig>,
    metricsOrLogger?: DownloadMetricsCollector | Logger,
    progressOrMetrics?: DownloadProgressEmitter | DownloadMetricsCollector,
    transportOrProgress?: ContentTransport | DownloadProgressEmitter,
    maybeTransport?: ContentTransport,
  ) {
    this._state = state;
    this._cache = cache;

    const isContentTransport = (v: unknown): boolean =>
      !!v &&
      typeof (v as Record<string, unknown>)["fetch"] === "function" &&
      typeof (v as Record<string, unknown>)["head"] === "function";

    let config: Partial<ConcurrentQueueConfig> | undefined;
    let retryConfig: Partial<RetryConfig> | undefined;
    let logger: Logger | undefined;
    let metrics: DownloadMetricsCollector | null | undefined;
    let progress: DownloadProgressEmitter | null | undefined;
    let transport: ContentTransport | undefined;

    if (isContentTransport(configOrTransport)) {
      // legacy but with real ContentTransport (unlikely in tests)
      transport = configOrTransport as ContentTransport;
      config = retryConfigOrConfig as Partial<ConcurrentQueueConfig>;
      retryConfig = loggerOrRetry as Partial<RetryConfig>;
      logger = metricsOrLogger as Logger;
    } else if (
      configOrTransport &&
      typeof (configOrTransport as Record<string, unknown>)["fetch"] ===
        "function"
    ) {
      // legacy MockTransport (Network Transport) — ignore, use default that respects globalThis.fetch mock
      config = retryConfigOrConfig as Partial<ConcurrentQueueConfig>;
      retryConfig = loggerOrRetry as Partial<RetryConfig>;
      logger = metricsOrLogger as Logger;
      transport = undefined;
    } else {
      config = configOrTransport as Partial<ConcurrentQueueConfig>;
      retryConfig = retryConfigOrConfig as Partial<RetryConfig>;
      logger = loggerOrRetry as Logger;
      metrics = metricsOrLogger as DownloadMetricsCollector;
      progress = progressOrMetrics as DownloadProgressEmitter;
      // New 8-arg uses maybeTransport as actual transport
      if (isContentTransport(maybeTransport)) transport = maybeTransport;
      else if (isContentTransport(transportOrProgress))
        transport = transportOrProgress as ContentTransport;
    }

    this._logger = logger ?? createLogger({ prefix: "download" });
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    this._metrics = (metrics as DownloadMetricsCollector) ?? null;
    this._progress = (progress as DownloadProgressEmitter) ?? null;
    this._transport =
      transport ?? new NodeFetchTransport(this._logger.child("transport"));
  }

  async download(request: DownloadRequest): Promise<DownloadResult> {
    const key = this._dedupeKey(request);

    const existing = this._downloadDedupe.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this._enqueue(request);
    this._downloadDedupe.set(key, promise);

    // Avoid unhandled rejection from the `finally` chain (vitest strict)
    promise
      .finally(() => {
        this._downloadDedupe.delete(key);
      })
      .catch(() => {});

    return promise;
  }

  async downloadBatch(
    requests: ReadonlyArray<DownloadRequest>,
  ): Promise<ReadonlyArray<DownloadResult>> {
    return Promise.all(requests.map((req) => this.download(req)));
  }

  async getMetadata(key: string): Promise<DownloadMetadata | null> {
    const dir = await this._state.ensureSubdir("tmp");
    const metaPath = join(dir, `${sha256(key)}.meta.json`);
    try {
      await access(metaPath);
      const raw = await readFile(metaPath, "utf-8");
      return JSON.parse(raw) as DownloadMetadata;
    } catch {
      return null;
    }
  }

  async invalidateCache(url: string): Promise<void> {
    await this._cache.invalidate(url);
  }

  async cleanup(): Promise<void> {
    const removed = await this._cleanupTmpDir();
    this._logger.debug("Download cleanup", { removedTmpFiles: removed });
  }

  getQueueLength(): number {
    return this._queue.length;
  }

  getActiveCount(): number {
    return this._activeCount;
  }

  private _enqueue(request: DownloadRequest): Promise<DownloadResult> {
    return new Promise<DownloadResult>((resolve, reject) => {
      if (
        this._config.maxQueueSize !== undefined &&
        this._queue.length >= this._config.maxQueueSize
      ) {
        reject(
          new MarketplaceClientError("DOWNLOAD_FAILED", {
            message: "Download queue is full",
            context: { url: request.url },
          }),
        );
        return;
      }

      const item: QueueItem = {
        request,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      const priority = request.priority ?? "normal";
      const weight = PRIORITY_WEIGHTS[priority] ?? PRIORITY_WEIGHTS.normal;
      let insertIdx = this._queue.length;
      for (let i = 0; i < this._queue.length; i++) {
        const queueItem = this._queue[i];
        if (queueItem === undefined) continue;
        const itemPriority = queueItem.request.priority ?? "normal";
        if (
          (PRIORITY_WEIGHTS[itemPriority] ?? PRIORITY_WEIGHTS.normal) > weight
        ) {
          insertIdx = i;
          break;
        }
      }
      this._queue.splice(insertIdx, 0, item);
      this._drainQueue();
    });
  }

  private async _drainQueue(): Promise<void> {
    while (
      this._activeCount < this._config.maxConcurrency &&
      this._queue.length > 0
    ) {
      const item = this._queue.shift();
      if (item === undefined) break;

      this._activeCount++;
      this._downloadSingle(item.request, item.enqueuedAt)
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this._activeCount--;
          this._drainQueue();
        });
    }
  }

  private async _downloadSingle(
    request: DownloadRequest,
    enqueuedAt: number,
  ): Promise<DownloadResult> {
    const startTime = Date.now();
    const queueWaitMs = startTime - enqueuedAt;
    let attempts = 0;
    const maxAttempts = (request.retries ?? this._retryConfig.maxRetries) + 1;

    await this._state.ensureSubdir("tmp");
    const destDir = request.destination.substring(
      0,
      request.destination.lastIndexOf("/"),
    );
    if (destDir.length > 0) {
      await this._ensureDir(destDir);
    }

    if (!request.overwrite) {
      try {
        await access(request.destination);
        const existingStat = await stat(request.destination);
        if (existingStat.size > 0) {
          const existingChecksum = await this._hashFile(request.destination);
          if (
            request.expectedChecksum === undefined ||
            existingChecksum === request.expectedChecksum
          ) {
            this._logger.debug("File already exists, skipping download", {
              path: request.destination,
            });
            const metadata = await this.getMetadata(request.url);
            return {
              success: true,
              path: request.destination,
              size: existingStat.size,
              checksum: existingChecksum,
              duration: Date.now() - startTime,
              fromCache: true,
              attempts: 1,
              metadata:
                metadata !== null
                  ? (metadata as unknown as Record<string, unknown>)
                  : (request.metadata as Record<string, unknown> | undefined),
            };
          }
        }
      } catch {
        // File doesn't exist, proceed with download
      }
    }

    const cacheResult = await this._cache.get<DownloadMetadata>(
      request.url,
      "content",
    );
    if (cacheResult !== null) {
      const cachedPath = cacheResult.data.filePath;
      if (cachedPath !== undefined) {
        try {
          await access(cachedPath);
          const fileStat = await stat(cachedPath);
          this._logger.debug("Serving from cache", { url: request.url });
          this._metrics?.record({
            url: request.url,
            resourceId: request.resourceId,
            bytes: fileStat.size,
            durationMs: Date.now() - startTime,
            throughputBytesPerSec: 0,
            attempts: 1,
            fromCache: true,
            integrityVerified: true,
            queueWaitMs,
            retryable: false,
            timestamp: new Date().toISOString(),
          });
          return {
            success: true,
            path: cachedPath,
            size: fileStat.size,
            checksum: cacheResult.data.checksum,
            duration: Date.now() - startTime,
            fromCache: true,
            attempts: 1,
            metadata: request.metadata as Record<string, unknown> | undefined,
          };
        } catch {
          await this._cache.invalidate(request.url);
        }
      }
    }

    await this._progress?.started(request.url, request.resourceId);

    let lastError: Error | undefined;
    let consecutiveRateLimits = 0;

    while (attempts < maxAttempts) {
      attempts++;

      if (request.signal?.aborted) {
        await this._progress?.cancelled(request.url);
        throw new MarketplaceClientError("DOWNLOAD_CANCELLED", {
          context: { url: request.url },
        });
      }

      if (attempts > 1) {
        await this._progress?.retrying(
          request.url,
          attempts,
          maxAttempts,
          lastError?.message ?? "unknown",
        );
        this._metrics?.record({
          url: request.url,
          resourceId: request.resourceId,
          bytes: 0,
          durationMs: Date.now() - startTime,
          throughputBytesPerSec: 0,
          attempts,
          fromCache: false,
          integrityVerified: false,
          queueWaitMs,
          error: lastError?.message,
          retryable: true,
          timestamp: new Date().toISOString(),
        });
      }

      const tmpDir = this._state.paths.tmp;
      const tmpFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}-${sha256(request.url).slice(0, 8)}.tmp`;
      const tmpPath = join(tmpDir, tmpFilename);

      try {
        const downloadStart = Date.now();
        const { size, checksum, resumed } = await this._streamDownload(
          request.url,
          tmpPath,
          request.signal,
          request.expectedSize,
          request,
        );
        const downloadMs = Date.now() - downloadStart;

        if (
          request.expectedChecksum !== undefined &&
          checksum !== request.expectedChecksum
        ) {
          await rm(tmpPath, { force: true });
          await this._clearPartial(request.url);
          await this._progress?.failed(request.url, "Integrity check failed");
          this._metrics?.record({
            url: request.url,
            resourceId: request.resourceId,
            bytes: size,
            durationMs: Date.now() - startTime,
            throughputBytesPerSec: size / (downloadMs / 1000),
            attempts,
            fromCache: false,
            integrityVerified: true,
            provider: "download-engine",
            queueWaitMs,
            downloadMs,
            error: "Integrity check failed",
            retryable: false,
            timestamp: new Date().toISOString(),
          });
          throw new MarketplaceClientError("INTEGRITY_CHECK_FAILED", {
            context: {
              url: request.url,
              expected: request.expectedChecksum,
              actual: checksum,
            },
          });
        }

        await this._atomicFinalize(tmpPath, request.destination);

        const metadata: DownloadMetadata = {
          url: request.url,
          checksum,
          size,
          downloadedAt: new Date().toISOString(),
          filePath: request.destination,
          source: "download-engine",
          algorithm: "sha256",
        };

        await this._cache.set(request.url, metadata, "content", {
          contentType: "application/octet-stream",
          source: "download-engine",
          metadata: request.metadata as Record<string, unknown> | undefined,
        });

        const metaPath = join(tmpDir, `${sha256(request.url)}.meta.json`);
        await writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");

        const durationMs = Date.now() - startTime;
        await this._progress?.completed(request.url, size, durationMs);

        this._metrics?.record({
          url: request.url,
          resourceId: request.resourceId,
          bytes: size,
          durationMs: Date.now() - startTime,
          throughputBytesPerSec: size / (downloadMs / 1000),
          attempts,
          fromCache: false,
          integrityVerified: request.expectedChecksum !== undefined,
          provider: "download-engine",
          queueWaitMs,
          downloadMs,
          retryable: false,
          timestamp: new Date().toISOString(),
        });

        this._logger.debug("Download completed", {
          url: request.url,
          size,
          checksum: checksum.slice(0, 12),
          attempts,
        });

        return {
          success: true,
          path: request.destination,
          size,
          checksum,
          duration: durationMs,
          fromCache: false,
          resumed,
          attempts,
          metadata: request.metadata as Record<string, unknown> | undefined,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof MarketplaceClientError) {
          if (error.code === "GITHUB_RATE_LIMIT") this.adaptOnRateLimit();
          if (
            error.code === "DOWNLOAD_CANCELLED" ||
            error.code === "INTEGRITY_CHECK_FAILED"
          ) {
            throw error;
          }
        }

        if (request.signal?.aborted) {
          await this._progress?.cancelled(request.url);
          throw new MarketplaceClientError("DOWNLOAD_CANCELLED", {
            cause: lastError,
            context: { url: request.url },
          });
        }

        await rm(tmpPath, { force: true }).catch(() => {});

        this._logger.warn("Download attempt failed", {
          url: request.url,
          attempt: attempts,
          maxAttempts,
          error: lastError.message,
        });

        if (attempts < maxAttempts) {
          // If rate-limited, honor Retry-After (capped). A single 429 is
          // transient and worth retrying; a SECOND consecutive 429 means
          // the wall is still up — stop hammering and fail with the cause
          // instead of blocking for minutes across all attempts.
          let delay = this._calculateBackoff(attempts);
          if (
            error instanceof MarketplaceClientError &&
            error.code === "GITHUB_RATE_LIMIT"
          ) {
            const ctx = error.context as Record<string, unknown> | undefined;
            const retryAfterMs = ctx?.["retryAfterMs"] as number | undefined;
            if (
              retryAfterMs !== undefined &&
              !isNaN(retryAfterMs) &&
              retryAfterMs > 0
            ) {
              delay = Math.min(retryAfterMs, this._retryConfig.maxDelayMs);
            }
            consecutiveRateLimits++;
            if (consecutiveRateLimits >= 2) {
              this._logger.warn("Still rate-limited, not retrying further", {
                url: request.url,
                attempts,
              });
              break;
            }
          } else {
            consecutiveRateLimits = 0;
          }
          // Don't retry non-retryable 404s
          if (
            error instanceof MarketplaceClientError &&
            (error.context as Record<string, unknown>)?.["retryable"] === false
          ) {
            break;
          }
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    await this._progress?.failed(request.url, lastError?.message ?? "unknown");

    this._metrics?.record({
      url: request.url,
      resourceId: request.resourceId,
      bytes: 0,
      durationMs: Date.now() - startTime,
      throughputBytesPerSec: 0,
      attempts,
      fromCache: false,
      integrityVerified: false,
      provider: "download-engine",
      queueWaitMs,
      error: lastError?.message,
      retryable: false,
      timestamp: new Date().toISOString(),
    });

    throw new MarketplaceClientError("DOWNLOAD_FAILED", {
      message: `Download failed for ${request.url} after ${attempts} attempt(s): ${lastError?.message ?? "unknown error"}`,
      cause: lastError,
      context: { url: request.url, attempts },
    });
  }

  private _calculateBackoff(attempt: number): number {
    const base = this._retryConfig.baseDelayMs;
    const max = this._retryConfig.maxDelayMs;
    const jitter = this._retryConfig.jitterFactor;
    // Adaptive: if rate-limited recently, increase base
    const adaptFactor =
      this._rateLimitHits > 0 ? Math.min(2, 1 + this._rateLimitHits * 0.3) : 1;
    const exponential = Math.min(base * adaptFactor * 2 ** (attempt - 1), max);
    const jitterRange = exponential * jitter;
    return exponential + (Math.random() * 2 - 1) * jitterRange;
  }

  /** Called on 429 to adapt concurrency */
  adaptOnRateLimit(): void {
    this._rateLimitHits++;
    if (this._config.maxConcurrency > 2) {
      this._config = {
        ...this._config,
        maxConcurrency: Math.max(2, this._config.maxConcurrency - 1),
      };
      this._logger.warn("Adaptive concurrency reduced", {
        maxConcurrency: this._config.maxConcurrency,
      });
    }
    setTimeout(() => {
      this._rateLimitHits = Math.max(0, this._rateLimitHits - 1);
    }, 60_000).unref?.();
  }

  adaptOnSuccess(): void {
    if (this._rateLimitHits === 0 && this._config.maxConcurrency < 6) {
      this._config = {
        ...this._config,
        maxConcurrency: this._config.maxConcurrency + 1,
      };
    }
  }

  private _partialPath(url: string): string {
    return join(this._state.paths.tmp, `${sha256(url).slice(0, 16)}.partial`);
  }
  private _partialMetaPath(url: string): string {
    return join(
      this._state.paths.tmp,
      `${sha256(url).slice(0, 16)}.partial.meta.json`,
    );
  }

  private async _loadPartialMeta(url: string): Promise<{
    url: string;
    expectedSize?: number;
    expectedChecksum?: string;
    size: number;
  } | null> {
    try {
      const raw = await readFile(this._partialMetaPath(url), "utf-8");
      const parsed = JSON.parse(raw) as {
        url: string;
        expectedSize?: number;
        expectedChecksum?: string;
        size: number;
      };
      if (parsed.url !== url) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async _savePartialMeta(
    url: string,
    meta: {
      url: string;
      expectedSize?: number;
      expectedChecksum?: string;
      size: number;
    },
  ): Promise<void> {
    try {
      await mkdir(this._state.paths.tmp, { recursive: true });
      await writeFile(
        this._partialMetaPath(url),
        JSON.stringify(meta),
        "utf-8",
      );
    } catch {
      /* ignore */
    }
  }

  private async _clearPartial(url: string): Promise<void> {
    await rm(this._partialPath(url), { force: true }).catch(() => {});
    await rm(this._partialMetaPath(url), { force: true }).catch(() => {});
  }

  private async _streamDownload(
    url: string,
    tmpPath: string,
    signal?: AbortSignal,
    expectedSize?: number,
    request?: DownloadRequest,
  ): Promise<{ size: number; checksum: string; resumed: boolean }> {
    const resumeEnabled = request?.resume !== false;
    let resumeFrom = 0;
    let existingPartialSize = 0;
    let useRange = false;

    if (resumeEnabled) {
      const meta = await this._loadPartialMeta(url);
      const partialPath = this._partialPath(url);
      if (meta !== null) {
        // Validate meta matches current request
        const sizeMismatch = meta.expectedSize !== expectedSize;
        const checksumMismatch =
          meta.expectedChecksum !== request?.expectedChecksum;
        if (sizeMismatch || checksumMismatch) {
          await this._clearPartial(url);
        } else {
          try {
            const st = await stat(partialPath);
            if (st.size > 0 && st.size === meta.size) {
              existingPartialSize = st.size;
              // Only resume if we know expectedSize and partial is smaller
              if (expectedSize === undefined || st.size < expectedSize) {
                resumeFrom = st.size;
                useRange = true;
              }
            } else if (st.size !== meta.size) {
              await this._clearPartial(url);
            }
          } catch {
            /* no partial file */
          }
        }
      }
    }

    const headers: Record<string, string> = {};
    if (useRange) headers["Range"] = `bytes=${resumeFrom}-`;
    if (request?.ifNoneMatch !== undefined)
      headers["If-None-Match"] = request.ifNoneMatch;
    if (request?.ifModifiedSince !== undefined)
      headers["If-Modified-Since"] = request.ifModifiedSince;

    // Use unified transport (handles total/headers/idle timeouts, idle wrapping, abort composition)
    const transportResponse = await this._transport.fetch({
      url,
      signal,
      headers,
      timeout:
        request?.timeout !== undefined
          ? { totalMs: request.timeout }
          : undefined,
      range: useRange ? { start: resumeFrom } : undefined,
      ifNoneMatch: request?.ifNoneMatch,
      ifModifiedSince: request?.ifModifiedSince,
    });
    // Adapt transport response to fetch-like shape for existing logic
    const response = {
      status: transportResponse.status,
      ok: transportResponse.ok,
      statusText: String(transportResponse.status),
      headers: {
        get: (name: string) =>
          transportResponse.headers[name.toLowerCase()] ?? null,
      },
      body: transportResponse.body,
    } as unknown as Response;

    // Handle resume: if we sent Range but got 200 instead of 206, discard partial
    let resumed = false;
    if (useRange && response.status === 200) {
      await this._clearPartial(url);
      existingPartialSize = 0;
      resumed = false;
    } else if (useRange && response.status === 206) {
      resumed = true;
    }

    if (!response.ok && response.status !== 206) {
      // Rate-limit handling: honor Retry-After
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const retryAfterMs =
          retryAfter !== null ? parseInt(retryAfter, 10) * 1000 : undefined;
        // Also check rate-limit reset headers
        const resetHeader =
          response.headers.get("x-ratelimit-reset") ??
          response.headers.get("ratelimit-reset");
        let resetMs: number | undefined;
        if (resetHeader !== null) {
          const resetSec = parseInt(resetHeader, 10);
          if (!isNaN(resetSec)) resetMs = resetSec * 1000 - Date.now();
        }
        throw new MarketplaceClientError("GITHUB_RATE_LIMIT", {
          message: `Rate limited: ${response.statusText}`,
          context: {
            url,
            status: response.status,
            retryAfterMs: retryAfterMs ?? resetMs,
          },
        });
      }
      if (response.status === 404) {
        throw new MarketplaceClientError("DOWNLOAD_FAILED", {
          message: `Not found: ${url}`,
          context: { url, status: 404, retryable: false },
        });
      }
      if (response.status >= 500) {
        throw new MarketplaceClientError("DOWNLOAD_FAILED", {
          message: `HTTP ${response.status}: ${response.statusText}`,
          context: { url, status: response.status, retryable: true },
        });
      }
      throw new MarketplaceClientError("DOWNLOAD_FAILED", {
        message: `HTTP ${response.status}: ${response.statusText}`,
        context: { url, status: response.status },
      });
    }
    if (response.status === 304) {
      throw new MarketplaceClientError("DOWNLOAD_FAILED", {
        message: `Not modified: ${url}`,
        context: { url, status: 304, retryable: false },
      });
    }

    const body = response.body;
    if (body === null) {
      throw new MarketplaceClientError("DOWNLOAD_FAILED", {
        message: "Response body is null",
        context: { url },
      });
    }

    const nodeStream = Readable.fromWeb(
      body as import("node:stream/web").ReadableStream<Uint8Array>,
    );

    // If resuming, we need to hash existing partial + new chunks; simplest: stream new chunks to partial file in append mode, then hash whole file
    const partialPath = this._partialPath(url);
    let fileStream;
    if (resumed) {
      // Ensure partial meta is up to date for crash recovery
      await this._savePartialMeta(url, {
        url,
        expectedSize,
        expectedChecksum: request?.expectedChecksum,
        size: existingPartialSize,
      });
      fileStream = createWriteStream(partialPath, { flags: "a" });
    } else {
      // For non-resume, write to tmpPath first, also keep partial for resume on failure
      await this._savePartialMeta(url, {
        url,
        expectedSize,
        expectedChecksum: request?.expectedChecksum,
        size: 0,
      });
      fileStream = createWriteStream(resumed ? partialPath : tmpPath);
    }

    const hash = createHash("sha256");
    let streamedSize = 0;
    // If resuming, seed hash with existing partial content
    if (resumed) {
      try {
        const existing = await readFile(partialPath);
        // existing already contains first N bytes; but we opened in append mode, so we need to hash it now
        // We already have it - hash it
        hash.update(existing.slice(0, existingPartialSize));
      } catch {
        /* ignore */
      }
      streamedSize = existingPartialSize;
    }

    const hashTransform = new PassThrough({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback) {
        streamedSize += chunk.length;
        hash.update(chunk);
        // Update partial meta periodically
        callback(undefined, chunk);
      },
    });

    const targetStream = resumed ? fileStream : fileStream;
    await pipeline(nodeStream, hashTransform, targetStream);

    // For resume path, move partial to tmpPath for finalization
    if (resumed) {
      await this._savePartialMeta(url, {
        url,
        expectedSize,
        expectedChecksum: request?.expectedChecksum,
        size: streamedSize,
      });
      // Copy partial to tmpPath for atomic finalize path
      const { copyFile } = await import("node:fs/promises");
      await copyFile(partialPath, tmpPath);
    }

    if (expectedSize !== undefined && streamedSize !== expectedSize) {
      // Keep partial for resume, don't delete
      throw new MarketplaceClientError("DOWNLOAD_FAILED", {
        message: `Downloaded size ${streamedSize} does not match expected ${expectedSize} (truncated?)`,
        context: { url, expected: expectedSize, actual: streamedSize },
      });
    }

    const checksum = hash.digest("hex");
    // Clear partial on success
    if (resumed) await this._clearPartial(url);
    else await rm(this._partialMetaPath(url), { force: true }).catch(() => {});
    return { size: streamedSize, checksum, resumed };
  }

  private async _atomicFinalize(
    tmpPath: string,
    finalPath: string,
  ): Promise<void> {
    const dir = finalPath.substring(0, finalPath.lastIndexOf("/"));
    if (dir.length > 0) {
      await this._ensureDir(dir);
    }
    await rename(tmpPath, finalPath);
  }

  private async _ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private _dedupeKey(request: DownloadRequest): string {
    return `${request.url}::${request.destination}`;
  }

  private async _hashFile(filePath: string): Promise<string> {
    const content = await readFile(filePath);
    return sha256(content);
  }

  private async _cleanupTmpDir(): Promise<number> {
    const tmpDir = this._state.paths.tmp;
    let removed = 0;

    try {
      await access(tmpDir);
    } catch {
      return 0;
    }

    const files = await readdir(tmpDir);
    const now = Date.now();
    const staleThreshold = 60 * 60 * 1000;

    for (const file of files) {
      const filePath = join(tmpDir, file);
      try {
        const fileStat = await stat(filePath);
        const age = now - fileStat.mtimeMs;
        if (age > staleThreshold) {
          await rm(filePath, { force: true });
          removed++;
        }
      } catch {
        // ignore
      }
    }

    return removed;
  }
}
