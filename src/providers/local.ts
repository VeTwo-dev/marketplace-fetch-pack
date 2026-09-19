import {
  readFile as fsReadFile,
  stat as fsStat,
  readdir as fsReaddir,
} from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, relative } from "node:path";
import type {
  RegistryProvider,
  ProviderConfig,
  ProviderType,
  TreeEntry,
} from "../types/providers.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";

export class LocalRegistryProvider implements RegistryProvider {
  readonly type: ProviderType = "local";
  readonly name = "local";

  private basePath: string | null = null;
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createLogger({ prefix: "local-provider" });
  }

  async connect(config: ProviderConfig): Promise<void> {
    const resolvedPath = config.basePath ?? config.repository;
    const info = await fsStat(resolvedPath);
    if (!info.isDirectory()) {
      throw new MarketplaceClientError("DESTINATION_INVALID", {
        message: `Path is not a directory: ${resolvedPath}`,
        context: { path: resolvedPath },
      });
    }
    this.basePath = resolvedPath;
    this.logger.info("Connected to local registry", {
      path: resolvedPath,
    });
  }

  async readFile(path: string): Promise<string> {
    const fullPath = this.resolvePath(path);
    try {
      return await fsReadFile(fullPath, "utf-8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new MarketplaceClientError("RESOURCE_NOT_FOUND", {
          message: `File not found: ${path}`,
          context: { path, fullPath },
        });
      }
      throw new MarketplaceClientError("CACHE_READ_ERROR", {
        message: `Failed to read file: ${path}`,
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { path, fullPath },
      });
    }
  }

  async readJson<T = unknown>(path: string): Promise<T> {
    const text = await this.readFile(path);
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new MarketplaceClientError("MANIFEST_PARSE_ERROR", {
        message: `Failed to parse JSON from ${path}`,
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { path },
      });
    }
  }

  async getTree(): Promise<ReadonlyArray<TreeEntry>> {
    const root = this.requireBasePath();
    const entries: TreeEntry[] = [];
    await this.walkDirectory(root, root, entries);
    return Object.freeze(entries);
  }

  async getRawUrl(path: string): Promise<string> {
    const fullPath = this.resolvePath(path);
    return pathToFileURL(fullPath).href;
  }

  invalidate(): void {
    // no-op for local filesystem
  }

  private async walkDirectory(
    dir: string,
    root: string,
    entries: TreeEntry[],
  ): Promise<void> {
    const items = await fsReaddir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(dir, item.name);
      const relativePath = relative(root, fullPath);
      if (item.isDirectory()) {
        entries.push({
          path: relativePath,
          type: "tree",
          sha: "",
        });
        await this.walkDirectory(fullPath, root, entries);
      } else if (item.isFile()) {
        const info = await fsStat(fullPath);
        entries.push({
          path: relativePath,
          type: "blob",
          sha: "",
          size: info.size,
          url: pathToFileURL(fullPath).href,
        });
      }
    }
  }

  private resolvePath(path: string): string {
    const base = this.requireBasePath();
    return join(base, path);
  }

  private requireBasePath(): string {
    if (this.basePath === null) {
      throw new MarketplaceClientError("GITHUB_API_ERROR", {
        message: "Provider not connected. Call connect() first.",
      });
    }
    return this.basePath;
  }
}
