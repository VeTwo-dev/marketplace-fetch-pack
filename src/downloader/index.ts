import type {
  DownloadOptions,
  DownloadResult,
  DownloadedFile,
} from "../types/download.js";
import type { ResolvedConfig } from "../types/config.js";
import { EventBus } from "../events/index.js";
import { Cache } from "../cache/index.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256 } from "../utils/index.js";
import { GitHubRepositoryTransport } from "../transport/github-repository.js";
import { RepoFetchClient } from "../registry/repo-fetch-client.js";
import type { DownloadEngine } from "../download/DownloadEngine.js";

/**
 * Downloader facade.
 *
 * Primary fetch is the `@vetwo/repo-fetch` package (via RepoFetchClient);
 * the native transport (DownloadEngine for files, GitHubRepositoryTransport
 * for text) is the fallback and runs only after primary has fully failed.
 * No layer owns retries except the one performing the request — this
 * single-ownership rule prevents retry multiplication.
 */
export class Downloader {
  private readonly _repos: GitHubRepositoryTransport;
  private readonly _primary: RepoFetchClient;
  private readonly _engine: DownloadEngine | null;
  private readonly _cache: Cache;
  private readonly _events: EventBus;
  private readonly _config: ResolvedConfig;
  private readonly _logger: Logger;

  constructor(
    config: ResolvedConfig,
    cache: Cache,
    events: EventBus,
    logger?: Logger,
    engine?: DownloadEngine | null,
    repos?: GitHubRepositoryTransport | null,
  ) {
    this._config = config;
    this._cache = cache;
    this._events = events;
    this._logger = logger ?? createLogger({ prefix: "downloader" });
    this._engine = engine ?? null;
    this._primary = new RepoFetchClient(
      {
        repository: config.repository,
        branch: config.branch,
        timeout: config.timeout,
        token: config.token,
        concurrency: config.concurrency,
        offline: config.offline,
      },
      this._logger.child("primary"),
    );
    this._repos =
      repos ??
      new GitHubRepositoryTransport(
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
  }

  /** File download with streaming, atomic write, integrity (delegated, no local retry). */
  async download(options: DownloadOptions): Promise<DownloadResult> {
    await this._events.emit("beforeDownload", {
      url: options.url,
      options,
    });

    if (this._engine !== null) {
      const result = await this._engine.download({
        url: options.url,
        destination: options.destination,
        expectedChecksum: options.sha,
        timeout: options.timeout,
        retries: options.retries,
        overwrite: options.overwrite,
      });
      const legacy: DownloadResult = {
        success: result.success,
        files: [{ path: result.path, size: result.size, sha: result.checksum }],
        totalSize: result.size,
        duration: result.duration,
        cached: result.fromCache,
      };
      await this._events.emit("afterDownload", {
        url: options.url,
        result: legacy,
      });
      return legacy;
    }

    // Fallback when no engine is wired: single attempt only (no retry loop here).
    const result = await this._downloadInternal(options);
    await this._events.emit("afterDownload", {
      url: options.url,
      result,
    });
    return result;
  }

  async downloadFile(filePath: string): Promise<string> {
    const cacheKey = `file:${filePath}`;

    const cached = await this._cache.get<string>(cacheKey);
    if (cached !== null) {
      this._logger.debug(`File loaded from cache: ${filePath}`);
      return cached.data;
    }

    // Single-flight + conditional + retry owned by the repository transport.
    // Primary: repo-fetch package; fallback: native transport.
    let content: string;
    try {
      content = await this.primaryClient.readText(filePath);
    } catch (error) {
      if (
        error instanceof MarketplaceClientError &&
        error.code === "GITHUB_RATE_LIMIT"
      ) {
        throw error;
      }
      this._logger.debug("Primary fetch failed, using fallback", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      content = await this._repos.readText(filePath);
    }

    await this._cache.set(cacheKey, content, "download");

    return content;
  }

  async downloadMultiple(
    filePaths: ReadonlyArray<string>,
    concurrency: number = 5,
  ): Promise<ReadonlyMap<string, string>> {
    const results = new Map<string, string>();
    const chunks: Array<ReadonlyArray<string>> = [];

    for (let i = 0; i < filePaths.length; i += concurrency) {
      chunks.push(filePaths.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(async (path) => {
        const content = await this.downloadFile(path);
        results.set(path, content);
      });
      await Promise.all(promises);
    }

    return results;
  }

  async getFileUrl(filePath: string): Promise<string> {
    return this._repos.getRawUrl(filePath);
  }

  /** Primary fetch client (repo-fetch package) for batch operations. */
  get primaryClient(): RepoFetchClient {
    return this._primary;
  }

  private async _downloadInternal(
    options: DownloadOptions,
  ): Promise<DownloadResult> {
    const { mkdir, writeFile, access, rename, rm } =
      await import("node:fs/promises");
    const { dirname } = await import("node:path");

    const destDir = dirname(options.destination);
    await mkdir(destDir, { recursive: true });

    if (options.overwrite !== true) {
      try {
        await access(options.destination);
        this._logger.debug(`File already exists: ${options.destination}`);
        const stat = await import("node:fs/promises").then((m) =>
          m.stat(options.destination),
        );
        return {
          success: true,
          files: [
            {
              path: options.destination,
              size: stat.size,
              sha: "",
            },
          ],
          totalSize: stat.size,
          duration: 0,
          cached: true,
        };
      } catch {
        // file doesn't exist, proceed
      }
    }

    const startTime = Date.now();
    const repoPath = options.url.replace(
      /^https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\//,
      "",
    );

    // Primary: repo-fetch package (atomic write + integrity + error causes).
    // Only when the URL maps to a repo-relative path; absolute non-raw URLs
    // go straight to the fallback below.
    if (!repoPath.includes("://")) {
      try {
        const downloaded = await this.primaryClient.downloadTo(
          repoPath,
          options.destination,
          { expectedChecksum: options.sha },
        );
        return {
          success: true,
          files: [
            {
              path: downloaded.path,
              size: downloaded.size,
              sha: downloaded.sha,
            },
          ],
          totalSize: downloaded.size,
          duration: Date.now() - startTime,
          cached: false,
        };
      } catch (error) {
        if (
          error instanceof MarketplaceClientError &&
          error.code === "GITHUB_RATE_LIMIT"
        ) {
          throw error;
        }
        this._logger.debug("Primary download failed, using fallback", {
          url: options.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fallback when primary fails: single attempt only (no retry loop here).

    // Write to temp file, then validate, then atomic rename.
    // (Small text-manifest path only; large artifacts go via DownloadEngine.)
    const tmpPath = `${options.destination}.part`;
    let file: DownloadedFile;
    try {
      const content = await this._repos.readText(repoPath);
      const buffer = Buffer.from(content, "utf-8");

      const hash = sha256(buffer);
      if (options.sha !== undefined && hash !== options.sha) {
        throw new MarketplaceClientError("INTEGRITY_CHECK_FAILED", {
          message: `File hash mismatch for ${options.url}`,
          context: {
            expected: options.sha,
            actual: hash,
            url: options.url,
          },
        });
      }

      await writeFile(tmpPath, buffer);
      await rename(tmpPath, options.destination);
      file = {
        path: options.destination,
        size: buffer.length,
        sha: hash,
      };
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => {});
      throw error;
    }

    return {
      success: true,
      files: [file],
      totalSize: file.size,
      duration: Date.now() - startTime,
      cached: false,
    };
  }
}
