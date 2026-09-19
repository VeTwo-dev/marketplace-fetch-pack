import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  RegistryIndex,
  RegistryIndexEntry,
  RegistryIndexCategory,
  RevisionInfo,
} from "./index-schema.js";
import { REGISTRY_INDEX_SCHEMA_VERSION } from "./index-schema.js";
import type {
  Registry,
  RegistryResource,
  ResourceCompatibility,
} from "../types/registry.js";
import type { MarketplaceStatePaths } from "../state/index.js";
import { createLogger, type Logger } from "../logger/index.js";

const INDEX_FILE = "registry-index.json";

interface IndexLoadResult {
  readonly index: RegistryIndex;
  readonly source: "local" | "fresh";
}

export class RegistryIndexManager {
  private readonly _statePaths: MarketplaceStatePaths;
  private readonly _logger: Logger;
  private _cachedIndex: RegistryIndex | null = null;

  constructor(statePaths: MarketplaceStatePaths, logger?: Logger) {
    this._statePaths = statePaths;
    this._logger = logger ?? createLogger({ prefix: "registry-index" });
  }

  get indexPath(): string {
    return join(this._statePaths.indexes, INDEX_FILE);
  }

  async loadLocal(): Promise<RegistryIndex | null> {
    if (this._cachedIndex !== null) return this._cachedIndex;

    try {
      const content = await readFile(this.indexPath, "utf-8");
      const parsed: unknown = JSON.parse(content);

      if (!this._isRegistryIndex(parsed)) {
        this._logger.warn("Local index has invalid structure, ignoring");
        return null;
      }

      if (parsed.schemaVersion !== REGISTRY_INDEX_SCHEMA_VERSION) {
        this._logger.warn("Local index schema version mismatch", {
          expected: REGISTRY_INDEX_SCHEMA_VERSION,
          actual: parsed.schemaVersion,
        });
        return null;
      }

      this._cachedIndex = parsed;
      this._logger.debug("Loaded local registry index", {
        resources: parsed.resources.length,
        categories: parsed.categories.length,
      });
      return parsed;
    } catch {
      this._logger.debug("No local registry index found");
      return null;
    }
  }

