import { describe, it, expect } from "vitest";
import {
  validateMarketplaceConfig,
  validateResolvedConfig,
  ensureValidConfig,
  redactSecrets,
  freezeConfig,
} from "../../src/config/validate.js";
import type {
  MarketplaceConfig,
  ResolvedConfig,
} from "../../src/types/config.js";

function makeResolvedConfig(
  overrides?: Partial<ResolvedConfig>,
): ResolvedConfig {
  return {
    repository: "https://github.com/VeTwo-dev/VeTwo-Market-Place",
    branch: "main",
    cache: {
      enabled: true,
      directory: "/tmp/cache",
      maxSize: 100 * 1024 * 1024,
      ttl: 24 * 60 * 60 * 1000,
      autoClean: true,
    },
    destination: "/tmp/dest",
    logger: { level: "info", prefix: "test", color: false },
    plugins: [],
    hooks: {},
    autoDetect: true,
    concurrency: 5,
    timeout: 30000,
    source: "default",
    offline: false,
    ...overrides,
  };
}

describe("validateMarketplaceConfig", () => {
  it("accepts valid config", () => {
    const config: MarketplaceConfig = {
      repository: "https://github.com/user/repo",
      branch: "main",
      concurrency: 5,
      timeout: 30000,
      logger: { level: "info" },
    };
    const result = validateMarketplaceConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid URL", () => {
    const result = validateMarketplaceConfig({
      repository: "not-a-url",
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toBe("repository");
  });

  it("rejects empty branch", () => {
    const result = validateMarketplaceConfig({
      branch: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toBe("branch");
  });

  it("rejects negative concurrency", () => {
    const result = validateMarketplaceConfig({
      concurrency: -1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toBe("concurrency");
  });

  it("rejects zero timeout", () => {
    const result = validateMarketplaceConfig({
      timeout: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toBe("timeout");
  });

  it("rejects invalid log level", () => {
    const result = validateMarketplaceConfig({
      logger: { level: "verbose" as any },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toBe("logger.level");
  });

  it("rejects negative cache maxSize", () => {
    const result = validateMarketplaceConfig({
      cache: { maxSize: -100 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toBe("cache.maxSize");
  });

  it("collects multiple errors", () => {
    const result = validateMarketplaceConfig({
      repository: "bad",
      concurrency: -1,
      timeout: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts empty config", () => {
    const result = validateMarketplaceConfig({});
    expect(result.valid).toBe(true);
  });
});

describe("validateResolvedConfig", () => {
  it("accepts valid resolved config", () => {
    const result = validateResolvedConfig(makeResolvedConfig());
    expect(result.valid).toBe(true);
  });

  it("rejects invalid repository URL", () => {
    const result = validateResolvedConfig(
      makeResolvedConfig({ repository: "not-a-url" }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects offline that is not boolean", () => {
    const result = validateResolvedConfig(
      makeResolvedConfig({ offline: "yes" as any }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.path).toBe("offline");
  });

  it("accepts offline true", () => {
    const result = validateResolvedConfig(
      makeResolvedConfig({ offline: true }),
    );
    expect(result.valid).toBe(true);
  });
});

describe("ensureValidConfig", () => {
  it("does not throw for valid config", () => {
    expect(() => ensureValidConfig(makeResolvedConfig())).not.toThrow();
  });

  it("throws CONFIG_INVALID for invalid config", () => {
    try {
      ensureValidConfig(makeResolvedConfig({ concurrency: -1 }));
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.code).toBe("CONFIG_INVALID");
    }
  });
});

describe("redactSecrets", () => {
  it("redacts token field", () => {
    const result = redactSecrets({ token: "ghp_1234567890abcdef" });
    expect(result.token).toMatch(/^\w{4}\*\*\*\w{4}$/);
    expect(result.token).not.toBe("ghp_1234567890abcdef");
  });

  it("redacts nested secrets", () => {
    const result = redactSecrets({
      auth: { token: "secret1234567890" },
    });
    expect((result.auth as any).token).toMatch(/^\w{4}\*\*\*\w{4}$/);
  });

  it("short strings are fully redacted", () => {
    const result = redactSecrets({ token: "abc" });
    expect(result.token).toBe("***");
  });

  it("does not redact non-sensitive fields", () => {
    const result = redactSecrets({ name: "test", count: 42 });
    expect(result.name).toBe("test");
    expect(result.count).toBe(42);
  });
});

describe("freezeConfig", () => {
  it("returns a frozen object", () => {
    const config = makeResolvedConfig();
    const frozen = freezeConfig(config);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it("freezes nested objects", () => {
    const config = makeResolvedConfig();
    const frozen = freezeConfig(config);
    expect(Object.isFrozen(frozen.cache)).toBe(true);
    expect(Object.isFrozen(frozen.logger)).toBe(true);
    expect(Object.isFrozen(frozen.hooks)).toBe(true);
  });

  it("throws on mutation attempt", () => {
    const config = makeResolvedConfig();
    const frozen = freezeConfig(config);
    expect(() => {
      (frozen as any).repository = "changed";
    }).toThrow();
  });
});
