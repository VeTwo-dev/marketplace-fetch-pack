import type {
  Registry,
  RegistryCategory,
  RegistryResource,
  RegistryAuthor,
} from "../types/registry.js";
import type { ManifestFileName } from "../types/manifest.js";
import type { ResolvedConfig } from "../types/config.js";
import type { RegistryProvider } from "../types/providers.js";
import { MANIFEST_FILE_NAMES } from "../types/manifest.js";
import { MarketplaceClientError } from "../errors/index.js";
import { ManifestParser } from "../manifest/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256, groupBy } from "../utils/index.js";
import { GitHubRepositoryTransport } from "../transport/github-repository.js";
import { RepoFetchClient } from "./repo-fetch-client.js";

const REGISTRY_FILE = "registry.json";

interface ProviderBackedFetcher {
  readonly readFile: (path: string) => Promise<string>;
  readonly getTree: () => Promise<
    ReadonlyArray<{ readonly path: string; readonly type: string }>
  >;
}

export interface DiscoveryResult {
  readonly registry: Registry;
  readonly source: "registry.json" | "manifest-scan";
  readonly warnings: ReadonlyArray<DiscoveryWarning>;
}

export interface DiscoveryWarning {
  readonly type:
    "duplicate-resource" | "invalid-manifest" | "missing-field" | "parse-error";
  readonly path: string;
  readonly message: string;
  readonly details?: unknown;
}

interface ManifestFile {
  readonly path: string;
  readonly fileName: ManifestFileName;
}

export class RegistryDiscovery {
  private readonly _config: ResolvedConfig;
  private readonly _manifestParser: ManifestParser;
  private readonly _logger: Logger;
  private readonly _repos: GitHubRepositoryTransport;
  /** Primary fetch (repo-fetch package); native transport is the fallback. */
  private readonly _primary: RepoFetchClient;
  private _provider: RegistryProvider | null = null;

  constructor(config: ResolvedConfig, logger?: Logger) {
    this._config = config;
    this._logger = logger ?? createLogger({ prefix: "registry-discovery" });
    this._manifestParser = new ManifestParser(this._logger);
    this._repos = new GitHubRepositoryTransport(
      {
        repository: config.repository,
        branch: config.branch,
        timeout: config.timeout,
        token: config.token,
      },
      undefined,
      undefined,
      this._logger.child("repos"),
    );
    this._primary = new RepoFetchClient(
      {
        repository: config.repository,
        branch: config.branch,
        timeout: config.timeout,
        token: config.token,
        offline: config.offline,
      },
      this._logger.child("primary"),
    );
  }

  setProvider(provider: RegistryProvider): void {
    this._provider = provider;
  }

  private _getFetchProvider(): ProviderBackedFetcher {
    if (this._provider !== null) {
      return {
        readFile: (path: string) => this._provider!.readFile(path),
        getTree: () => this._provider!.getTree(),
      };
    }
    // Primary: repo-fetch package. Fallback: native transport (offline-aware,
    // ETag-cached). Fallback runs only after primary has fully failed, so
    // retries are never multiplied across layers for a single read.
    return {
      readFile: (path) =>
        this._withFallback(
          () => this._primary.readText(path),
          () => this._repos.readText(path),
          `read ${path}`,
        ),
      getTree: () =>
        this._withFallback(
          () => this._primary.getTree(),
          () => this._repos.getTree(),
          "tree",
        ),
    };
  }

