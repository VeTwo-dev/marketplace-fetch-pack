import type { Transport, NetworkRequest, NetworkResponse } from "./types.js";
import { MarketplaceClientError } from "../errors/index.js";

export class NodeTransport implements Transport {
  async fetch(request: NetworkRequest): Promise<NetworkResponse> {
    const timeout = request.timeout ?? 30_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    if (request.signal !== undefined) {
      request.signal.addEventListener("abort", () => controller.abort());
    }

    const startTime = Date.now();

    try {
      const headers = new Headers(request.headers);
      if (request.body !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      if (request.cache?.etag !== undefined) {
        headers.set("If-None-Match", request.cache.etag);
      }
      if (request.cache?.lastModified !== undefined) {
        headers.set("If-Modified-Since", request.cache.lastModified);
      }

      const response = await globalThis.fetch(request.url, {
        method: request.method ?? "GET",
        headers,
        body: request.body,
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      if (response.status === 304) {
        return {
          status: 304,
          statusText: "Not Modified",
          headers: responseHeaders,
          body: "",
          fromCache: true,
          duration: Date.now() - startTime,
        };
      }

      const body = await response.text();

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
        fromCache: false,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new MarketplaceClientError("DOWNLOAD_TIMEOUT", {
          message: `Request to ${request.url} timed out after ${timeout}ms`,
          context: { url: request.url, timeout },
        });
      }
      throw new MarketplaceClientError("NETWORK_ERROR", {
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { url: request.url },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