  async save(index: RegistryIndex): Promise<void> {
    await mkdir(this._statePaths.indexes, { recursive: true });

    const content = JSON.stringify(index, null, 2);
    const tmpPath = join(
      this._statePaths.tmp,
      `index-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );

    try {
      await mkdir(this._statePaths.tmp, { recursive: true });
      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, this.indexPath);
      this._cachedIndex = index;
      this._logger.debug("Registry index saved atomically", {
        resources: index.resources.length,
      });
    } catch (error) {
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tmpPath).catch(() => {});
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }

  async invalidate(): Promise<void> {
    this._cachedIndex = null;
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(this.indexPath);
    } catch {
      // index may not exist
    }
  }

  buildFromRegistry(registry: Registry, revision: RevisionInfo): RegistryIndex {
    const resources: Array<RegistryIndexEntry> = registry.resources.map((r) =>
      this._resourceToEntry(r),
    );

    const categories: Array<RegistryIndexCategory> = registry.categories.map(
      (c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        resourceCount: c.resourceCount,
      }),
    );

    return {
      schemaVersion: REGISTRY_INDEX_SCHEMA_VERSION,
      registryVersion: registry.version,
      generatedAt: new Date().toISOString(),
      repository: registry.repository,
      ref: registry.version,
      revision,
      resources,
      categories,
      metadata: {
        totalCount: resources.length,
        categoriesCount: categories.length,
        lastUpdated: new Date().toISOString(),
      },
    };
  }

  isIndexFresh(
    localIndex: RegistryIndex,
    remoteRevision: RevisionInfo,
  ): boolean {
    if (
      remoteRevision.sha !== undefined &&
      localIndex.revision.sha !== undefined
    ) {
      return localIndex.revision.sha === remoteRevision.sha;
    }

    if (
      remoteRevision.etag !== undefined &&
      localIndex.revision.etag !== undefined
    ) {
      return localIndex.revision.etag === remoteRevision.etag;
    }

    if (
      remoteRevision.lastModified !== undefined &&
      localIndex.revision.lastModified !== undefined
    ) {
      return localIndex.revision.lastModified === remoteRevision.lastModified;
    }

    return false;
  }

  async updateResource(
    resource: RegistryResource,
    revision?: RevisionInfo,
  ): Promise<void> {
    const existing = await this.loadLocal();
    if (existing === null) return;

    const entryIndex = existing.resources.findIndex(
      (r) => r.id === resource.id,
    );
    const entry = this._resourceToEntry(resource);

    let updatedResources: Array<RegistryIndexEntry>;
    if (entryIndex >= 0) {
      updatedResources = [
        ...existing.resources.slice(0, entryIndex),
        entry,
        ...existing.resources.slice(entryIndex + 1),
      ];
    } else {
      updatedResources = [...existing.resources, entry];
    }

    const updatedMetadata = {
      ...existing.metadata,
      totalCount: updatedResources.length,
      lastUpdated: new Date().toISOString(),
    };

    const updatedIndex: RegistryIndex = {
      ...existing,
      resources: updatedResources,
      metadata: updatedMetadata,
      revision: revision ?? existing.revision,
      generatedAt: new Date().toISOString(),
    };

    await this.save(updatedIndex);
  }

  async removeResource(resourceId: string): Promise<void> {
    const existing = await this.loadLocal();
    if (existing === null) return;

    const updatedResources = existing.resources.filter(
      (r) => r.id !== resourceId,
    );
    const updatedMetadata = {
      ...existing.metadata,
      totalCount: updatedResources.length,
      lastUpdated: new Date().toISOString(),
    };

    const updatedIndex: RegistryIndex = {
      ...existing,
      resources: updatedResources,
      metadata: updatedMetadata,
      generatedAt: new Date().toISOString(),
    };

    await this.save(updatedIndex);
  }

  indexToRegistry(index: RegistryIndex): Registry {
    const resources: Array<RegistryResource> = index.resources.map((entry) => ({
      id: entry.id,
      name: entry.name,
      manifestId: entry.manifestId,
      displayName: entry.displayName,
      description: entry.description,
      version: entry.version,
      category: entry.category,
      tags: entry.tags,
      author: entry.author,
      manifestPath: entry.manifestPath,
      manifestHash: entry.manifestHash,
      dependencies: entry.dependencies,
      compatibility: entry.compatibility as ResourceCompatibility | undefined,
      repository: entry.repository,
      homepage: entry.homepage,
      license: entry.license,
      keywords: entry.keywords,
      defaultDestination: entry.defaultDestination,
    }));

    const categories = index.categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      resourceCount: c.resourceCount,
    }));

    return {
      version: index.registryVersion,
      generatedAt: index.generatedAt,
      repository: index.repository,
      categories,
      resources,
      metadata: {
        totalCount: index.metadata.totalCount,
        categoriesCount: index.metadata.categoriesCount,
        lastUpdated: index.metadata.lastUpdated,
      },
    };
  }

  private _resourceToEntry(resource: RegistryResource): RegistryIndexEntry {
    return {
      id: resource.id,
      name: resource.name,
      manifestId: resource.manifestId,
      displayName: resource.displayName,
      description: resource.description,
      version: resource.version,
      category: resource.category,
      tags: resource.tags,
      keywords: resource.keywords,
      author: resource.author,
      manifestPath: resource.manifestPath,
      manifestHash: resource.manifestHash,
      dependencies: resource.dependencies,
      compatibility: resource.compatibility,
      repository: resource.repository,
      homepage: resource.homepage,
      license: resource.license,
      defaultDestination: resource.defaultDestination,
    };
  }

  private _isRegistryIndex(value: unknown): value is RegistryIndex {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj["schemaVersion"] === "number" &&
      typeof obj["registryVersion"] === "string" &&
      typeof obj["generatedAt"] === "string" &&
      typeof obj["repository"] === "string" &&
      typeof obj["ref"] === "string" &&
      typeof obj["revision"] === "object" &&
      obj["revision"] !== null &&
      Array.isArray(obj["resources"]) &&
      Array.isArray(obj["categories"]) &&
      typeof obj["metadata"] === "object" &&
      obj["metadata"] !== null
    );
  }
}

export function createRegistryIndexManager(
  statePaths: MarketplaceStatePaths,
  logger?: Logger,
): RegistryIndexManager {
  return new RegistryIndexManager(statePaths, logger);
}
