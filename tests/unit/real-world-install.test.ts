import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { ManifestParser } from "../../src/manifest/index.js";
import { RegistryDiscovery } from "../../src/registry/discovery.js";
import { DependencyResolver } from "../../src/dependencies/index.js";
import { TransactionManager } from "../../src/transaction/index.js";
import { MarketplaceStateManager } from "../../src/state/index.js";
import { Installer } from "../../src/installer/index.js";
import { Downloader } from "../../src/downloader/index.js";
import { VersionResolver } from "../../src/versions/index.js";
import { EventBus } from "../../src/events/index.js";
import { Cache } from "../../src/cache/index.js";
import { PluginManager } from "../../src/plugins/index.js";
import { createInstallPipeline } from "../../src/pipeline/core.js";
import { createLogger } from "../../src/logger/index.js";
import type { ResolvedConfig } from "../../src/types/config.js";
import type { RegistryResource } from "../../src/types/registry.js";
import type { RegistryProvider } from "../../src/types/providers.js";

const logger = createLogger({ prefix: "test" });

function makeConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    repository: "https://github.com/test/repo",
    branch: "main",
    cache: {
      enabled: true,
      directory: join(tmpdir(), "cfg-cache"),
      maxSize: 100 * 1024 * 1024,
      ttl: 24 * 60 * 60 * 1000,
      autoClean: true,
    },
    destination: join(tmpdir(), "cfg-dest"),
    logger: { level: "silent", prefix: "test", color: false },
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

/** Real marketplace schema: no `files`, object-form deps, scoped `id`. */
function folderManifest(
  name: string,
  id: string,
  deps: Record<string, string> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    version: "1.0.0",
    description: `Test ${name}`,
    author: { name: "Tester" },
    category: "plugins",
    tags: ["test"],
    dependencies: deps,
  };
}

function makeResource(overrides?: Partial<RegistryResource>): RegistryResource {
  return {
    id: "scope-x",
    name: "scope-x",
    displayName: "scope-x",
    description: "Test resource",
    version: "1.0.0",
    category: "plugins",
    tags: ["test"],
    author: { name: "Tester" },
    manifestPath: "res/scope-x/resource.json",
    manifestHash: "hash",
    dependencies: [],
    keywords: [],
    ...overrides,
  };
}

function makeProvider(files: Record<string, unknown>): RegistryProvider {
  return {
    type: "github",
    name: "test",
    async readFile(path: string) {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return JSON.stringify(content);
    },
    async getTree() {
      return Object.keys(files).map((path) => ({ path, type: "blob" }));
    },
  } as unknown as RegistryProvider;
}

