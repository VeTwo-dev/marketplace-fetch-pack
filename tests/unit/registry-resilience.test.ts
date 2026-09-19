import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryClient } from "../../src/registry/index.js";
import { RegistryIndexManager } from "../../src/registry/registry-index.js";
import { REGISTRY_INDEX_SCHEMA_VERSION } from "../../src/registry/index-schema.js";
import { Cache } from "../../src/cache/index.js";
import { EventBus } from "../../src/events/index.js";
import { Downloader } from "../../src/downloader/index.js";
import { MarketplaceClientError } from "../../src/errors/index.js";
import { createLogger } from "../../src/logger/index.js";
import type { ResolvedConfig } from "../../src/types/config.js";

const logger = createLogger({ prefix: "test", level: "silent" });

function makeConfig(dir: string): ResolvedConfig {
  return {
    repository: "https://github.com/test/repo",
    branch: "main",
    cache: {
      enabled: true,
      directory: join(dir, "cache"),
      maxSize: 100 * 1024 * 1024,
      ttl: 24 * 60 * 60 * 1000,
      autoClean: true,
    },
    destination: join(dir, "dest"),
    logger: { level: "silent", prefix: "test", color: false },
    plugins: [],
    hooks: {},
    autoDetect: true,
    concurrency: 5,
    timeout: 5000,
    source: "default",
    offline: false,
  };
}

describe("registry resilience", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "market-resil-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("serves stale local index when discovery fails (no empty registry)", async () => {
    const config = makeConfig(tempDir);
    const cache = new Cache(config.cache, logger);
    const events = new EventBus(logger);
    const { resolveStatePaths } = await import("../../src/state/index.js");
    const statePaths = resolveStatePaths(join(tempDir, "state"));
    const indexManager = new RegistryIndexManager(statePaths, logger);

    await indexManager.save({
      schemaVersion: REGISTRY_INDEX_SCHEMA_VERSION,
      registryVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      repository: config.repository,
      ref: "1.0.0",
      revision: { sha: "old-sha", checkedAt: new Date().toISOString() },
      resources: [
        {
          id: "stale-res",
          name: "stale-res",
          displayName: "stale-res",
          description: "stale",
          version: "1.0.0",
          category: "test",
          tags: [],
          keywords: [],
          author: { name: "t" },
          manifestPath: "res/stale-res/resource.json",
          manifestHash: "h",
          dependencies: [],
        },
      ],
      categories: [],
      metadata: {
        totalCount: 1,
        categoriesCount: 0,
        lastUpdated: new Date().toISOString(),
      },
    });

    const client = new RegistryClient(
      config,
      cache,
      events,
      logger,
      indexManager,
      // Revision moved on, but the network is dead: discovery must fail,
      // stale index must serve.
      {
        detectRevision: async () => ({
          sha: "new-sha",
          checkedAt: new Date().toISOString(),
        }),
      } as never,
    );
    client.setProvider({
      type: "github",
      name: "dead",
      readFile: async () => {
        throw new Error("network down");
      },
      getTree: async () => {
        throw new Error("network down");
      },
    } as never);

    const t0 = Date.now();
    const registry = await client.load();
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(registry.resources.map((r) => r.id)).toEqual(["stale-res"]);
  });

  it("downloader does not fall back when primary is rate-limited", async () => {
    const config = makeConfig(tempDir);
    const cache = new Cache(config.cache, logger);
    const events = new EventBus(logger);
    const rateLimit = new MarketplaceClientError("GITHUB_RATE_LIMIT", {
      message: "Rate limited",
      context: { retryAfterMs: 3600000 },
    });

    class FakeDownloader extends Downloader {
      override get primaryClient(): never {
        return {
          readText: async () => {
            throw rateLimit;
          },
        } as never;
      }
    }
    let nativeCalls = 0;
    const nativeSpy = {
      readText: async () => {
        nativeCalls++;
        return "native";
      },
    };
    const downloader = new FakeDownloader(
      config,
      cache,
      events,
      logger,
      null,
      nativeSpy as never,
    );

    const error = await downloader
      .downloadFile("some/file.json")
      .catch((e: unknown) => e);
    expect(error).toBe(rateLimit);
    expect(nativeCalls).toBe(0);
  });
});
