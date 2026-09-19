import { MarketplaceClientError, createError } from "../../src/errors/index.js";
import type { ErrorCode, ErrorSeverity } from "../../src/types/errors.js";

describe("MarketplaceClientError", () => {
  it("creates an error with default message for a given code", () => {
    const error = new MarketplaceClientError("NETWORK_ERROR");
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toBe("Network request failed");
    expect(error.name).toBe("MarketplaceClientError");
    expect(error.severity).toBe("error");
    expect(error.reason).toBe("Unable to connect to the remote server.");
    expect(error.suggestion).toBe("Check your internet connection and try again.");
    expect(error.recovery).toBe("Run `vetwo-market doctor` to diagnose network issues.");
    expect(error.documentation).toContain("network_error");
  });

  it("accepts a custom message", () => {
    const error = new MarketplaceClientError("NETWORK_ERROR", {
      message: "Custom message",
    });
    expect(error.message).toBe("Custom message");
  });

  it("stores a cause error", () => {
    const cause = new Error("original");
    const error = new MarketplaceClientError("NETWORK_ERROR", { cause });
    expect(error.cause).toBe(cause);
  });

  it("stores context", () => {
    const ctx = { resourceId: "abc" };
    const error = new MarketplaceClientError("RESOURCE_NOT_FOUND", { context: ctx });
    expect(error.context).toEqual(ctx);
  });

  it("inherits from Error", () => {
    const error = new MarketplaceClientError("UNKNOWN_ERROR");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MarketplaceClientError);
  });

  describe("severity levels", () => {
    const severityMap: Record<string, ErrorSeverity> = {
      NETWORK_ERROR: "error",
      GITHUB_RATE_LIMIT: "warning",
      INSTALL_ABORTED: "info",
      RESOURCE_INCOMPATIBLE: "warning",
      DOWNLOAD_CANCELLED: "info",
      CONFIG_NOT_FOUND: "info",
      CACHE_READ_ERROR: "warning",
      DESTINATION_EXISTS: "warning",
      VERSION_INCOMPATIBLE: "warning",
    };

    for (const [code, expectedSeverity] of Object.entries(severityMap)) {
      it(`has severity "${expectedSeverity}" for ${code}`, () => {
        const error = new MarketplaceClientError(code as ErrorCode);
        expect(error.severity).toBe(expectedSeverity);
      });
    }
  });

  describe("toJSON()", () => {
    it("returns a plain object representation", () => {
      const ctx = { key: "value" };
      const error = new MarketplaceClientError("NETWORK_ERROR", { context: ctx });
      const json = error.toJSON();

      expect(json).toEqual({
        name: "MarketplaceClientError",
        code: "NETWORK_ERROR",
        message: "Network request failed",
        reason: "Unable to connect to the remote server.",
        suggestion: "Check your internet connection and try again.",
        recovery: "Run `vetwo-market doctor` to diagnose network issues.",
        documentation: expect.stringContaining("network_error"),
        severity: "error",
        context: ctx,
      });
    });

    it("omits context when not set", () => {
      const error = new MarketplaceClientError("NETWORK_ERROR");
      const json = error.toJSON();
      expect(json.context).toBeUndefined();
    });
  });

  describe("toString()", () => {
    it("formats multi-line string output", () => {
      const error = new MarketplaceClientError("NETWORK_ERROR");
      const str = error.toString();
      expect(str).toContain("[ERROR] NETWORK_ERROR: Network request failed");
      expect(str).toContain("Reason:");
      expect(str).toContain("Suggestion:");
      expect(str).toContain("Recovery:");
    });

    it("includes context when present", () => {
      const error = new MarketplaceClientError("NETWORK_ERROR", {
        context: { foo: "bar" },
      });
      const str = error.toString();
      expect(str).toContain("Context:");
      expect(str).toContain('"foo":"bar"');
    });
  });

  describe("documentation URL", () => {
    it("builds URL from error code", () => {
      const error = new MarketplaceClientError("INSTALL_FAILED");
      expect(error.documentation).toBe(
        "https://github.com/VeTwo-dev/VeTwo-Market-Place/blob/main/docs/errors/install_failed.md",
      );
    });
  });
});

describe("createError factory", () => {
  it("returns a MarketplaceClientError", () => {
    const error = createError("NETWORK_ERROR");
    expect(error).toBeInstanceOf(MarketplaceClientError);
    expect(error.code).toBe("NETWORK_ERROR");
  });

  it("passes options through", () => {
    const cause = new Error("cause");
    const error = createError("DOWNLOAD_FAILED", {
      message: "DL failed",
      cause,
      context: { url: "https://example.com" },
    });
    expect(error.message).toBe("DL failed");
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ url: "https://example.com" });
  });

  it("works with no options", () => {
    const error = createError("UNKNOWN_ERROR");
    expect(error.message).toBe("Unknown error");
  });
});

describe("all error codes have required fields", () => {
  const ALL_ERROR_CODES: ErrorCode[] = [
    "NETWORK_ERROR",
    "GITHUB_API_ERROR",
    "GITHUB_RATE_LIMIT",
    "REGISTRY_NOT_FOUND",
    "REGISTRY_INVALID",
    "REGISTRY_LOAD_FAILED",
    "RESOURCE_NOT_FOUND",
    "RESOURCE_INVALID",
    "RESOURCE_INCOMPATIBLE",
    "MANIFEST_NOT_FOUND",
    "MANIFEST_INVALID",
    "MANIFEST_PARSE_ERROR",
    "INSTALL_FAILED",
    "INSTALL_ABORTED",
    "INSTALL_TIMEOUT",
    "DOWNLOAD_FAILED",
    "DOWNLOAD_TIMEOUT",
    "DOWNLOAD_CANCELLED",
    "DEPENDENCY_CONFLICT",
    "DEPENDENCY_CIRCULAR",
    "DEPENDENCY_NOT_FOUND",
    "VERSION_NOT_FOUND",
    "VERSION_INCOMPATIBLE",
    "CACHE_READ_ERROR",
    "CACHE_WRITE_ERROR",
    "CACHE_CORRUPTED",
    "CACHE_OVERFLOW",
    "CONFIG_INVALID",
    "CONFIG_NOT_FOUND",
    "CONFIG_PARSE_ERROR",
    "PLUGIN_LOAD_FAILED",
    "PLUGIN_HOOK_ERROR",
    "PERMISSION_DENIED",
    "DISK_FULL",
    "INTEGRITY_CHECK_FAILED",
    "DESTINATION_INVALID",
    "DESTINATION_EXISTS",
    "DESTINATION_NOT_WRITABLE",
    "INTERNET_UNAVAILABLE",
    "NODE_VERSION_INCOMPATIBLE",
    "UNKNOWN_ERROR",
  ];

  for (const code of ALL_ERROR_CODES) {
    it(`${code} has all required fields`, () => {
      const error = createError(code);
      expect(error.code).toBe(code);
      expect(typeof error.message).toBe("string");
      expect(error.message.length).toBeGreaterThan(0);
      expect(typeof error.reason).toBe("string");
      expect(error.reason.length).toBeGreaterThan(0);
      expect(typeof error.suggestion).toBe("string");
      expect(error.suggestion.length).toBeGreaterThan(0);
      expect(typeof error.recovery).toBe("string");
      expect(error.recovery.length).toBeGreaterThan(0);
      expect(typeof error.documentation).toBe("string");
      expect(error.documentation).toMatch(/^https?:\/\//);
      expect(["info", "warning", "error"]).toContain(error.severity);
    });
  }
});
