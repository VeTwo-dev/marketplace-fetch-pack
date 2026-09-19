export const REGISTRY_INDEX_SCHEMA_VERSION = 4;

export interface RegistryIndex {
  readonly schemaVersion: number;
  readonly registryVersion: string;
  readonly generatedAt: string;
  readonly repository: string;
  readonly ref: string;
  readonly revision: RevisionInfo;
  readonly resources: ReadonlyArray<RegistryIndexEntry>;
  readonly categories: ReadonlyArray<RegistryIndexCategory>;
  readonly metadata: RegistryIndexMetadata;
  readonly snapshotId?: string;
  readonly freshnessPolicy?: string;
  readonly ttlMs?: number;
}

export interface RegistryIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly manifestId?: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly category: string;
  readonly tags: ReadonlyArray<string>;
  readonly keywords: ReadonlyArray<string>;
  readonly author: RegistryIndexAuthor;
  readonly manifestPath: string;
  readonly manifestHash: string;
  readonly dependencies: ReadonlyArray<RegistryIndexDependency>;
  readonly compatibility?: RegistryIndexCompatibility;
  readonly repository?: string;
  readonly homepage?: string;
  readonly license?: string;
  readonly defaultDestination?: string;
}

export interface RegistryIndexAuthor {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
  readonly github?: string;
}

export interface RegistryIndexDependency {
  readonly id: string;
  readonly version?: string;
  readonly optional?: boolean;
}

export interface RegistryIndexCompatibility {
  readonly node?: string;
  readonly frameworks?: ReadonlyArray<string>;
  readonly platforms?: ReadonlyArray<string>;
}

export interface RegistryIndexCategory {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly resourceCount: number;
}

export interface RegistryIndexMetadata {
  readonly totalCount: number;
  readonly categoriesCount: number;
  readonly lastUpdated: string;
  readonly source?: string;
}

export interface RevisionInfo {
  readonly sha?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly checkedAt: string;
}
