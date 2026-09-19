import {
  downloadFile as repoFetchDownloadFile,
  downloadFolder as repoFetchDownloadFolder,
  fetchFiles as repoFetchFetchFiles,
  getProvider as repoFetchGetProvider,
} from "@vetwo/repo-fetch";
import type {
  DownloadResult as RepoFetchResult,
  RepoIdentifier,
} from "@vetwo/repo-fetch";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256 } from "../utils/index.js";

export interface RepoFetchClientOptions {
  readonly repository: string;
  readonly branch: string;
  readonly timeout?: number;
  readonly token?: string;
  readonly concurrency?: number;
  /** When true, refuse all network access (offline mode). */
  readonly offline?: boolean;
}

export interface RepoFetchTreeEntry {
  readonly path: string;
  readonly type: string;
  readonly sha: string;
  readonly size?: number;
}

export interface RepoFetchDownloadedFile {
  readonly path: string;
  readonly size: number;
  readonly sha: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONCURRENCY = 5;
/** Upper bound for single text reads (registry.json, manifests). */
const MAX_TEXT_BYTES = 10 * 1024 * 1024;

function parseGitHubRepo(repository: string): { owner: string; repo: string } {
  const url = repository.replace(/\.git$/, "");
  const parts = url.split("/");
  const owner = parts.at(-2);
  const repo = parts.at(-1);
  if (
    owner === undefined ||
    repo === undefined ||
    owner === "" ||
    repo === ""
  ) {
    throw new MarketplaceClientError("GITHUB_API_ERROR", {
      message: `Cannot parse repository URL: ${repository}`,
    });
  }
  return { owner, repo };
}

function combineSignals(
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (signal === undefined) return { signal: timeoutSignal, cleanup: () => {} };
  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any([signal, timeoutSignal]),
      cleanup: () => {},
    };
  }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal.reason);
  const onTimeout = (): void => controller.abort(timeoutSignal.reason);
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener("abort", onAbort, { once: true });
  if (timeoutSignal.aborted) controller.abort(timeoutSignal.reason);
  else timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      signal.removeEventListener("abort", onAbort);
      timeoutSignal.removeEventListener("abort", onTimeout);
    },
  };
}

