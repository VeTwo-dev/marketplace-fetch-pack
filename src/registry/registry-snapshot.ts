import type {
  Registry,
  RegistryResource,
  RegistryCategory,
  RegistryAuthor,
  RegistryDependency,
  ResourceCompatibility,
} from "../types/registry.js";
import type { RevisionInfo } from "./index-schema.js";

export interface RegistrySnapshot {
  readonly id: string;
  readonly revision: RevisionInfo;
  readonly generatedAt: string;
  readonly repository: string;
  readonly registryVersion: string;
  readonly resources: ReadonlyArray<RegistrySnapshotResource>;
  readonly categories: ReadonlyArray<RegistryCategory>;
  readonly metadata: RegistrySnapshotMetadata;
}

export interface RegistrySnapshotResource {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly category: string;
  readonly tags: ReadonlyArray<string>;
  readonly author: RegistryAuthor;
  readonly manifestPath: string;
  readonly manifestHash: string;
  readonly dependencies: ReadonlyArray<RegistryDependency>;
  readonly compatibility?: ResourceCompatibility;
  readonly repository?: string;
  readonly homepage?: string;
  readonly license?: string;
  readonly keywords: ReadonlyArray<string>;
  readonly defaultDestination?: string;
}

export interface RegistrySnapshotMetadata {
  readonly totalCount: number;
  readonly categoriesCount: number;
  readonly resourceTypeCount: number;
  readonly lastUpdated: string;
  readonly source: "registry.json" | "manifest-scan";
  readonly invalidResourceCount: number;
  readonly warningsCount: number;
}

export function createSnapshotId(
  repository: string,
  revision: RevisionInfo,
): string {
  const identity = [
    repository,
    revision.sha ?? "",
    revision.etag ?? "",
    revision.lastModified ?? "",
  ].join(":");
  return `snapshot:${identity}`;
}

export function buildRegistrySnapshot(
  registry: Registry,
  revision: RevisionInfo,
  source: "registry.json" | "manifest-scan",
  invalidCount: number = 0,
  warningsCount: number = 0,
): RegistrySnapshot {
  const resourceTypes = new Set(registry.resources.map((r) => r.category));

  const resources: Array<RegistrySnapshotResource> = registry.resources.map(
    (r) => ({
      id: r.id,
      name: r.name,
      displayName: r.displayName,
      description: r.description,
      version: r.version,
      category: r.category,
      tags: r.tags,
      author: r.author,
      manifestPath: r.manifestPath,
      manifestHash: r.manifestHash,
      dependencies: r.dependencies,
      compatibility: r.compatibility,
      repository: r.repository,
      homepage: r.homepage,
      license: r.license,
      keywords: r.keywords,
      defaultDestination: r.defaultDestination,
    }),
  );

  const id = createSnapshotId(registry.repository, revision);

  return {
    id,
    revision,
    generatedAt: registry.generatedAt,
    repository: registry.repository,
    registryVersion: registry.version,
    resources,
    categories: registry.categories,
    metadata: {
      totalCount: resources.length,
      categoriesCount: registry.categories.length,
      resourceTypeCount: resourceTypes.size,
      lastUpdated: registry.metadata.lastUpdated,
      source,
      invalidResourceCount: invalidCount,
      warningsCount,
    },
  };
}

export function snapshotToRegistry(snapshot: RegistrySnapshot): Registry {
  const resources: Array<RegistryResource> = snapshot.resources.map((r) => ({
    id: r.id,
    name: r.name,
    displayName: r.displayName,
    description: r.description,
    version: r.version,
    category: r.category,
    tags: r.tags,
    author: r.author,
    manifestPath: r.manifestPath,
    manifestHash: r.manifestHash,
    dependencies: r.dependencies,
    compatibility: r.compatibility,
    repository: r.repository,
    homepage: r.homepage,
    license: r.license,
    keywords: r.keywords,
    defaultDestination: r.defaultDestination,
  }));

  return {
    version: snapshot.registryVersion,
    generatedAt: snapshot.generatedAt,
    repository: snapshot.repository,
    categories: snapshot.categories,
    resources,
    metadata: {
      totalCount: snapshot.metadata.totalCount,
      categoriesCount: snapshot.metadata.categoriesCount,
      lastUpdated: snapshot.metadata.lastUpdated,
    },
  };
}
