import type { RegistryResource } from "../types/registry.js";

export interface ResourceIndex {
  readonly byId: ReadonlyMap<string, RegistryResource>;
  readonly byName: ReadonlyMap<string, RegistryResource>;
  readonly byAlias: ReadonlyMap<string, string>;
  readonly byCategory: ReadonlyMap<string, ReadonlyArray<RegistryResource>>;
  readonly byTag: ReadonlyMap<string, ReadonlyArray<RegistryResource>>;
  readonly byAuthor: ReadonlyMap<string, ReadonlyArray<RegistryResource>>;
  readonly byFramework: ReadonlyMap<string, ReadonlyArray<RegistryResource>>;
  readonly versionIndex: ReadonlyMap<string, VersionIndex>;
  readonly allResources: ReadonlyArray<RegistryResource>;
  readonly totalCount: number;
}

export interface VersionIndex {
  readonly resourceId: string;
  readonly versions: ReadonlyArray<VersionEntry>;
  readonly latest: string;
  readonly sorted: boolean;
}

export interface VersionEntry {
  readonly version: string;
  readonly resource: RegistryResource;
}

export class ResourceIndexBuilder {
  build(resources: ReadonlyArray<RegistryResource>): ResourceIndex {
    const byId = new Map<string, RegistryResource>();
    const byName = new Map<string, RegistryResource>();
    const byAlias = new Map<string, string>();
    const byCategory = new Map<string, Array<RegistryResource>>();
    const byTag = new Map<string, Array<RegistryResource>>();
    const byAuthor = new Map<string, Array<RegistryResource>>();
    const byFramework = new Map<string, Array<RegistryResource>>();
    const versionIndex = new Map<string, VersionIndex>();
    const resourceVersions = new Map<string, Array<VersionEntry>>();

    const sorted = [...resources].sort((a, b) => {
      const idCmp = a.id.localeCompare(b.id);
      if (idCmp !== 0) return idCmp;
      return a.version.localeCompare(b.version);
    });

    for (const resource of sorted) {
      byId.set(resource.id, resource);
      byName.set(resource.name, resource);

      if (resource.displayName !== resource.name) {
        byAlias.set(resource.displayName, resource.id);
      }

      const catList = byCategory.get(resource.category);
      if (catList !== undefined) {
        catList.push(resource);
      } else {
        byCategory.set(resource.category, [resource]);
      }

      for (const tag of resource.tags) {
        const tagList = byTag.get(tag);
        if (tagList !== undefined) {
          tagList.push(resource);
        } else {
          byTag.set(tag, [resource]);
        }
      }

      const authorKey = resource.author.name;
      const authorList = byAuthor.get(authorKey);
      if (authorList !== undefined) {
        authorList.push(resource);
      } else {
        byAuthor.set(authorKey, [resource]);
      }

      if (resource.compatibility?.frameworks !== undefined) {
        for (const fw of resource.compatibility.frameworks) {
          const fwList = byFramework.get(fw);
          if (fwList !== undefined) {
            fwList.push(resource);
          } else {
            byFramework.set(fw, [resource]);
          }
        }
      }

      const versions = resourceVersions.get(resource.id);
      if (versions !== undefined) {
        versions.push({ version: resource.version, resource });
      } else {
        resourceVersions.set(resource.id, [
          { version: resource.version, resource },
        ]);
      }
    }

    for (const [id, entries] of resourceVersions) {
      const sortedVersions = entries.sort((a, b) =>
        b.version.localeCompare(a.version),
      );
      versionIndex.set(id, {
        resourceId: id,
        versions: sortedVersions,
        latest: sortedVersions[0]?.version ?? "",
        sorted: true,
      });
    }

    return Object.freeze({
      byId,
      byName,
      byAlias,
      byCategory: byCategory as unknown as ReadonlyMap<
        string,
        ReadonlyArray<RegistryResource>
      >,
      byTag: byTag as unknown as ReadonlyMap<
        string,
        ReadonlyArray<RegistryResource>
      >,
      byAuthor: byAuthor as unknown as ReadonlyMap<
        string,
        ReadonlyArray<RegistryResource>
      >,
      byFramework: byFramework as unknown as ReadonlyMap<
        string,
        ReadonlyArray<RegistryResource>
      >,
      versionIndex,
      allResources: sorted,
      totalCount: sorted.length,
    });
  }

  updateIncremental(
    existing: ResourceIndex,
    added: ReadonlyArray<RegistryResource>,
    removed: ReadonlyArray<string>,
    updated: ReadonlyArray<RegistryResource>,
  ): ResourceIndex {
    const current = new Map(existing.byId);

    for (const id of removed) {
      current.delete(id);
    }

    for (const resource of updated) {
      current.set(resource.id, resource);
    }

    for (const resource of added) {
      current.set(resource.id, resource);
    }

    return this.build(Array.from(current.values()));
  }
}

export function lookupByVersionIndex(
  versionIndex: VersionIndex,
  range: string,
): RegistryResource | null {
  if (range === "*" || range === "latest" || range === "") {
    return versionIndex.versions[0]?.resource ?? null;
  }

  for (const entry of versionIndex.versions) {
    if (entry.version === range) {
      return entry.resource;
    }
  }

  return null;
}

export function getVersionsForRange(
  versionIndex: VersionIndex,
  range: string,
): ReadonlyArray<VersionEntry> {
  if (range === "*" || range === "latest" || range === "") {
    return versionIndex.versions;
  }

  return versionIndex.versions.filter((entry) => entry.version === range);
}
