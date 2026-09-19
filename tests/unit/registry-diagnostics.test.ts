import { describe, it, expect } from "vitest";
import { RegistryDiagnosticsCollector } from "../../src/registry/diagnostics.js";

describe("RegistryDiagnosticsCollector", () => {
  it("records metrics", () => {
    const collector = new RegistryDiagnosticsCollector();

    collector.recordFetch(100);
    collector.recordParse(50);
    collector.recordNormalize(30);
    collector.recordIndex(20);
    collector.recordCacheLookup(10);
    collector.recordResourceLookup(5);
    collector.recordTotal(215);

    const metrics = collector.getMetrics();
    expect(metrics.fetchDurationMs).toBe(100);
    expect(metrics.parseDurationMs).toBe(50);
    expect(metrics.normalizeDurationMs).toBe(30);
    expect(metrics.indexDurationMs).toBe(20);
    expect(metrics.cacheLookupDurationMs).toBe(10);
    expect(metrics.resourceLookupDurationMs).toBe(5);
    expect(metrics.totalDurationMs).toBe(215);
  });

  it("tracks lookup stats", () => {
    const collector = new RegistryDiagnosticsCollector();

    collector.trackIdLookup();
    collector.trackIdLookup();
    collector.trackNameLookup();
    collector.trackVersionLookup();
    collector.trackCategoryLookup();
    collector.trackTagLookup();

    const stats = collector.getIndexStats();
    expect(stats.idLookupCount).toBe(2);
    expect(stats.nameLookupCount).toBe(1);
    expect(stats.versionLookupCount).toBe(1);
    expect(stats.categoryLookupCount).toBe(1);
    expect(stats.tagLookupCount).toBe(1);
  });

  it("builds diagnostics", () => {
    const collector = new RegistryDiagnosticsCollector();
    collector.recordFetch(100);
    collector.recordTotal(200);

    const diagnostics = collector.buildDiagnostics(
      null,
      null,
      "cache",
      "fresh",
      "fresh",
      "github",
    );

    expect(diagnostics.source).toBe("cache");
    expect(diagnostics.cacheState).toBe("fresh");
    expect(diagnostics.freshness).toBe("fresh");
    expect(diagnostics.provider).toBe("github");
    expect(diagnostics.resourceCount).toBe(0);
    expect(diagnostics.durationMs.total).toBe(200);
  });

  it("reset clears all state", () => {
    const collector = new RegistryDiagnosticsCollector();
    collector.recordFetch(100);
    collector.trackIdLookup();

    collector.reset();

    const metrics = collector.getMetrics();
    expect(metrics.fetchDurationMs).toBe(0);

    const stats = collector.getIndexStats();
    expect(stats.idLookupCount).toBe(0);
  });
});
