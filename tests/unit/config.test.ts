import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigManager } from "../../src/config/index.js";

describe("ConfigManager", () => {
  let manager: ConfigManager;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    manager = new ConfigManager();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("VETWO_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("initializes with defaults", () => {
    const config = manager.config;
    expect(config.repository).toBe("https://github.com/VeTwo-dev/VeTwo-Market-Place");
    expect(config.branch).toBe("main");
    expect(config.destination).toContain(".vetwo/marketplace/resources");
    expect(config.cache.enabled).toBe(true);
    expect(config.cache.directory).toContain(".vetwo/marketplace/cache");
    expect(config.cache.maxSize).toBe(100 * 1024 * 1024);
    expect(config.cache.ttl).toBe(24 * 60 * 60 * 1000);
    expect(config.cache.autoClean).toBe(true);
    expect(config.logger.level).toBe("info");
    expect(config.logger.prefix).toBe("marketplace");
    expect(config.logger.color).toBe(true);
    expect(config.autoDetect).toBe(true);
    expect(config.concurrency).toBe(5);
    expect(config.timeout).toBe(30000);
    expect(config.source).toBe("default");
    expect(config.plugins).toEqual([]);
    expect(config.hooks).toEqual({});
  });

  describe("load()", () => {
    it("loads from programmatic config", async () => {
      const result = await manager.load({
        repository: "https://example.com/repo",
        branch: "develop",
        destination: "my/dest",
        concurrency: 10,
      });
      expect(result.repository).toBe("https://example.com/repo");
      expect(result.branch).toBe("develop");
      expect(result.destination).toBe("my/dest");
      expect(result.concurrency).toBe(10);
      expect(result.source).toBe("programmatic");
    });

    it("loads from environment variables", async () => {
      process.env.VETWO_MARKETPLACE_REPOSITORY = "https://env.repo";
      process.env.VETWO_MARKETPLACE_BRANCH = "env-branch";

      const result = await manager.load();
      expect(result.repository).toBe("https://env.repo");
      expect(result.branch).toBe("env-branch");
      expect(result.source).toBe("environment");
    });

    it("falls back to defaults when no config found", async () => {
      const result = await manager.load();
      expect(result.source).toBe("default");
      expect(result.repository).toBe("https://github.com/VeTwo-dev/VeTwo-Market-Place");
    });

    it("respects VETWO_MARKETPLACE_LOG_LEVEL env var", async () => {
      process.env.VETWO_MARKETPLACE_LOG_LEVEL = "debug";
      const result = await manager.load();
      expect(result.logger.level).toBe("debug");
    });

    it("respects VETWO_MARKETPLACE_CACHE_DIR env var", async () => {
      process.env.VETWO_MARKETPLACE_CACHE_DIR = "/tmp/custom-cache";
      const result = await manager.load();
      expect(result.cache.directory).toBe("/tmp/custom-cache");
    });

    it("respects VETWO_MARKETPLACE_CACHE_ENABLED env var", async () => {
      process.env.VETWO_MARKETPLACE_CACHE_ENABLED = "false";
      const result = await manager.load();
      expect(result.cache.enabled).toBe(false);
    });

    it("respects VETWO_MARKETPLACE_DESTINATION env var", async () => {
      process.env.VETWO_MARKETPLACE_DESTINATION = "/custom/dest";
      const result = await manager.load();
      expect(result.destination).toBe("/custom/dest");
    });
  });

  describe("update()", () => {
    it("merges partial config", () => {
      manager.update({ concurrency: 20 });
      expect(manager.config.concurrency).toBe(20);
      expect(manager.config.repository).toBe("https://github.com/VeTwo-dev/VeTwo-Market-Place");
    });

    it("updates multiple fields", () => {
      manager.update({ timeout: 60000, autoDetect: false });
      expect(manager.config.timeout).toBe(60000);
      expect(manager.config.autoDetect).toBe(false);
    });
  });

  describe("reset()", () => {
    it("resets to defaults", () => {
      manager.update({ concurrency: 99 });
      expect(manager.config.concurrency).toBe(99);
      manager.reset();
      expect(manager.config.concurrency).toBe(5);
      expect(manager.config.source).toBe("default");
    });
  });

  describe("programmatic config edge cases", () => {
    it("handles empty programmatic config", async () => {
      const result = await manager.load({});
      expect(result.repository).toBe("https://github.com/VeTwo-dev/VeTwo-Market-Place");
      expect(result.source).toBe("programmatic");
    });

    it("resolves cache config from input", async () => {
      const result = await manager.load({
        cache: {
          enabled: false,
          maxSize: 5000,
        },
      });
      expect(result.cache.enabled).toBe(false);
      expect(result.cache.maxSize).toBe(5000);
      expect(result.cache.directory).toContain(".vetwo/marketplace/cache");
    });

    it("resolves logger config from input", async () => {
      const result = await manager.load({
        logger: { level: "error", prefix: "custom" },
      });
      expect(result.logger.level).toBe("error");
      expect(result.logger.prefix).toBe("custom");
    });

    it("resolves hooks from input", async () => {
      const fn = () => {};
      const result = await manager.load({
        hooks: { beforeInstall: [fn as unknown as string], afterInstall: [] },
      });
      expect(result.hooks.beforeInstall).toHaveLength(1);
    });

    it("resolves plugins from input", async () => {
      const result = await manager.load({
        plugins: [{ name: "test-plugin" }],
      });
      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0]!.name).toBe("test-plugin");
    });
  });
});
