export interface ContentTransportRequest {
  readonly url: string;
  readonly method?: "GET" | "HEAD";
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly timeout?: TransportTimeouts;
  readonly ifNoneMatch?: string;
  readonly ifModifiedSince?: string;
  readonly range?: { start: number; end?: number };
}

export interface TransportTimeouts {
  readonly connectMs?: number;
  readonly headersMs?: number;
  readonly idleMs?: number;
  readonly totalMs?: number;
}

export interface ContentTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly contentLength: number | null;
  readonly contentType: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly ok: boolean;
}

export interface HeadResult {
  readonly exists: boolean;
  readonly contentLength: number | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly contentType: string | null;
  readonly acceptRange: boolean;
}

export interface ContentTransport {
  fetch(request: ContentTransportRequest): Promise<ContentTransportResponse>;
  head(url: string, signal?: AbortSignal): Promise<HeadResult>;
}

export type TransportErrorKind =
  | "dns"
  | "connect"
  | "timeout"
  | "tls"
  | "http"
  | "rate-limit"
  | "auth"
  | "not-found"
  | "redirect"
  | "cancelled"
  | "unknown";

export interface TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}
