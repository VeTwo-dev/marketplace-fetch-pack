import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DownloadMetricsCollector } from "../../src/download/metrics.js";

describe("DownloadMetricsCollector", () => {
  let collector: DownloadMetricsCollector;

  beforeEach(() => {
    collector = new DownloadMetricsCollector(100);
  });

  it("records a download entry", () => {
    collector.record({
      url: "https://example.com/file.bin",
      bytes: 1024,
      durationMs: 500,
      throughputBytesPerSec: 2048,
      attempts: 1,
      fromCache: false,
      integrityVerified: true,
      retryable: false,
      timestamp: new Date().toISOString(),
    });

    const entries = collector.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe("https://example.com/file.bin");
    expect(entries[0].bytes).toBe(1024);
  });

  it("returns empty summary for no entries", () => {
    const summary = collector.getSummary();
    expect(summary.totalDownloads).toBe(0);
    expect(summary.totalBytes).toBe(0);
    expect(summary.cacheHits).toBe(0);
    expect(summary.cacheMisses).toBe(0);
  });

  it("computes summary statistics", () => {
    collector.record({
      url: "https://example.com/a.bin",
      bytes: 1000,
      durationMs: 100,
      throughputBytesPerSec: 10000,
      attempts: 1,
      fromCache: true,
      integrityVerified: true,
      retryable: false,
      timestamp: new Date().toISOString(),
    });
    collector.record({
      url: "https://example.com/b.bin",
      bytes: 2000,
      durationMs: 200,
      throughputBytesPerSec: 10000,
      attempts: 2,
      fromCache: false,
      integrityVerified: true,
      provider: "github",
      retryable: false,
      timestamp: new Date().toISOString(),
    });

    const summary = collector.getSummary();
    expect(summary.totalDownloads).toBe(2);
    expect(summary.totalBytes).toBe(3000);
    expect(summary.cacheHits).toBe(1);
    expect(summary.cacheMisses).toBe(1);
    expect(summary.retries).toBe(1);
    expect(summary.integrityChecks).toBe(2);
  });

  it("records failures", () => {
    collector.record({
      url: "https://example.com/fail.bin",
      bytes: 0,
      durationMs: 1000,
      throughputBytesPerSec: 0,
      attempts: 3,
      fromCache: false,
      integrityVerified: false,
      error: "Connection refused",
      retryable: true,
      timestamp: new Date().toISOString(),
    });

    const summary = collector.getSummary();
    expect(summary.failures).toBe(1);
    expect(summary.retries).toBe(2);
  });

  it("respects maxEntries limit", () => {
    const small = new DownloadMetricsCollector(5);
    for (let i = 0; i < 10; i++) {
      small.record({
        url: `https://example.com/${i}.bin`,
        bytes: 100,
        durationMs: 10,
        throughputBytesPerSec: 10000,
        attempts: 1,
        fromCache: false,
        integrityVerified: false,
        retryable: false,
        timestamp: new Date().toISOString(),
      });
    }
    expect(small.getEntries()).toHaveLength(5);
  });

  it("clears entries", () => {
    collector.record({
      url: "https://example.com/file.bin",
      bytes: 100,
      durationMs: 10,
      throughputBytesPerSec: 10000,
      attempts: 1,
      fromCache: false,
      integrityVerified: false,
      retryable: false,
      timestamp: new Date().toISOString(),
    });
    collector.clear();
    expect(collector.getEntries()).toHaveLength(0);
  });
});
