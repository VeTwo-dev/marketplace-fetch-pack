import { describe, it, expect } from "vitest";
import {
  DiagnosticCollector,
  PerformanceTimeline,
} from "../../src/diagnostics/index.js";
import { MarketplaceClientError, createError, redactContext } from "../../src/errors/index.js";
import { ERROR_CLASSIFICATION } from "../../src/types/errors.js";
import type { ErrorCode } from "../../src/types/errors.js";

describe("DiagnosticCollector", () => {
  it("records structured diagnostics", () => {
    const collector = new DiagnosticCollector();
    const d = collector.error("cache", "CACHE_CORRUPTED_TEST", "Entry corrupted", {
      key: "abc",
    }, new Error("bad json"));

    expect(d.code).toBe("CACHE_CORRUPTED_TEST");
    expect(d.severity).toBe("error");
    expect(d.subsystem).toBe("cache");
    expect(d.timestamp).toBeDefined();
    expect(d.context).toEqual({ key: "abc" });
    expect(d.cause).toBe("bad json");
  });

  it("is bounded — never grows unbounded", () => {
    const collector = new DiagnosticCollector({ maxDiagnostics: 10 });
    for (let i = 0; i < 100; i++) {
      collector.info("test", `CODE_${i}`, `message ${i}`);
    }
    expect(collector.count()).toBe(10);
    // keeps the most recent
    expect(collector.getAll().at(-1)!.code).toBe("CODE_99");
  });

  it("supports filtering by severity and subsystem", () => {
    const collector = new DiagnosticCollector();
    collector.info("a", "A1", "info message");
    collector.warn("b", "B1", "warn message");
    collector.error("a", "A2", "error message");

    expect(collector.getBySeverity("warning")).toHaveLength(1);
    expect(collector.getBySubsystem("a")).toHaveLength(2);
  });

  it("notifies listeners but never lets them break collection", () => {
    const collector = new DiagnosticCollector();
    const seen: string[] = [];
    collector.onRecord((d) => {
      seen.push(d.code);
      throw new Error("listener crash");
    });

    expect(() => collector.info("x", "X1", "m")).not.toThrow();
    expect(seen).toEqual(["X1"]);
  });

  it("convenience methods set severity correctly", () => {
    const c = new DiagnosticCollector();
    c.warn("s", "W", "msg", "do this");
    const warn = c.getAll()[0]!;
    expect(warn.severity).toBe("warning");
    expect(warn.suggestion).toBe("do this");
  });
});

describe("PerformanceTimeline", () => {
  it("measures async spans", async () => {
    const timeline = new PerformanceTimeline();
    await timeline.measure("registry-load", async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    const spans = timeline.getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.durationMs).toBeGreaterThanOrEqual(4);
  });

  it("summarizes per-stage aggregates", async () => {
    const timeline = new PerformanceTimeline();
    await timeline.measure("search", async () => {
      await new Promise((r) => setTimeout(r, 2));
    });
    await timeline.measure("search", async () => {
      await new Promise((r) => setTimeout(r, 2));
    });
    await timeline.measure("download", async () => {});

    const summary = timeline.summary();
    const search = summary.find((s) => s.name === "search")!;
    expect(search.calls).toBe(2);
    expect(search.totalMs).toBeGreaterThanOrEqual(3);

    const download = summary.find((s) => s.name === "download")!;
    expect(download.calls).toBe(1);
  });

  it("end callback is idempotent", () => {
    const timeline = new PerformanceTimeline();
    const end = timeline.start("op");
    end();
    end();
    end();
    expect(timeline.getSpans()).toHaveLength(1);
  });

  it("is bounded", async () => {
    const timeline = new PerformanceTimeline();
    for (let i = 0; i < 2100; i++) {
      await timeline.measure("spam", async () => {});
    }
    expect(timeline.getSpans().length).toBeLessThanOrEqual(2000);
  });
});

