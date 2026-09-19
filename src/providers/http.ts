import type {
  RegistryProvider,
  ProviderConfig,
  ProviderType,
  TreeEntry,
} from "../types/providers.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";

export class HttpRegistryProvider implements RegistryProvider {
  readonly type: ProviderType = "http";
  readonly name = "http";

  private config: ProviderConfig | null = null;
  private cachedTree: ReadonlyArray<TreeEntry> | null = null;
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createLogger({ prefix: "http-provider" });
  }

  async connect(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.logger.info("Connected to HTTP registry", {
      repository: config.repository,
    });
  }

  async readFile(path: string): Promise<string> {
    const url = this._buildUrl(path);
    const response = await this._fetchWithTimeout(url);
    if (!response.ok) {
      this._handleError(response.status, path);
    }
    return response.text();
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
    if (this.cachedTree !== null) {
      return this.cachedTree;
    }

    const config = this.requireConfig();
    const indexUrl = this._buildUrl("index.json");

    try {
      const response = await this._fetchWithTimeout(indexUrl);
      if (!response.ok) {
        this._handleError(response.status, "index.json");
      }
      const data = (await response.json()) as {
        entries?: ReadonlyArray<TreeEntry>;
      };

      if (Array.isArray(data.entries)) {
        this.cachedTree = Object.freeze([...data.entries]);
        return this.cachedTree;
      }

      this.cachedTree = Object.freeze([]);
      return this.cachedTree;
    } catch (error) {
      if (error instanceof MarketplaceClientError) throw error;
      throw new MarketplaceClientError("NETWORK_ERROR", {
        message: `Failed to fetch tree from ${config.repository}`,
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { url: indexUrl },
      });
    }
  }

  async getRawUrl(path: string): Promise<string> {
    return this._buildUrl(path);
  }

  invalidate(): void {
    this.cachedTree = null;
    this.logger.debug("HTTP tree cache invalidated");
  }

  private _buildUrl(path: string): string {
    const config = this.requireConfig();
    const base = config.repository.replace(/\/+$/, "");
    const cleanPath = path.replace(/^\/+/, "");
    const basePath = config.basePath?.replace(/\/+$/, "") ?? "";
    const parts = [base, basePath, cleanPath].filter((p) => p.length > 0);
    return parts.join("/");
  }

  private requireConfig(): ProviderConfig {
    if (this.config === null) {
      throw new MarketplaceClientError("NETWORK_ERROR", {
        message: "Provider not connected. Call connect() first.",
      });
    }
    return this.config;
  }

  private async _fetchWithTimeout(url: string): Promise<Response> {
    const timeout = this.config?.timeout ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "VeTwo-Marketplace/1.0",
      };
      const token = this.config?.token;
      if (token !== undefined && token !== "") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      return await fetch(url, {
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new MarketplaceClientError("DOWNLOAD_TIMEOUT", {
          message: `Request to ${url} timed out after ${timeout}ms`,
          context: { url, timeout },
        });
      }
      throw new MarketplaceClientError("NETWORK_ERROR", {
        message: `Network request failed: ${url}`,
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { url },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private _handleError(status: number, resource: string): never {
    if (status === 404) {
      throw new MarketplaceClientError("RESOURCE_NOT_FOUND", {
        message: `Resource not found: ${resource}`,
        context: { status, resource },
      });
    }
    throw new MarketplaceClientError("NETWORK_ERROR", {
      message: `HTTP request returned status ${status} for ${resource}`,
      context: { status, resource },
    });
  }
}
