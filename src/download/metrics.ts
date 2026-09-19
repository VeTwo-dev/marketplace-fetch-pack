export interface DownloadMetricsEntry {
  readonly url: string;
  readonly resourceId?: string;
  readonly bytes: number;
  readonly durationMs: number;
  readonly throughputBytesPerSec: number;
  readonly attempts: number;
  readonly fromCache: boolean;
  readonly integrityVerified: boolean;
  readonly provider?: string;
  readonly queueWaitMs?: number;
  readonly downloadMs?: number;
  readonly integrityMs?: number;
  readonly error?: string;
  readonly retryable: boolean;
  readonly timestamp: string;
}

export interface DownloadMetricsSummary {
  readonly totalDownloads: number;
  readonly totalBytes: number;
  readonly totalDurationMs: number;
  readonly avgThroughputBytesPerSec: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly retries: number;
  readonly failures: number;
  readonly integrityChecks: number;
  readonly integrityFailures: number;
}

export class DownloadMetricsCollector {
  private readonly _entries: Array<DownloadMetricsEntry> = [];
  private readonly _maxEntries: number;

  constructor(maxEntries: number = 1000) {
    this._maxEntries = maxEntries;
  }

  record(entry: DownloadMetricsEntry): void {
    this._entries.push(entry);
    if (this._entries.length > this._maxEntries) {
      this._entries.shift();
    }
  }

  getEntries(): ReadonlyArray<DownloadMetricsEntry> {
    return this._entries;
  }

  getSummary(): DownloadMetricsSummary {
    const total = this._entries.length;
    if (total === 0) {
      return {
        totalDownloads: 0,
        totalBytes: 0,
        totalDurationMs: 0,
        avgThroughputBytesPerSec: 0,
        cacheHits: 0,
        cacheMisses: 0,
        retries: 0,
        failures: 0,
        integrityChecks: 0,
        integrityFailures: 0,
      };
    }

    let totalBytes = 0;
    let totalDurationMs = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    let retries = 0;
    let failures = 0;
    let integrityChecks = 0;
    let integrityFailures = 0;

    for (const entry of this._entries) {
      totalBytes += entry.bytes;
      totalDurationMs += entry.durationMs;
      if (entry.fromCache) cacheHits++;
      else cacheMisses++;
      if (entry.attempts > 1) retries += entry.attempts - 1;
      if (entry.error !== undefined) failures++;
      if (entry.integrityVerified) integrityChecks++;
      if (entry.integrityVerified && entry.error !== undefined)
        integrityFailures++;
    }

    return {
      totalDownloads: total,
      totalBytes,
      totalDurationMs,
      avgThroughputBytesPerSec:
        totalDurationMs > 0 ? (totalBytes / totalDurationMs) * 1000 : 0,
      cacheHits,
      cacheMisses,
      retries,
      failures,
      integrityChecks,
      integrityFailures,
    };
  }

  clear(): void {
    this._entries.length = 0;
  }
}