describe("real marketplace schema (folder-based resources)", () => {
  describe("ManifestParser", () => {
    it("parses object-form dependencies", () => {
      const parser = new ManifestParser();
      const manifest = parser.parse(
        {
          name: "x",
          version: "1.0.0",
          description: "d",
          author: "a",
          category: "c",
          tags: [],
          dependencies: { "@test/dep": "^2.0.0" },
        },
        "resource.json",
        "x/resource.json",
      );
      expect(manifest.dependencies).toEqual([
        { id: "@test/dep", version: "^2.0.0", optional: false },
      ]);
    });

    it("captures the canonical scoped id", () => {
      const parser = new ManifestParser();
      const manifest = parser.parse(
        {
          id: "@test/scope-x",
          name: "scope-x",
          version: "1.0.0",
          description: "d",
          author: "a",
          category: "c",
          tags: [],
        },
        "resource.json",
        "x/resource.json",
      );
      expect(manifest.resourceId).toBe("@test/scope-x");
    });
  });

  describe("RegistryDiscovery", () => {
    it("accepts folder-schema manifests and records manifestId + deps", async () => {
      const manifest = folderManifest("scope-x", "@test/scope-x", {
        "@test/dep": "1.0.0",
      });
      const provider = makeProvider({ "res/scope-x/resource.json": manifest });
      const discovery = new RegistryDiscovery(makeConfig());
      discovery.setProvider(provider);
      const result = await discovery.discover();
      expect(result.source).toBe("manifest-scan");
      expect(result.registry.resources).toHaveLength(1);
      const res = result.registry.resources[0]!;
      expect(res.id).toBe("scope-x");
      expect(res.manifestId).toBe("@test/scope-x");
      expect(res.dependencies).toEqual([
        { id: "@test/dep", version: "1.0.0", optional: false },
      ]);
    });
  });

  describe("DependencyResolver", () => {
    it("resolves scoped dependency ids via manifestId alias", async () => {
      const resolver = new DependencyResolver();
      resolver.setResources([
        makeResource({
          id: "dep",
          name: "dep",
          manifestId: "@test/dep",
          dependencies: [],
        }),
        makeResource({
          id: "scope-x",
          name: "scope-x",
          manifestId: "@test/scope-x",
          dependencies: [{ id: "@test/dep", version: "1.0.0" }],
        }),
      ]);
      const graph = await resolver.resolve("scope-x");
      expect(graph.flat).toContain("@test/dep");
    });

    it("still resolves short-name ids (backwards compatible)", async () => {
      const resolver = new DependencyResolver();
      resolver.setResources([
        makeResource({ id: "dep", name: "dep", dependencies: [] }),
        makeResource({
          id: "scope-x",
          name: "scope-x",
          dependencies: [{ id: "dep", version: "1.0.0" }],
        }),
      ]);
      const graph = await resolver.resolve("scope-x");
      expect(graph.flat).toContain("dep");
    });
  });

  describe("TransactionManager", () => {
    let tempDir: string;
    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("self-initializes on first use (no bare ENOENT)", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "market-tx-"));
      const state = new MarketplaceStateManager(tempDir, logger);
      const tx = new TransactionManager(state, logger);
      // Deliberately NOT calling initialize(): install path defers it.
      const created = await tx.createTransaction("r", "1.0.0", ["r"]);
      expect(created.id.length).toBeGreaterThan(0);
      expect(created.status).toBe("pending");
      await tx.markCommitted(created.id);
      const reloaded = await tx.getTransaction(created.id);
      expect(reloaded?.status).toBe("committed");
    });
  });
});

