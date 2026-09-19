import type {
  RegistryProvider,
  ProviderConfig,
  ProviderType,
  TreeEntry,
} from "../types/providers.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";

interface GitHubTreeResponse {
  readonly sha: string;
  readonly url: string;
  readonly tree: ReadonlyArray<{
    readonly path: string;
    readonly mode: string;
    readonly type: string;
    readonly sha: string;
    readonly size?: number;
    readonly url: string;
  }>;
  readonly truncated: boolean;
}

export class GitHubRegistryProvider implements RegistryProvider {
  readonly type: ProviderType = "github";
  readonly name = "github";

  private config: ProviderConfig | null = null;
  private cachedTree: ReadonlyArray<TreeEntry> | null = null;
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createLogger({ prefix: "github-provider" });
  }

  async connect(config: ProviderConfig): Promise<void> {
    this.validateGitHubUrl(config.repository);
    this.config = config;
    this.logger.info("Connected to GitHub registry", {
      repository: config.repository,
      branch: config.branch,
    });
  }

  async readFile(path: string): Promise<string> {
    const url = this.getRawUrlForPath(path);
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      this.handleHttpError(response.status, path);
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
    const [owner, repo] = this.parseRepo(config.repository);

    const entries: TreeEntry[] = [];
    let sha = config.branch;
    let truncated = true;

    while (truncated) {
      const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`;
      const response = await this.fetchWithApi(url);
      if (!response.ok) {
        this.handleHttpError(response.status, "git/trees");
      }
      const data = (await response.json()) as GitHubTreeResponse;

      for (const item of data.tree) {
        if (item.type === "blob" || item.type === "tree") {
          entries.push({
            path: item.path,
            type: item.type as "blob" | "tree",
            sha: item.sha,
            size: item.size,
            url: item.url,
          });
        }
      }

      truncated = data.truncated;
      sha = data.sha;
    }

    this.cachedTree = Object.freeze(entries);
    return this.cachedTree;
  }

  async getRawUrl(path: string): Promise<string> {
    return this.getRawUrlForPath(path);
  }

  invalidate(): void {
    this.cachedTree = null;
    this.logger.debug("GitHub tree cache invalidated");
  }

  private getRawUrlForPath(path: string): string {
    const config = this.requireConfig();
    const [owner, repo] = this.parseRepo(config.repository);
    const branch = encodeURIComponent(config.branch);
    const cleanPath = path.replace(/^\//, "");
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}`;
  }

  private parseRepo(repository: string): readonly [string, string] {
    const cleaned = repository
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
    const parts = cleaned.split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw new MarketplaceClientError("GITHUB_API_ERROR", {
        message: `Invalid GitHub repository: ${repository}`,
        context: { repository },
      });
    }
    return [parts[0], parts[1]];
  }

  private validateGitHubUrl(url: string): void {
    const pattern = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/[\w.-]+)*\/?$/;
    if (!pattern.test(url)) {
      throw new MarketplaceClientError("GITHUB_API_ERROR", {
        message: `Invalid GitHub URL: ${url}`,
        context: { url },
      });
    }
  }

  private requireConfig(): ProviderConfig {
    if (this.config === null) {
      throw new MarketplaceClientError("GITHUB_API_ERROR", {
        message: "Provider not connected. Call connect() first.",
      });
    }
    return this.config;
  }

  private buildHeaders(): Headers {
    const headers = new Headers({
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "VeTwo-Marketplace/1.0",
    });
    const token = this.config?.token ?? process.env["GITHUB_TOKEN"];
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const timeout = this.config?.timeout ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        headers: this.buildHeaders(),
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

  private async fetchWithApi(url: string): Promise<Response> {
    const timeout = this.config?.timeout ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        headers: this.buildHeaders(),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new MarketplaceClientError("DOWNLOAD_TIMEOUT", {
          message: `GitHub API request timed out after ${timeout}ms`,
          context: { url, timeout },
        });
      }
      throw new MarketplaceClientError("GITHUB_API_ERROR", {
        message: `GitHub API request failed`,
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { url },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private handleHttpError(status: number, resource: string): never {
    if (status === 403) {
      throw new MarketplaceClientError("GITHUB_RATE_LIMIT", {
        message: `Rate limit exceeded accessing ${resource}`,
        context: { status, resource },
      });
    }
    if (status === 404) {
      throw new MarketplaceClientError("RESOURCE_NOT_FOUND", {
        message: `Resource not found: ${resource}`,
        context: { status, resource },
      });
    }
    throw new MarketplaceClientError("GITHUB_API_ERROR", {
      message: `GitHub API returned status ${status} for ${resource}`,
      context: { status, resource },
    });
  }
}