  private async _withFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
    operation: string,
  ): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      // Rate-limited: the fallback would hit the same wall — fail fast
      // with the classified error instead of doubling quota burn + latency.
      if (
        error instanceof MarketplaceClientError &&
        error.code === "GITHUB_RATE_LIMIT"
      ) {
        throw error;
      }
      this._logger.debug(
        `Primary fetch failed (${operation}), using fallback`,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return fallback();
    }
  }

  async discover(): Promise<DiscoveryResult> {
    try {
      const result = await this._loadRegistryJson();
      this._logger.info("Loaded registry from registry.json");
      return result;
    } catch (error) {
      if (
        error instanceof MarketplaceClientError &&
        error.code === "REGISTRY_NOT_FOUND"
      ) {
        this._logger.info("registry.json not found, scanning manifests");
        return this._scanAndBuildRegistry();
      }
      throw error;
    }
  }

  private async _loadRegistryJson(): Promise<DiscoveryResult> {
    try {
      const fetchProvider = this._getFetchProvider();
      const content = await fetchProvider.readFile(REGISTRY_FILE);
      const parsed: unknown = JSON.parse(content);

      if (!this._isRegistry(parsed)) {
        throw new MarketplaceClientError("REGISTRY_INVALID", {
          message: "registry.json has invalid structure",
        });
      }

      return {
        registry: parsed,
        source: "registry.json",
        warnings: [],
      };
    } catch (error) {
      if (error instanceof MarketplaceClientError) throw error;
      throw new MarketplaceClientError("REGISTRY_NOT_FOUND", {
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private async _scanAndBuildRegistry(): Promise<DiscoveryResult> {
    const fetchProvider = this._getFetchProvider();
    const tree = await fetchProvider.getTree();

    const manifestFiles = this._findManifests(tree);

    if (manifestFiles.length === 0) {
      throw new MarketplaceClientError("REGISTRY_NOT_FOUND", {
        message:
          "No resource manifests found. Expected resource.json, manifest.json, vetwo.json, or package.json with vetwo.resource",
        context: {
          repository: this._config.repository,
          branch: this._config.branch,
          searchedNames: [...MANIFEST_FILE_NAMES],
        },
      });
    }

    const warnings: Array<DiscoveryWarning> = [];
    const resources: Array<RegistryResource> = [];
    const seenIds = new Map<string, string>();

    for (const manifestFile of manifestFiles) {
      try {
        const fetchProvider = this._getFetchProvider();
        const content = await fetchProvider.readFile(manifestFile.path);
        const parsed: unknown = JSON.parse(content);

        if (!this._isRecord(parsed)) {
          warnings.push({
            type: "parse-error",
            path: manifestFile.path,
            message: "File is not a valid JSON object",
          });
          continue;
        }

        const manifest = this._manifestParser.parse(
          parsed,
          manifestFile.fileName,
          manifestFile.path,
        );

        const validationErrors = this._manifestParser.validate(manifest);
        if (validationErrors.length > 0) {
          warnings.push({
            type: "invalid-manifest",
            path: manifestFile.path,
            message: `Validation failed: ${validationErrors.join("; ")}`,
            details: validationErrors,
          });
          continue;
        }

        const existingPath = seenIds.get(manifest.name);
        if (existingPath !== undefined) {
          warnings.push({
            type: "duplicate-resource",
            path: manifestFile.path,
            message: `Duplicate resource "${manifest.name}" — first seen at ${existingPath}, skipping this copy`,
            details: {
              firstPath: existingPath,
              duplicatePath: manifestFile.path,
            },
          });
          continue;
        }
        seenIds.set(manifest.name, manifestFile.path);

        const resource: RegistryResource = {
          id: manifest.name,
          name: manifest.name,
          manifestId: manifest.resourceId,
          displayName: manifest.name,
          description: manifest.description,
          version: manifest.version,
          category: manifest.category,
          tags: manifest.tags,
          author: this._normalizeAuthor(manifest.author),
          manifestPath: manifestFile.path,
          manifestHash: sha256(content),
          dependencies: (manifest.dependencies ?? []).map((d) => ({
            id: d.id,
            version: d.version,
            optional: d.optional,
          })),
          compatibility: manifest.compatibility,
          repository: manifest.repository,
          homepage: manifest.homepage,
          license: manifest.license,
          keywords: manifest.keywords ?? [],
          defaultDestination: manifest.defaultDestination,
        };

        resources.push(resource);
      } catch (error) {
        if (
          error instanceof MarketplaceClientError &&
          (error.code === "MANIFEST_INVALID" ||
            error.code === "MANIFEST_PARSE_ERROR")
        ) {
          warnings.push({
            type: "parse-error",
            path: manifestFile.path,
            message: error.message,
            details: error.context,
          });
        } else {
          warnings.push({
            type: "parse-error",
            path: manifestFile.path,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (resources.length === 0 && warnings.length > 0) {
      throw new MarketplaceClientError("REGISTRY_INVALID", {
        message: `All ${manifestFiles.length} manifest(s) in the repository are invalid. Fix the manifests or use a registry.json file.`,
        context: {
          totalManifests: manifestFiles.length,
          warningCount: warnings.length,
          firstWarning: warnings[0],
        },
      });
    }

    if (resources.length === 0) {
      throw new MarketplaceClientError("REGISTRY_NOT_FOUND", {
        message: "No valid resources found in repository",
        context: {
          totalManifests: manifestFiles.length,
          repository: this._config.repository,
        },
      });
    }

    const categories = this._buildCategories(resources);
    const now = new Date().toISOString();

    const registry: Registry = {
      version: "1.0.0",
      generatedAt: now,
      repository: this._config.repository,
      categories,
      resources,
      metadata: {
        totalCount: resources.length,
        categoriesCount: categories.length,
        lastUpdated: now,
      },
    };

    return {
      registry,
      source: "manifest-scan",
      warnings,
    };
  }

  private _findManifests(
    tree: ReadonlyArray<{ readonly path: string; readonly type: string }>,
  ): Array<ManifestFile> {
    const manifests: Array<ManifestFile> = [];

    for (const item of tree) {
      if (item.type !== "blob") continue;

      const fileName = item.path.split("/").pop();
      if (fileName === undefined) continue;

      if (this._isManifestFileName(fileName)) {
        manifests.push({
          path: item.path,
          fileName,
        });
      }
    }

    return manifests;
  }

  private _isManifestFileName(name: string): name is ManifestFileName {
    return (MANIFEST_FILE_NAMES as ReadonlyArray<string>).includes(name);
  }

  private _buildCategories(
    resources: ReadonlyArray<RegistryResource>,
  ): ReadonlyArray<RegistryCategory> {
    const grouped = groupBy(resources, (r) => r.category);
    return Object.entries(grouped).map(([id, items]) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      description: `Resources in the ${id} category`,
      resourceCount: items.length,
    }));
  }

  private _normalizeAuthor(author: {
    readonly name: string;
    readonly email?: string;
    readonly url?: string;
    readonly github?: string;
  }): RegistryAuthor {
    return {
      name: author.name,
      email: author.email,
      url: author.url,
      github: author.github,
    };
  }

  private _isRegistry(value: unknown): value is Registry {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj["version"] === "string" &&
      typeof obj["repository"] === "string" &&
      Array.isArray(obj["categories"]) &&
      Array.isArray(obj["resources"]) &&
      typeof obj["metadata"] === "object" &&
      obj["metadata"] !== null
    );
  }

  private _isRecord(
    value: unknown,
  ): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
