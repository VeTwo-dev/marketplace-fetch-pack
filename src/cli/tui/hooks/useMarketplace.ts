import type { Marketplace } from "../../../marketplace/index.js";
import type {
  RegistryResource,
  RegistryCategory,
} from "../../../types/registry.js";
import type { DetectedProject } from "../../../types/detection.js";

export interface MarketplaceHook {
  readonly load: () => Promise<void>;
  readonly search: (query: string) => Promise<ReadonlyArray<RegistryResource>>;
  readonly install: (
    id: string,
  ) => Promise<{ success: boolean; message: string }>;
  readonly preview: (id: string) => Promise<{ files: number; size: number }>;
  readonly getCategories: () => Promise<ReadonlyArray<RegistryCategory>>;
  readonly getResources: () => Promise<ReadonlyArray<RegistryResource>>;
  readonly detectProject: () => Promise<DetectedProject | null>;
}

export function createMarketplaceHook(
  marketplace: Marketplace,
): MarketplaceHook {
  return {
    load: async () => {
      await marketplace.load();
    },

    search: async (query: string) => {
      const result = await marketplace.search({ keyword: query });
      return result.items.map((item) => ({
        id: item.resource.id,
        name: item.resource.name,
        displayName: item.resource.displayName,
        description: item.resource.description,
        version: item.resource.version,
        category: item.resource.category,
        tags: item.resource.tags,
        author: { name: item.resource.author },
        manifestPath: "",
        manifestHash: "",
        dependencies: [],
        compatibility: undefined,
        repository: undefined,
        homepage: undefined,
        license: item.resource.license,
        keywords: [],
        defaultDestination: undefined,
      })) as unknown as ReadonlyArray<RegistryResource>;
    },

    install: async (id: string) => {
      try {
        const result = await marketplace.install({ id });
        return {
          success: result.success,
          message: result.success
            ? `Installed ${result.id}@${result.version} (${result.filesInstalled} files)`
            : `Failed to install ${id}`,
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    preview: async (id: string) => {
      const result = await marketplace.preview(id);
      return {
        files: result.wouldInstall.length,
        size: result.estimatedSize,
      };
    },

    getCategories: async () => {
      return marketplace.categories();
    },

    getResources: async () => {
      return marketplace.resources();
    },

    detectProject: async () => {
      try {
        return await marketplace.detectProject();
      } catch {
        return null;
      }
    },
  };
}
