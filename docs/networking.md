# Networking

## Layers

```
Marketplace (registry · downloader · installer)
  │ primary: RepoFetchClient (src/registry/repo-fetch-client.ts)
  ▼
@vetwo/repo-fetch  (providers, p-retry, timeouts, trees, file fetch, downloads)
  ▼
GitHub raw + API (public repo needs no credentials)

  fallback (only after primary fully fails — never concurrent):
Marketplace → GitHubRepositoryTransport → shared Node fetch pool (single-flight, ETag)
          → DownloadEngine (streaming, bounded queue, atomic writes)
```

`RepoFetchClient` exposes `readText`, `getTree`, `downloadTo` (atomic + checksum), `downloadMany`/`downloadFolder` (per-file errors preserved). Every error is mapped to `MarketplaceClientError` with the underlying `cause` and a message that states the reason — failures never surface bare.

## Authentication

- The official repository is public: reads work with **no token**.
- A configured token is forwarded where supported; file downloads use plain raw URLs.
- **An invalid/expired token never breaks public access**: a 401/403 with a token falls back to an unauthenticated retry, which succeeds for public resources.

## 403 Classification

A 403 is inspected before it is labeled:

| Case | Signal | Behavior |
|---|---|---|
| Rate limit | `429`, or 403/401 **with** `x-ratelimit-remaining: 0` / `retry-after` / reset headers | `GITHUB_RATE_LIMIT` with retry timing + "set GITHUB_TOKEN" guidance |
| Public + bad token | 401/403 with `Authorization`, unauthenticated retry succeeds | Silent fallback, debug log |
| Private resource | 403 on both attempts, no rate-limit signals | `GITHUB_API_ERROR` with `authRequired: true` |
| Other | any other 403/4xx/5xx | `GITHUB_API_ERROR` / `NETWORK_ERROR` with URL + status preserved |

It is never blanket-labeled "Authentication/authorization failed".

## Retry Policy

- **Single owner per path.** repo-fetch retries internally on primary; the native layers retry only on fallback. Layers never multiply each other.
- **Transient only**: 408/429/5xx, timeouts, connection/DNS errors. 404, integrity failures, cancelled requests, and non-retryable responses never retry.
- **Backoff with jitter**, capped per-attempt delays.
- **Far-off rate limits fail fast**: metadata reads throw immediately when `retry-after` exceeds the delay cap; the download engine stops after two consecutive rate limits (one transient 429 is still retried and may succeed — see `honors Retry-After on 429 then succeeds`).
- **Fallbacks are skipped under rate limit**: retrying elsewhere would hit the same wall and only burn quota.

## Efficiency

- Shared process-wide fetch pool (keep-alive connection reuse), no per-request clients.
- Request deduplication (single-flight) for identical concurrent reads.
- Conditional requests (`ETag`/`If-None-Match`, `Last-Modified` → `304`).
- Bounded concurrency everywhere; streaming downloads (never buffer whole artifacts); atomic `*.part` → rename finalization; checksum + size verification.
- Prefer raw/content URLs; `registry.json` loads in one request; tree scans only when discovery requires them.

## Offline

See [registry.md](registry.md): offline mode never attempts network (guarded at the boundary); stale index/cache serve reads; otherwise a clear actionable error is returned instead of a crash.
