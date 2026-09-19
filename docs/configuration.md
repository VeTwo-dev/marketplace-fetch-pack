# Configuration

## Cascade (highest wins)

1. **Programmatic** — `new Marketplace({ config })` or `load(config)` (also preserved across `load()` with no args).
2. **Environment variables**.
3. **Config file** — `marketplace.config.{ts,js,mjs,cjs,json}` from the working directory.
4. **Defaults** — official public repository, `main` branch, cache under `.vetwo/marketplace/`.

Invalid programmatic config throws `CONFIG_INVALID` with per-field details instead of failing later.

## Environment Variables

| Variable | Effect |
|---|---|
| `GITHUB_TOKEN` | Higher GitHub rate limits (5000/hr vs 60/hr); also `REPO_FETCH_TOKEN` is honored by repo-fetch |
| `VETWO_MARKETPLACE_REPOSITORY` | Override registry repository URL |
| `VETWO_MARKETPLACE_BRANCH` | Override branch (default `main`) |
| `VETWO_MARKETPLACE_DESTINATION` | Override install destination |
| `VETWO_MARKETPLACE_LOG_LEVEL` | `debug` / `info` / `warn` / `error` / `silent` |
| `VETWO_MARKETPLACE_CACHE_DIR` | Override cache directory |
| `VETWO_MARKETPLACE_CACHE_ENABLED` | `true` / `false` |
| `VETWO_MARKETPLACE_OFFLINE` | `true` forces offline mode |

## Network Modes

| Mode | Behavior |
|---|---|
| `online` (default) | Remote refresh with cache; stale fallback with warning on failure |
| `offline` | Never touches the network; serves index/cache or errors clearly |
| `prefer-offline` | Serves local state first; remote only fills gaps; failures degrade gracefully |

## Timeouts & Concurrency

Defaults: 30s request timeout, bounded concurrency (5 registry/manifest, engine queue configurable). Downloads honor server `Retry-After`; far-off resets fail fast instead of blocking.
