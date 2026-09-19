import type {
  ContentTransport,
  ContentTransportRequest,
  ContentTransportResponse,
  HeadResult,
  TransportErrorKind,
  TransportTimeouts,
} from "./types.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import type { NetworkAccessGuard } from "../offline/guard.js";

const DEFAULT_TIMEOUTS: Required<TransportTimeouts> = {
  connectMs: 10_000,
  headersMs: 15_000,
  idleMs: 30_000,
  totalMs: 120_000,
};

let sharedTransport: NodeFetchTransport | null = null;

/**
 * Shared process-wide transport instance.
 *
 * Node's global fetch multiplexes over a shared undici connection pool with
 * keep-alive, so reusing one transport (instead of constructing per-request
 * clients/agents) is what gives connection reuse. Never create per-file
 * HTTP clients; always share this instance.
 */
export function getSharedTransport(logger?: Logger): NodeFetchTransport {
  if (sharedTransport === null) {
    sharedTransport = new NodeFetchTransport(logger);
  }
  return sharedTransport;
}

export class NodeFetchTransport implements ContentTransport {
  private readonly _logger: Logger;
  private readonly _userAgent: string;
  private readonly _guard: NetworkAccessGuard | null;

  constructor(logger?: Logger, userAgent?: string, guard?: NetworkAccessGuard) {
    this._logger = logger ?? createLogger({ prefix: "transport" });
    this._userAgent = userAgent ?? "@vetwo/marketplace";
    this._guard = guard ?? null;
  }

  async fetch(
    request: ContentTransportRequest,
  ): Promise<ContentTransportResponse> {
    this._guard?.ensureNetworkAllowed(`fetch ${request.url}`, request.url);
    const timeouts = { ...DEFAULT_TIMEOUTS, ...request.timeout };
    const controller = new AbortController();
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let headersTimer: ReturnType<typeof setTimeout> | undefined;

    const onExternalAbort = (): void => controller.abort();
    if (request.signal !== undefined) {
      if (request.signal.aborted) controller.abort();
      else
        request.signal.addEventListener("abort", onExternalAbort, {
          once: true,
        });
    }

    const cleanup = (): void => {
      if (totalTimer !== undefined) clearTimeout(totalTimer);
      if (headersTimer !== undefined) clearTimeout(headersTimer);
      if (request.signal !== undefined)
        request.signal.removeEventListener("abort", onExternalAbort);
    };

    const totalTimeoutPromise = new Promise<never>((_, reject) => {
      totalTimer = setTimeout(() => {
        controller.abort();
        reject(
          this._classifyError(
            new Error(`Total timeout after ${timeouts.totalMs}ms`),
            undefined,
            "timeout",
          ),
        );
      }, timeouts.totalMs);
    });

    const headersTimeoutPromise = new Promise<never>((_, reject) => {
      headersTimer = setTimeout(() => {
        controller.abort();
        reject(
          this._classifyError(
            new Error(`Headers timeout after ${timeouts.headersMs}ms`),
            undefined,
            "timeout",
          ),
        );
      }, timeouts.headersMs);
    });

    try {
      const headers = new Headers();
      headers.set("User-Agent", this._userAgent);

      if (request.headers !== undefined) {
        for (const [k, v] of Object.entries(request.headers)) {
          headers.set(k, v);
        }
      }
      if (request.ifNoneMatch !== undefined) {
        headers.set("If-None-Match", request.ifNoneMatch);
      }
      if (request.ifModifiedSince !== undefined) {
        headers.set("If-Modified-Since", request.ifModifiedSince);
      }
      if (request.range !== undefined) {
        const end =
          request.range.end !== undefined ? `-${request.range.end}` : "";
        headers.set("Range", `bytes=${request.range.start}${end}`);
      }

      const fetchPromise = globalThis.fetch(request.url, {
        method: request.method ?? "GET",
        headers,
        signal: controller.signal,
        redirect: "follow",
      });

      const response = await Promise.race([
        fetchPromise,
        totalTimeoutPromise,
        headersTimeoutPromise,
      ]);
      if (headersTimer !== undefined) {
        clearTimeout(headersTimer);
        headersTimer = undefined;
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      const body: ReadableStream<Uint8Array> | null = response.body;

      return {
        status: response.status,
        headers: responseHeaders,
        body,
        contentLength:
          response.headers.get("content-length") !== null
            ? Number(response.headers.get("content-length"))
            : null,
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        ok: response.ok,
      };
    } catch (error) {
      cleanup();
      if (error instanceof MarketplaceClientError) throw error;
      if (controller.signal.aborted) {
        throw this._classifyError(
          error instanceof Error ? error : new Error(String(error)),
          undefined,
          "cancelled",
        );
      }
      // Classify network errors more precisely
      const msg = error instanceof Error ? error.message : String(error);
      let kind: TransportErrorKind = "unknown";
      if (/Idle timeout|Headers timeout|Total timeout/.test(msg))
        kind = "timeout";
      else if (/ENOTFOUND|getaddrinfo|DNS/.test(msg)) kind = "dns";
      else if (/ECONNREFUSED|ECONNRESET|connect/.test(msg)) kind = "connect";
      throw this._classifyError(
        error instanceof Error ? error : new Error(String(error)),
        undefined,
        kind,
      );
    } finally {
      cleanup();
    }
  }

  async head(url: string, signal?: AbortSignal): Promise<HeadResult> {
    const result = await this.fetch({ url, method: "HEAD", signal });
    return {
      exists: result.status === 200,
      contentLength: result.contentLength,
      etag: result.etag,
      lastModified: result.lastModified,
      contentType: result.contentType,
      acceptRange:
        (result.headers["accept-ranges"] ?? "").toLowerCase() === "bytes",
    };
  }

  private _classifyError(
    error: Error,
    statusCode: number | undefined,
    kind: TransportErrorKind,
  ): MarketplaceClientError {
    const retryable =
      kind === "timeout" ||
      kind === "connect" ||
      kind === "dns" ||
      kind === "unknown";
    const code =
      kind === "not-found"
        ? "DOWNLOAD_FAILED"
        : kind === "timeout"
          ? "DOWNLOAD_TIMEOUT"
          : kind === "cancelled"
            ? "DOWNLOAD_CANCELLED"
            : "DOWNLOAD_FAILED";

    return new MarketplaceClientError(code, {
      cause: error,
      message: error.message,
      context: { kind, statusCode, retryable },
    });
  }
}