describe("Installer download paths", () => {
  let tempDir: string;
  let dest: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "market-inst-"));
    dest = join(tempDir, "dest");
    await mkdir(dest, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function harness(
    fakePrimary: {
      readText: (path: string) => Promise<string>;
      downloadFolder?: (folder: string) => Promise<{
        files: ReadonlyArray<
          { path: string; stagedPath: string } | { path: string; error: Error }
        >;
        cleanup: () => Promise<void>;
      }>;
      downloadMany?: (
        paths: ReadonlyArray<string>,
      ) => Promise<
        ReadonlyArray<
          { path: string; data: Buffer } | { path: string; error: Error }
        >
      >;
    },
    opts?: { engine?: unknown },
  ) {
    const config = makeConfig({
      destination: dest,
      cache: {
        enabled: true,
        directory: join(tempDir, "cache"),
        maxSize: 100 * 1024 * 1024,
        ttl: 24 * 60 * 60 * 1000,
        autoClean: true,
      },
    });
    const events = new EventBus(logger);
    const cache = new Cache(config.cache, logger);

    class FakeDownloader extends Downloader {
      override get primaryClient(): never {
        return fakePrimary as never;
      }
      override async downloadFile(filePath: string): Promise<string> {
        return fakePrimary.readText(filePath);
      }
    }
    const downloader = new FakeDownloader(config, cache, events, logger);
    const depResolver = new DependencyResolver(logger);
    const versionResolver = new VersionResolver(logger);
    const plugins = new PluginManager(logger);
    const state = new MarketplaceStateManager(join(tempDir, "state"), logger);
    const txManager = new TransactionManager(state, logger, events);
    const pipeline = createInstallPipeline(events, logger);
    const installer = new Installer(
      config,
      downloader,
      depResolver,
      versionResolver,
      events,
      cache,
      plugins,
      {
        pipeline,
        transactionManager: txManager,
        snapshotManager: null,
        lockFileService: null,
        database: null,
      },
      logger,
      (opts?.engine !== undefined ? opts.engine : null) as never,
    );
    return { installer, depResolver };
  }

  async function listRecursive(dir: string, base = ""): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const rel = base === "" ? e.name : `${base}/${e.name}`;
      if (e.isDirectory())
        out.push(...(await listRecursive(join(dir, e.name), rel)));
      else out.push(rel);
    }
    return out.sort();
  }

  it("installs folder-based resources with real file content", async () => {
    const manifest = folderManifest("scope-x", "@test/scope-x");
    const staging = join(tempDir, "staging");
    await mkdir(join(staging, "src"), { recursive: true });
    await writeFile(join(staging, "resource.json"), JSON.stringify(manifest));
    await writeFile(join(staging, "src", "index.ts"), "export const x = 1;\n");
    const { installer, depResolver } = harness({
      readText: async () => JSON.stringify(manifest),
      downloadFolder: async () => ({
        files: [
          { path: "resource.json", stagedPath: join(staging, "resource.json") },
          {
            path: "src/index.ts",
            stagedPath: join(staging, "src", "index.ts"),
          },
        ],
        cleanup: async () => {},
      }),
    });
    const resource = makeResource({ manifestId: "@test/scope-x" });
    depResolver.setResources([resource]);

    const result = await installer.install(resource, {
      id: resource.id,
      destination: dest,
    });

    expect(result.success).toBe(true);
    expect(result.filesInstalled).toBe(2);
    const onDisk = await listRecursive(dest);
    expect(onDisk).toContain("scope-x/resource.json");
    expect(onDisk).toContain("scope-x/src/index.ts");
    // Real manifest wins over the synthesized stub.
    expect(
      JSON.parse(
        await readFile(join(dest, "scope-x", "resource.json"), "utf-8"),
      ),
    ).toMatchObject({ id: "@test/scope-x" });
    expect(
      await readFile(join(dest, "scope-x", "src", "index.ts"), "utf-8"),
    ).toBe("export const x = 1;\n");
  });

  it("fails loudly with per-file causes when nothing downloads", async () => {
    const manifest = {
      name: "scope-x",
      version: "1.0.0",
      description: "d",
      author: "a",
      category: "c",
      tags: [],
      files: [{ path: "a.txt", sha: "abc" }],
    };
    const { installer, depResolver } = harness(
      {
        readText: async () => JSON.stringify(manifest),
        downloadMany: async () => [
          {
            path: "res/scope-x/a.txt",
            error: new Error("HTTP 404: not found"),
          },
        ],
      },
      { engine: {} },
    );
    const resource = makeResource();
    depResolver.setResources([resource]);

    await expect(
      installer.install(resource, { id: resource.id, destination: dest }),
    ).rejects.toThrow(/Could not download any of 1 file\(s\).*404/);
  });

  it("installs dependency closure, not just the root", async () => {
    const rootManifest = folderManifest("root", "@test/root", {
      "@test/dep": "1.0.0",
    });
    const depManifest = folderManifest("dep", "@test/dep");
    const staging = join(tempDir, "staging");
    await mkdir(join(staging, "root"), { recursive: true });
    await mkdir(join(staging, "dep"), { recursive: true });
    await writeFile(
      join(staging, "root", "resource.json"),
      JSON.stringify(rootManifest),
    );
    await writeFile(join(staging, "root", "main.ts"), "root\n");
    await writeFile(
      join(staging, "dep", "resource.json"),
      JSON.stringify(depManifest),
    );
    await writeFile(join(staging, "dep", "lib.ts"), "dep\n");
    const { installer, depResolver } = harness({
      readText: async (path: string) =>
        JSON.stringify(path.includes("/dep/") ? depManifest : rootManifest),
      downloadFolder: async (folder: string) => {
        const name = folder.split("/").pop() ?? folder;
        const base = join(staging, name);
        return {
          files: [
            { path: "resource.json", stagedPath: join(base, "resource.json") },
            {
              path: name === "root" ? "main.ts" : "lib.ts",
              stagedPath: join(base, name === "root" ? "main.ts" : "lib.ts"),
            },
          ],
          cleanup: async () => {},
        };
      },
    });
    const root = makeResource({
      id: "root",
      name: "root",
      manifestId: "@test/root",
      manifestPath: "res/root/resource.json",
      dependencies: [{ id: "@test/dep", version: "1.0.0" }],
    });
    const dep = makeResource({
      id: "dep",
      name: "dep",
      manifestId: "@test/dep",
      manifestPath: "res/dep/resource.json",
    });
    depResolver.setResources([root, dep]);

    const result = await installer.install(root, {
      id: root.id,
      destination: dest,
    });

    expect(result.success).toBe(true);
    expect(result.dependenciesInstalled).toBe(1);
    const onDisk = await listRecursive(dest);
    expect(onDisk).toContain("root/main.ts");
    expect(onDisk).toContain("dep/lib.ts");
  });
});
