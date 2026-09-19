import {
  NodeFetchTransport,
  getSharedTransport,
} from "./node-fetch-transport.js";
import type { ContentTransport, ContentTransportResponse } from "./types.js";
import { SingleFlight } from "../registry/single-flight.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";

export interface RepositoryTransportOptions {
  readonly repository: string;
  readonly branch: string;
  readonly timeout: number;
  readonly token?: string;
}

export interface TreeEntry {
  readonly path: string;
  readonly type: string;
  readonly sha: string;
  readonly size?: number;
  readonly url?: string;
}

interface ConditionalEntry {
  etag: string | null;
  lastModified: string | null;
  body: string;
}

// Retryable: transient network/server failures only.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

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

export function getApiBase(repository: string): string {
  const { owner, repo } = parseGitHubRepo(repository);
  return `https://api.github.com/repos/${owner}/${repo}`;
}

export function getRawBase(repository: string, branch: string): string {
  const { owner, repo } = parseGitHubRepo(repository);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
}

function retryAfterMs(
  headers: Readonly<Record<string, string>>,
): number | null {
  const raw = headers["retry-after"];
  if (raw !== undefined) {
    const secs = Number(raw);
    if (!Number.isNaN(secs)) return secs * 1000;
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const reset = headers["x-ratelimit-reset"] ?? headers["ratelimit-reset"];
  if (reset !== undefined) {
    const secs = Number(reset);
    if (!Number.isNaN(secs)) return Math.max(0, secs * 1000 - Date.now());
  }
  return null;
}

function backoff(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.floor(delay * (0.5 + Math.random() * 0.5));
}

interface RateLimitInfo {
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly reset: number | null;
  readonly retryAfter: number | null;
}

function classifyRateLimit(
  headers: Readonly<Record<string, string>>,
): RateLimitInfo | null {
  const limit = parseOptionalInt(headers["x-ratelimit-limit"]);
  const remaining = parseOptionalInt(headers["x-ratelimit-remaining"]);
  const reset = parseOptionalInt(headers["x-ratelimit-reset"]);
  const retryAfter = parseRetryAfterMs(headers);

  // Consider it a rate-limit condition if remaining is explicitly 0
  // or if GitHub uses Retry-After with a 4xx status (their pattern for secondary limits).
  if (remaining === 0 || (retryAfter !== null && retryAfter > 0)) {
    return { limit, remaining, reset, retryAfter };
  }
  return null;
}

function parseOptionalInt(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function parseRetryAfterMs(
  headers: Readonly<Record<string, string>>,
): number | null {
  const raw = headers["retry-after"];
  if (raw !== undefined) {
    const secs = Number(raw);
    if (!Number.isNaN(secs)) return secs * 1000;
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(
        new MarketplaceClientError("DOWNLOAD_CANCELLED", {
          message: "Cancelled while waiting to retry",
        }),
      );
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        new MarketplaceClientError("DOWNLOAD_CANCELLED", {
          message: "Cancelled while waiting to retry",
        }),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Minimal Marketplace-owned GitHub repository transport.
 *
 * Owns ALL retries for small metadata/text reads (tree, registry.json,
 * manifests). File downloads must go through DownloadEngine instead, which
 * owns its own retry policy — this separation prevents retry multiplication.
 *
 * Connection reuse comes from the shared global fetch pool (no per-request
 * agents/clients are ever created); all instances share one transport and
 * one single-flight map per instance for identical concurrent reads.
 */
export class GitHubRepositoryTransport {
  private readonly _options: RepositoryTransportOptions;
  private readonly _transport: ContentTransport;
  private readonly _singleFlight: SingleFlight;
  private readonly _logger: Logger;
  private readonly _headers: Record<string, string>;
  private readonly _conditional = new Map<string, ConditionalEntry>();
  /** Test hook: counts underlying network fetches per URL. */
  readonly fetchCounts = new Map<string, number>();

  constructor(
    options: RepositoryTransportOptions,
    transport?: ContentTransport,
    singleFlight?: SingleFlight,
    logger?: Logger,
  ) {
    this._options = options;
    this._transport =
      transport ?? getSharedTransport(logger?.child?.("transport"));
    this._singleFlight = singleFlight ?? new SingleFlight();
    this._logger = logger ?? createLogger({ prefix: "github-repo" });
    this._headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "@vetwo/marketplace",
    };
    if (this._options.token !== undefined && this._options.token !== "") {
      this._headers["Authorization"] = `Bearer ${this._options.token}`;
    }
  }

  async getRawUrl(filePath: string): Promise<string> {
    const base = getRawBase(this._options.repository, this._options.branch);
    return `${base}/${filePath}`;
  }

  async readText(filePath: string, signal?: AbortSignal): Promise<string> {
    const url = await this.getRawUrl(filePath);
    return this._fetchTextDeduped(url, signal);
  }

  async readJson<T = unknown>(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const content = await this.readText(filePath, signal);
    try {
      return JSON.parse(content) as T;
    } catch (error) {
      throw new MarketplaceClientError("MANIFEST_PARSE_ERROR", {
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { url: filePath },
      });
    }
  }

  async getTree(signal?: AbortSignal): Promise<ReadonlyArray<TreeEntry>> {
    const apiBase = getApiBase(this._options.repository);
    const url = `${apiBase}/git/trees/${this._options.branch}?recursive=1`;
    return this._singleFlight.do(`tree:${url}`, async () => {
      const data = await this._fetchJson<{
        tree: TreeEntry[];
        truncated?: boolean;
      }>(url, signal);
      if (data.truncated === true) {
        return this._paginateTree(apiBase, signal);
      }
      return data.tree;
    });
  }

  private async _paginateTree(
    apiBase: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<TreeEntry>> {
    const shaUrl = `${apiBase}/git/ref/heads/${this._options.branch}`;
    let sha: string;
    try {
      const refData = await this._fetchJson<{ object: { sha: string } }>(
        shaUrl,
        signal,
      );
      sha = refData.object.sha;
    } catch {
      throw new MarketplaceClientError("GITHUB_API_ERROR", {
        message: "Failed to get branch SHA for tree pagination",
      });
    }

    const allEntries: Array<TreeEntry> = [];
    for (let page = 1; page <= 100; page++) {
      const url = `${apiBase}/git/trees/${sha}?recursive=1&page=${page}&per_page=100`;
      const data = await this._fetchJson<{
        tree: TreeEntry[];
        truncated?: boolean;
      }>(url, signal);
      allEntries.push(...data.tree);
      if (data.truncated !== true) return allEntries;
    }
    throw new MarketplaceClientError("GITHUB_API_ERROR", {
      message: "Tree pagination exceeded maximum pages",
    });
  }

  private async _fetchTextDeduped(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this._singleFlight.do(`text:${url}`, () =>
      this._fetchTextWithRetry(url, signal),
    );
  }

  private async _fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const text = await this._singleFlight.do(`text:${url}`, () =>
      this._fetchTextWithRetry(url, signal),
    );
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new MarketplaceClientError("MANIFEST_PARSE_ERROR", {
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { url },
      });
    }
  }

  private async _fetchTextWithRetry(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted === true) {
        throw new MarketplaceClientError("DOWNLOAD_CANCELLED", {
          message: "Request cancelled",
          context: { url },
        });
      }

      try {
        return await this._fetchTextOnce(url, signal);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof MarketplaceClientError) {
          const retryable = (
            error.context as Record<string, unknown> | undefined
          )?.["retryable"];
          if (
            error.code === "DOWNLOAD_CANCELLED" ||
            error.code === "REGISTRY_NOT_FOUND" ||
            error.code === "MANIFEST_PARSE_ERROR" ||
            retryable === false
          ) {
            throw error;
          }
          if (error.code === "GITHUB_RATE_LIMIT") {
            const waitMs =
              ((error.context as Record<string, unknown> | undefined)?.[
                "retryAfterMs"
              ] as number | undefined) ?? backoff(attempt);
            // Fail fast when the reset is far away: further attempts cannot
            // succeed before then and only burn quota + wall-clock time.
            if (waitMs > MAX_DELAY_MS) {
              this._logger.warn("Rate limited, reset too far — not retrying", {
                url,
                waitMs,
              });
              throw error;
            }
            this._logger.warn("Rate limited, backing off", { url, waitMs });
            if (attempt < MAX_RETRIES) {
              await sleep(Math.min(waitMs, MAX_DELAY_MS), signal);
              continue;
            }
            throw error;
          }
        }

        if (attempt < MAX_RETRIES) {
          await sleep(backoff(attempt), signal);
        }
      }
    }

    throw (
      lastError ??
      new MarketplaceClientError("NETWORK_ERROR", {
        message: "All retry attempts failed",
        context: { url },
      })
    );
  }

  private async _fetchTextOnce(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const cached = this._conditional.get(url);
    this.fetchCounts.set(url, (this.fetchCounts.get(url) ?? 0) + 1);

    const response = await (this._transport as NodeFetchTransport).fetch({
      url,
      headers: this._headers,
      signal,
      timeout: { totalMs: this._options.timeout },
      ifNoneMatch: cached?.etag ?? undefined,
      ifModifiedSince: cached?.lastModified ?? undefined,
    });

    if (response.status === 304 && cached !== undefined) {
      return cached.body;
    }

    if (response.status === 429) {
      const waitMs = retryAfterMs(response.headers);
      throw new MarketplaceClientError("GITHUB_RATE_LIMIT", {
        message: `GitHub rate limit exceeded${waitMs !== null ? `; retry after ${Math.ceil(waitMs / 1000)}s` : ""}`,
        context: { url, status: 429, retryAfterMs: waitMs ?? undefined },
      });
    }
    if (response.status === 404) {
      throw new MarketplaceClientError("REGISTRY_NOT_FOUND", {
        context: { url, status: 404, retryable: false },
      });
    }

    // 403/401: classify FIRST — GitHub reports rate limits (including
    // secondary limits) as 403, with or without a token configured.
    if (response.status === 403 || response.status === 401) {
      const rateLimitInfo = classifyRateLimit(response.headers);
      if (rateLimitInfo !== null) {
        throw new MarketplaceClientError("GITHUB_RATE_LIMIT", {
          message: `GitHub rate limit exceeded for ${url}${rateLimitInfo.retryAfter !== null ? `; retry after ${Math.ceil(rateLimitInfo.retryAfter / 1000)}s` : ""}. Set GITHUB_TOKEN for higher limits.`,
          context: {
            url,
            status: response.status,
            retryAfterMs: rateLimitInfo.retryAfter ?? undefined,
            rateLimit: rateLimitInfo,
          },
        });
      }

      // 403 with a token: retry without authentication for public resources.
      // An invalid/expired GITHUB_TOKEN must not break public registry access.
      if (this._headers["Authorization"] !== undefined) {
        const unauthenticatedHeaders = { ...this._headers };
        delete unauthenticatedHeaders["Authorization"];
        const retryResponse = await (
          this._transport as NodeFetchTransport
        ).fetch({
          url,
          headers: unauthenticatedHeaders,
          signal,
          timeout: { totalMs: this._options.timeout },
          ifNoneMatch: cached?.etag ?? undefined,
          ifModifiedSince: cached?.lastModified ?? undefined,
        });

        if (retryResponse.status === 304 && cached !== undefined) {
          return cached.body;
        }
        if (retryResponse.ok) {
          this._logger.debug(
            "Authenticated request rejected, using unauthenticated access",
            { url, originalStatus: response.status },
          );
          return this._readBody(retryResponse, url);
        }

        // Both authenticated and unauthenticated attempts failed.
        // Classify the failure: rate-limit vs. private resource vs. other.
        if (retryResponse.status === 403) {
          const rateLimitInfo = classifyRateLimit(retryResponse.headers);
          if (rateLimitInfo !== null) {
            throw new MarketplaceClientError("GITHUB_RATE_LIMIT", {
              message: `GitHub rate limit exceeded${rateLimitInfo.retryAfter !== null ? `; retry after ${Math.ceil(rateLimitInfo.retryAfter / 1000)}s` : ""}`,
              context: {
                url,
                status: 403,
                retryAfterMs: rateLimitInfo.retryAfter ?? undefined,
                rateLimit: rateLimitInfo,
              },
            });
          }
          throw new MarketplaceClientError("GITHUB_API_ERROR", {
            message:
              "This GitHub resource requires authorization. Provide a valid GITHUB_TOKEN.",
            context: { url, status: 403, retryable: false, authRequired: true },
          });
        }
        if (retryResponse.status === 401) {
          throw new MarketplaceClientError("GITHUB_API_ERROR", {
            message:
              "GitHub authentication was rejected. Check your GITHUB_TOKEN.",
            context: { url, status: 401, retryable: false },
          });
        }
      }

      // No token configured, or unauthenticated fallback also failed
      throw new MarketplaceClientError("GITHUB_API_ERROR", {
        message: `GitHub returned HTTP ${response.status} for ${url}`,
        context: { url, status: response.status, retryable: false },
      });
    }

    if (RETRYABLE_STATUSES.has(response.status)) {
      throw new MarketplaceClientError("NETWORK_ERROR", {
        message: `Transient HTTP ${response.status}`,
        context: { url, status: response.status, retryable: true },
      });
    }
    if (!response.ok) {
      throw new MarketplaceClientError("GITHUB_API_ERROR", {
        context: { url, status: response.status, retryable: false },
      });
    }

    return this._readBody(response, url);
  }

  private async _readBody(
    response: ContentTransportResponse,
    url: string,
  ): Promise<string> {
    const body = response.body;
    if (body === null) {
      throw new MarketplaceClientError("NETWORK_ERROR", {
        message: "Response body is null",
        context: { url, retryable: true },
      });
    }

    const { Readable } = await import("node:stream");
    const chunks: Array<Buffer> = [];
    for await (const chunk of Readable.fromWeb(
      body as import("node:stream/web").ReadableStream<Uint8Array>,
    )) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    // Bounded in-memory conditional cache (200 entries)
    if (this._conditional.size >= 200) {
      const first = this._conditional.keys().next();
      if (!first.done) this._conditional.delete(first.value);
    }
    this._conditional.set(url, {
      etag: response.etag,
      lastModified: response.lastModified,
      body: text,
    });
    return text;
  }
}
