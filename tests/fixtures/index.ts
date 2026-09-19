import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Reusable deterministic test fixtures for Phase 15/16 tests.
 * All state is isolated under a temp directory — never the real project.
 */

export interface TestProject {
  readonly root: string;
  readonly stateRoot: string;
}

export async function createIsolatedProject(
  prefix = "vetwo-test-",
): Promise<TestProject> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return { root, stateRoot: join(root, ".vetwo", "marketplace") };
}

// ─── Registry fixtures ────────────────────────────────────────────────

function makeRegistryResource(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id,
    displayName: `Resource ${id}`,
    description: `Test resource ${id}`,
    version: "1.0.0",
    category: "test",
    tags: ["test"],
    author: { name: "tester", url: null },
    manifestPath: `${id}/resource.json`,
    manifestHash: `hash-${id}`,
    dependencies: [],
    keywords: ["test"],
    ...overrides,
  };
}

export function makeRegistry(
  resourceIds: ReadonlyArray<string>,
): Record<string, unknown> {
  const resources = resourceIds.map((id) => makeRegistryResource(id));
  const categories = Array.from(new Set(resources.map((r) => r.category)));
  return {
    version: "1.0.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    repository: "test/local",
    categories: categories.map((c) => ({ id: c, name: c, description: c })),
    resources,
    metadata: {
      totalCount: resources.length,
      categoriesCount: categories.length,
      lastUpdated: "2026-01-01T00:00:00.000Z",
    },
  };
}

export async function writeRegistryFile(
  project: TestProject,
  resourceIds: ReadonlyArray<string>,
): Promise<void> {
  await mkdir(project.root, { recursive: true });
  await writeFile(
    join(project.root, "registry.json"),
    JSON.stringify(makeRegistry(resourceIds)),
    "utf-8",
  );
}

/** Generates n deterministic resources for load testing. */
export function generateResources(n: number): ReadonlyArray<string> {
  return Array.from({ length: n }, (_, i) => `resource-${String(i).padStart(4, "0")}`);
}

// ─── Manifest fixtures ───────────────────────────────────────────────

function makeManifest(id: string): Record<string, unknown> {
  return {
    name: id,
    displayName: `Resource ${id}`,
    version: "1.0.0",
    description: `Manifest for ${id}`,
    type: "plugin",
    files: [{ path: `${id}.txt`, content: `content of ${id}` }],
  };
}

// ─── Corruption fixtures ─────────────────────────────────────────────

async function corruptFile(path: string): Promise<void> {
  await writeFile(path, "{{{ not valid json !!!", "utf-8");
}

async function createCorruptedCache(project: TestProject): Promise<string> {
  const cacheDir = join(project.stateRoot, "cache");
  await mkdir(cacheDir, { recursive: true });
  const entryPath = join(cacheDir, "corrupted-entry.json");
  await corruptFile(entryPath);
  return entryPath;
}

function makeCorruptedLockfile(): string {
  return JSON.stringify({
    version: "1.0.0",
    lockfileVersion: 2,
    resources: [
      {
        // missing required fields
        id: "broken-resource",
      },
    ],
  });
}

function makeLockfileWithStaleLockTimestamp(): Record<string, unknown> {
  return {
    version: "1.0.0",
    generatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lockfileVersion: 2,
    resources: [],
  };
}

// ─── Plugin fixtures ─────────────────────────────────────────────────

function makeTestPlugin(
  id: string,
  options: {
    capabilities?: ReadonlyArray<string>;
    failing?: boolean;
    marketplaceVersion?: string;
  } = {},
): Record<string, unknown> {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      description: `Fixture plugin ${id}`,
      author: "fixtures",
      capabilities: options.capabilities ?? [],
      ...(options.marketplaceVersion !== undefined
        ? { marketplaceVersion: options.marketplaceVersion }
        : {}),
    },
    hooks: {
      onInitialize: options.failing
        ? () => {
            throw new Error(`Plugin ${id} intentionally failed`);
          }
        : () => {},
    },
  };
}
