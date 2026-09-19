import type { Resource } from "./resource.js";

export interface Registry {
  readonly version: string;
  readonly generatedAt: string;
  readonly repository: string;
  readonly categories: ReadonlyArray<RegistryCategory>;
  readonly resources: ReadonlyArray<RegistryResource>;
  readonly metadata: RegistryMetadata;
}

export interface RegistryCategory {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly resourceCount: number;
}

export interface RegistryResource {
  readonly id: string;
  readonly name: string;
  /** Canonical `@scope/name` identifier when the manifest declares one. */
  readonly manifestId?: string;
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
  readonly size?: number;
  readonly downloads?: number;
  readonly updatedAt?: string;
}

export interface RegistryAuthor {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
  readonly github?: string;
}

export interface RegistryDependency {
  readonly id: string;
  readonly version?: string;
  readonly optional?: boolean;
}

export interface ResourceCompatibility {
  readonly node?: string;
  readonly frameworks?: ReadonlyArray<string>;
  readonly platforms?: ReadonlyArray<"linux" | "darwin" | "win32">;
}

export interface RegistryMetadata {
  readonly totalCount: number;
  readonly categoriesCount: number;
  readonly lastUpdated: string;
}

export function registryResourceToResource(
  registryResource: RegistryResource,
): Resource {
  return {
    id: registryResource.id,
    name: registryResource.name,
    displayName: registryResource.displayName,
    description: registryResource.description,
    version: registryResource.version,
    category: registryResource.category,
    tags: registryResource.tags,
    author: registryResource.author,
    files: [],
    dependencies: registryResource.dependencies,
    compatibility: registryResource.compatibility,
    repository: registryResource.repository,
    homepage: registryResource.homepage,
    license: registryResource.license,
    keywords: registryResource.keywords,
    defaultDestination: registryResource.defaultDestination,
    manifestPath: registryResource.manifestPath,
    manifestHash: registryResource.manifestHash,
    size: registryResource.size,
    downloads: registryResource.downloads,
    updatedAt: registryResource.updatedAt,
  };
}