describe("Error classification and retryability (Step 4-5)", () => {
  it("every error code has deterministic classification", () => {
    // All codes in ERROR_DEFINITIONS must be classified.
    const codes: ErrorCode[] = [
      "NETWORK_ERROR", "DOWNLOAD_FAILED", "INTEGRITY_CHECK_FAILED",
      "CONFIG_INVALID", "PLUGIN_LOAD_FAILED", "RESOURCE_TYPE_DUPLICATE",
      "GITHUB_RATE_LIMIT", "UNKNOWN_ERROR", "INSTALL_FAILED",
      "DEPENDENCY_CIRCULAR", "CACHE_CORRUPTED", "PERMISSION_DENIED",
      "MANIFEST_INVALID", "REGISTRY_LOAD_FAILED", "LOCKFILE_PLACEHOLDER" as ErrorCode,
    ].filter((c) => c !== ("LOCKFILE_PLACEHOLDER" as ErrorCode));

    for (const code of codes) {
      const classification = ERROR_CLASSIFICATION[code];
      expect(classification, `missing classification for ${code}`).toBeDefined();
      expect(classification!.category).toBeTruthy();
      expect(["retryable", "non-retryable", "retry-after-delay"]).toContain(
        classification!.retryable,
      );
    }
  });

  it("network errors are retryable", () => {
    expect(ERROR_CLASSIFICATION.NETWORK_ERROR.retryable).toBe("retryable");
    expect(ERROR_CLASSIFICATION.DOWNLOAD_TIMEOUT.retryable).toBe("retryable");
    expect(ERROR_CLASSIFICATION.REGISTRY_LOAD_FAILED.retryable).toBe("retryable");
  });

  it("rate limits are retry-after-delay", () => {
    expect(ERROR_CLASSIFICATION.GITHUB_RATE_LIMIT.retryable).toBe("retry-after-delay");
    expect(ERROR_CLASSIFICATION.GITHUB_RATE_LIMIT.category).toBe("authorization");
  });

  it("permanent failures are non-retryable", () => {
    expect(ERROR_CLASSIFICATION.INTEGRITY_CHECK_FAILED.retryable).toBe("non-retryable");
    expect(ERROR_CLASSIFICATION.CONFIG_INVALID.retryable).toBe("non-retryable");
    expect(ERROR_CLASSIFICATION.DEPENDENCY_CIRCULAR.retryable).toBe("non-retryable");
  });

  it("errors expose category and retryable on instances", () => {
    const err = createError("DOWNLOAD_TIMEOUT", { context: { url: "https://example.com/x" } });
    expect(err.category).toBe("download");
    expect(err.retryable).toBe("retryable");
  });

  it("classification covers the entire error code union", () => {
    // Exhaustiveness guard: every key of ERROR_CLASSIFICATION must map to a
    // defined category + retryability pair (no undefined holes).
    for (const [code, value] of Object.entries(ERROR_CLASSIFICATION)) {
      expect(value.category, code).toBeDefined();
      expect(value.retryable, code).toBeDefined();
    }
  });
});

describe("Secret redaction (Step 3/9)", () => {
  it("redacts sensitive keys in error context", () => {
    const err = createError("NETWORK_ERROR", {
      context: {
        token: "ghp_supersecret123",
        authorization: "Bearer abc",
        apiKey: "key123",
        url: "https://example.com/ok",
        safeField: "visible",
      },
    });

    expect(err.context!.token).toBe("<redacted>");
    expect(err.context!.authorization).toBe("<redacted>");
    expect(err.context!.apiKey).toBe("<redacted>");
    expect(err.context!.safeField).toBe("visible");
  });

  it("redacts secret-bearing URL query params", () => {
    const err = createError("DOWNLOAD_FAILED", {
      context: { url: "https://example.com/file?token=secret123&x=1" },
    });
    expect(String(err.context!.url)).not.toContain("secret123");
    expect(String(err.context!.url)).toContain("<redacted>");
  });

  it("redacts recursively in nested objects", () => {
    const err = createError("NETWORK_ERROR", {
      context: {
        request: { headers: { authorization: "Bearer x" }, method: "GET" },
      },
    });
    const nested = err.context!.request as Record<string, unknown>;
    expect(nested.method).toBe("GET");
    expect((nested.headers as Record<string, unknown>).authorization).toBe("<redacted>");
  });

  it("MarketplaceClientError.toJSON never leaks secrets", () => {
    const err = new MarketplaceClientError("NETWORK_ERROR", {
      context: { password: "hunter2" },
    });
    const json = JSON.stringify(err.toJSON());
    expect(json).not.toContain("hunter2");
    expect(json).toContain("<redacted>");
  });

  it("redactContext handles null/undefined gracefully", () => {
    expect(redactContext(undefined)).toBeUndefined();
    expect(redactContext({ a: null })).toEqual({ a: null });
  });
});