async function streamToString(
  stream: NodeJS.ReadableStream,
  url: string,
): Promise<string> {
  const chunks: Array<Buffer> = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > MAX_TEXT_BYTES) {
      throw new MarketplaceClientError("NETWORK_ERROR", {
        message: `Response too large (>${MAX_TEXT_BYTES} bytes): ${url}`,
        context: { url, retryable: false },
      });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Primary fetch client for Marketplace, backed by `@vetwo/repo-fetch`.
 *
 * Owns retries on the primary path (repo-fetch retries internally via
 * p-retry). Callers must treat this as the single retry owner: only fall
 * back to the native transport after this client has fully failed, never
 * run both concurrently for the same read.
 */
export class RepoFetchClient {
  private readonly _options: RepoFetchClientOptions;
  private readonly _repo: RepoIdentifier;
  private readonly _logger: Logger;
  private readonly _inflight = new Map<string, Promise<string>>();

  constructor(options: RepoFetchClientOptions, logger?: Logger) {
    this._options = options;
    const { owner, repo } = parseGitHubRepo(options.repository);
    this._repo = {
      provider: "github",
      owner,
      repo,
      branch: options.branch,
    };
    this._logger = logger ?? createLogger({ prefix: "repo-fetch" });
  }

  private _ensureOnline(operation: string): void {
    if (this._options.offline === true) {
      throw new MarketplaceClientError("INTERNET_UNAVAILABLE", {
        message: `Network access blocked in offline mode for: ${operation}`,
        context: { operation, retryable: false },
      });
    }
  }

  get repositoryId(): RepoIdentifier {
    return this._repo;
  }

  async getRawUrl(filePath: string): Promise<string> {
    const provider = repoFetchGetProvider("github");
    return provider.getDownloadUrl(this._repo, filePath, {
      branch: this._options.branch,
    });
  }

  /** Read a small text file (registry.json, manifests), deduplicated. */
  async readText(filePath: string, signal?: AbortSignal): Promise<string> {
    this._ensureOnline(`repo-fetch read ${filePath}`);
    const key = `text:${filePath}`;
    const existing = this._inflight.get(key);
    if (existing !== undefined) return existing;
    const pending = this._readTextOnce(filePath, signal).finally(() => {
      if (this._inflight.get(key) === pending) this._inflight.delete(key);
    });
    this._inflight.set(key, pending);
    return pending;
  }

  private async _readTextOnce(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const timeout = this._options.timeout ?? DEFAULT_TIMEOUT_MS;
    const { signal: combined, cleanup } = combineSignals(timeout, signal);
    try {
      const provider = repoFetchGetProvider("github");
      const stream = await provider.getFile(this._repo, filePath, {
        branch: this._options.branch,
        token: this._options.token,
        signal: combined,
      });
      if (stream === null) {
        throw new MarketplaceClientError("REGISTRY_NOT_FOUND", {
          message: `File not found in repository: ${filePath}`,
          context: { path: filePath, retryable: false },
        });
      }
      return await streamToString(stream, filePath);
    } catch (error) {
      throw this._wrapError(error, filePath);
    } finally {
      cleanup();
    }
  }

  async getTree(
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<RepoFetchTreeEntry>> {
    this._ensureOnline("repo-fetch tree");
    const timeout = this._options.timeout ?? DEFAULT_TIMEOUT_MS;
    const { signal: combined, cleanup } = combineSignals(timeout, signal);
    try {
      const provider = repoFetchGetProvider("github");
      const tree = await provider.getTree(this._repo, {
        branch: this._options.branch,
        token: this._options.token,
        signal: combined,
      });
      return tree.map((item) => ({
        path: item.path,
        type: item.type,
        sha: item.sha,
        size: item.size,
      }));
    } catch (error) {
      throw this._wrapError(error, "tree");
    } finally {
      cleanup();
    }
  }

  /**
   * Download one file to `destination` with atomic rename + integrity check.
   * Per-file repo-fetch errors are preserved as `cause` so install failures
   * always carry the underlying reason.
   */
  async downloadTo(
    repoPath: string,
    destination: string,
    options?: {
      readonly expectedChecksum?: string;
      readonly expectedSize?: number;
      readonly signal?: AbortSignal;
      readonly overwrite?: boolean;
      readonly retries?: number;
    },
  ): Promise<RepoFetchDownloadedFile> {
    this._ensureOnline(`repo-fetch download ${repoPath}`);
    const { mkdir, readFile, writeFile, rename } =
      await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { randomUUID } = await import("node:crypto");

    const timeout = this._options.timeout ?? DEFAULT_TIMEOUT_MS;
    const { signal: combined, cleanup } = combineSignals(
      timeout,
      options?.signal,
    );
    const stagingDir = join(tmpdir(), `vetwo-marketplace-${randomUUID()}`);
    try {
      const result: RepoFetchResult = await repoFetchDownloadFile(
        this._repo,
        repoPath,
        {
          output: stagingDir,
          branch: this._options.branch,
          token: this._options.token,
          timeout,
          retries: options?.retries ?? 3,
          overwrite: true,
          signal: combined,
        },
      );
      if (!result.success) {
        const cause =
          result.error instanceof Error
            ? result.error
            : new Error(String(result.error ?? "unknown download error"));
        throw new MarketplaceClientError("DOWNLOAD_FAILED", {
          message: `Download failed for ${repoPath}: ${cause.message}`,
          cause,
          context: { path: repoPath, url: destination, retryable: true },
        });
      }
      const stagedPath = join(stagingDir, repoPath);
      const data = await readFile(stagedPath);
      if (
        options?.expectedSize !== undefined &&
        data.length !== options.expectedSize
      ) {
        throw new MarketplaceClientError("DOWNLOAD_FAILED", {
          message: `Size mismatch for ${repoPath}: expected ${options.expectedSize}, got ${data.length}`,
          context: { path: repoPath, retryable: true },
        });
      }
      const hash = sha256(data);
      if (
        options?.expectedChecksum !== undefined &&
        options.expectedChecksum !== "" &&
        hash !== options.expectedChecksum
      ) {
        throw new MarketplaceClientError("INTEGRITY_CHECK_FAILED", {
          message: `Checksum mismatch for ${repoPath}: expected ${options.expectedChecksum}, got ${hash}`,
          context: { path: repoPath, retryable: false },
        });
      }
      await mkdir(dirname(destination), { recursive: true });
      const tmpDest = `${destination}.part`;
      await writeFile(tmpDest, data);
      await rename(tmpDest, destination);
      return { path: destination, size: data.length, sha: hash };
    } catch (error) {
      if (error instanceof MarketplaceClientError) throw error;
      throw this._wrapError(error, repoPath);
    } finally {
      cleanup();
      const { rm: removeDir } = await import("node:fs/promises");
      await removeDir(stagingDir, { recursive: true, force: true }).catch(
        () => {},
      );
    }
  }

  /**
   * Batch download preserving per-file errors (never throws for individual
   * file failures — each entry carries its own `error`).
   */
  async downloadMany(
    repoPaths: ReadonlyArray<string>,
    options?: {
      readonly signal?: AbortSignal;
      readonly concurrency?: number;
      readonly retries?: number;
    },
  ): Promise<
    ReadonlyArray<
      { path: string; data: Buffer } | { path: string; error: Error }
    >
  > {
    this._ensureOnline("repo-fetch batch download");
    const { join, relative } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { randomUUID } = await import("node:crypto");
    const { rm } = await import("node:fs/promises");

    const timeout = this._options.timeout ?? DEFAULT_TIMEOUT_MS;
    const stagingDir = join(tmpdir(), `vetwo-marketplace-${randomUUID()}`);
    try {
      const results = await repoFetchFetchFiles(this._repo, [...repoPaths], {
        output: stagingDir,
        branch: this._options.branch,
        token: this._options.token,
        timeout,
        retries: options?.retries ?? 3,
        overwrite: true,
        concurrency:
          options?.concurrency ??
          this._options.concurrency ??
          DEFAULT_CONCURRENCY,
        signal: options?.signal,
      });
      const out: Array<
        { path: string; data: Buffer } | { path: string; error: Error }
      > = [];
      for (const result of results) {
        const rel = relative(stagingDir, result.path).replace(/\\/g, "/");
        if (result.success) {
          const { readFile } = await import("node:fs/promises");
          out.push({ path: rel, data: await readFile(result.path) });
        } else {
          out.push({
            path: rel,
            error:
              result.error instanceof Error
                ? result.error
                : new Error(String(result.error ?? "unknown download error")),
          });
        }
      }
      return out;
    } catch (error) {
      throw this._wrapError(error, "batch");
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Download a whole folder (folder-based resources whose manifest lists no
   * explicit `files`). Returns staged absolute paths; the caller moves them
   * to their final destination (atomic rename) and records integrity.
   * Per-file failures carry their own `error` — never throws for them.
   */
  async downloadFolder(
    folderPath: string,
    options?: {
      readonly signal?: AbortSignal;
      readonly concurrency?: number;
      readonly retries?: number;
    },
  ): Promise<{
    readonly files: ReadonlyArray<
      { path: string; stagedPath: string } | { path: string; error: Error }
    >;
    readonly cleanup: () => Promise<void>;
  }> {
    this._ensureOnline(`repo-fetch folder ${folderPath}`);
    const { join, relative } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { randomUUID } = await import("node:crypto");
    const { rm } = await import("node:fs/promises");

    const timeout = this._options.timeout ?? DEFAULT_TIMEOUT_MS;
    const stagingDir = join(tmpdir(), `vetwo-marketplace-${randomUUID()}`);
    const cleanup = async (): Promise<void> => {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    };
    try {
      const results = await repoFetchDownloadFolder(this._repo, folderPath, {
        output: stagingDir,
        branch: this._options.branch,
        token: this._options.token,
        timeout,
        retries: options?.retries ?? 3,
        overwrite: true,
        concurrency:
          options?.concurrency ??
          this._options.concurrency ??
          DEFAULT_CONCURRENCY,
        signal: options?.signal,
      });
      return {
        files: results.map((result) => {
          // Staged layout mirrors full repo paths; rebase to folder-relative.
          const full = relative(stagingDir, result.path).replace(/\\/g, "/");
          const prefix = folderPath.replace(/\\/g, "/").replace(/\/$/, "");
          const rel =
            full === prefix
              ? ""
              : full.startsWith(`${prefix}/`)
                ? full.slice(prefix.length + 1)
                : full;
          if (result.success) {
            return { path: rel, stagedPath: result.path };
          }
          return {
            path: rel,
            error:
              result.error instanceof Error
                ? result.error
                : new Error(String(result.error ?? "unknown download error")),
          };
        }),
        cleanup,
      };
    } catch (error) {
      await cleanup();
      throw this._wrapError(error, folderPath);
    }
  }

  private _wrapError(error: unknown, path: string): Error {
    if (error instanceof MarketplaceClientError) return error;
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : new Error(String(error));
    const name = error instanceof Error ? error.name : "";
    if (name === "PathNotFoundError" || /not found/i.test(message)) {
      return new MarketplaceClientError("REGISTRY_NOT_FOUND", {
        message: `File not found in repository: ${path}`,
        cause,
        context: { path, retryable: false },
      });
    }
    if (name === "RateLimitedError" || /rate limit|429/i.test(message)) {
      return new MarketplaceClientError("GITHUB_RATE_LIMIT", {
        message: `GitHub rate limit hit while reading ${path}: ${message}`,
        cause,
        context: { path },
      });
    }
    if (
      name === "PermissionDeniedError" ||
      /permission|denied|401|403/i.test(message)
    ) {
      return new MarketplaceClientError("GITHUB_API_ERROR", {
        message: `GitHub authorization failed for ${path}: ${message}`,
        cause,
        context: { path, retryable: false, authRequired: true },
      });
    }
    if (name === "TimeoutError" || /timeout|aborted|abort/i.test(message)) {
      return new MarketplaceClientError("NETWORK_ERROR", {
        message: `Request timed out for ${path}: ${message}`,
        cause,
        context: { path, retryable: true },
      });
    }
    return new MarketplaceClientError("NETWORK_ERROR", {
      message: `repo-fetch request failed for ${path}: ${message}`,
      cause,
      context: { path, retryable: true },
    });
  }
}
