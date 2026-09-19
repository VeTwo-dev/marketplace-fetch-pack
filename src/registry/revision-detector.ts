import type { RevisionInfo } from "./index-schema.js";
import type { ResolvedConfig } from "../types/config.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";

function parseGitHubRepo(repository: string): { owner: string; repo: string } {
  const url = repository.replace(/\.git$/, "");
  const parts = url.split("/");
  const owner = parts.at(-2);
  const repo = parts.at(-1);
  if (owner === undefined || repo === undefined) {
    throw new MarketplaceClientError("GITHUB_API_ERROR", {
      message: `Cannot parse repository URL: ${repository}`,
    });
  }
  return { owner, repo };
}

export interface RevisionDetectorOptions {
  readonly repository: string;
  readonly branch: string;
  readonly timeout: number;
  readonly token?: string;
}

export class RevisionDetector {
  private readonly _options: RevisionDetectorOptions;
  private readonly _logger: Logger;
  private _headers: Record<string, string>;

  constructor(config: ResolvedConfig, logger?: Logger) {
    this._options = {
      repository: config.repository,
      branch: config.branch,
      timeout: config.timeout,
      token: config.token,
    };
    this._logger = logger ?? createLogger({ prefix: "revision-detector" });
    this._headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "@vetwo/marketplace",
    };
    if (this._options.token !== undefined && this._options.token !== "") {
      this._headers["Authorization"] = `Bearer ${this._options.token}`;
    }
  }

  async detectRevision(): Promise<RevisionInfo> {
    const isGitHub = this._options.repository.includes("github.com");

    if (isGitHub) {
      return this._detectGitHubRevision();
    }

    return {
      checkedAt: new Date().toISOString(),
    };
  }

  private async _detectGitHubRevision(): Promise<RevisionInfo> {
    const { owner, repo } = parseGitHubRepo(this._options.repository);
    const url = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${this._options.branch}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this._options.timeout,
      );

      const response = await fetch(url, {
        headers: this._headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this._logger.debug(
          "Failed to get branch ref, skipping revision check",
          {
            status: response.status,
          },
        );
        return { checkedAt: new Date().toISOString() };
      }

      const data = (await response.json()) as { object: { sha: string } };
      const sha = data.object.sha;

      const etag = response.headers.get("etag") ?? undefined;
      const lastModified = response.headers.get("last-modified") ?? undefined;

      this._logger.debug("Detected GitHub revision", { sha: sha.slice(0, 8) });

      return {
        sha,
        etag,
        lastModified,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      this._logger.debug("Revision detection failed, proceeding without", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { checkedAt: new Date().toISOString() };
    }
  }
}

export function createRevisionDetector(
  config: ResolvedConfig,
  logger?: Logger,
): RevisionDetector {
  return new RevisionDetector(config, logger);
}
