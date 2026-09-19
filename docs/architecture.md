# Architecture

## Module Map

```
src/
  index.ts            Public API barrel (the only library entry point)
  marketplace/        Core `Marketplace` facade (config, lifecycle, delegation)
  registry/           RegistryClient, discovery (registry.json → manifest scan),
                      RepoFetchClient (primary fetch adapter), freshness, index
  manifest/           Manifest parsing (4 formats) + validation
  downloader/         Downloader facade (repo-fetch primary, native fallback)
  download/           DownloadEngine (streaming fallback engine, bounded queue)
  transport/          Native transport fallback (shared fetch pool, single-flight)
  network/            Alternate NetworkClient transport + mock (public API)
  dependencies/       Dependency graph + plan resolver (alias-aware)
  versions/           Semver parser and version resolver
  installer/          Installer (files/folder modes, dep closure, pipeline wiring)
  installer-registry/ Installer registry (per-type installers)
  pipeline/           11-stage install pipeline (core + stages/)
  transaction/        Journaled transactions (lazy self-initializing)
  snapshot/           Pre-install snapshots with rollback
  state/              Canonical state root, history, recovery
  installed-state/    Installed-state tracking
  cache/              Legacy TTL cache + CacheManager (unified)
  offline/            OfflinePolicy, NetworkAccessGuard, capabilities (no barrel)
  health/             getHealth() runtime probe (wired into doctor)
  doctor/             15 on-demand diagnostics checks (incl. health)
  search/             Local-index search engine
  providers/          Public provider API (GitHub, Local, HTTP)
  resource-types/     Resource-type registry (extensible)
  transform/ merge/   Content transform + merge engines
  template/ variables/ Template + {{variable}} engines
  compat/             Compatibility shims
  detection/          Project detection (frameworks, runtimes, bundlers)
  lockfile/           vetwo.lock.json management
  database/           Local JSON database + history
  diagnostics/        DiagnosticCollector + PerformanceTimeline
  reconciliation/     State reconciliation helpers
  events/             Typed async EventBus (67 events)
  hooks/              Hook system core
  plugins/            PluginManager (16 hook points)
  extensions/         Example provider (proof of extensibility)
  logger/             Leveled loggers with child scopes
  errors/             MarketplaceClientError + 54 codes
  config/             ConfigManager (cascade + validation)
  constants.ts        Official repo URL, CLI name
  abstractions/       Clock + IdGenerator DI seams (wired into transactions)
  ast/                JSON/JS-TS import/export extraction
  security/           Path sandboxing, integrity helpers
  storage/            Storage helpers
  utils/              Shared utilities (hashing, grouping, …)
  cli/                CLI entry (src/cli/index.ts), commands, Ink TUI
  ui/                 Shared TUI primitives actually used (FormWizard, theme)
  types/              Per-module type definitions (no barrel; exported via index)
```

Per-module type definitions live next to their domains (`src/types/*.ts`, imported directly — there is intentionally no `src/types/index.ts` barrel). Test-only helpers live under `tests/`.

## Ownership Boundaries

```
@vetwo/marketplace          domain + application concerns:
                            registry · manifests · search · dependencies ·
                            install · pipeline · transactions · snapshots ·
                            state · cache · offline · doctor/health ·
                            diagnostics · plugins · TUI

@vetwo/repo-fetch           PRIMARY repository/network transport:
                            resolution · providers · HTTP · retries ·
                            timeouts · trees · file fetching · downloads

Network (GitHub/…)          raw + API endpoints
```

Rules:

- Marketplace never reimplements transport concerns (no second HTTP client, no second retry system, no connection pools).
- The native transport (`src/transport/`, `src/download/DownloadEngine`) exists **only as fallback**: it runs after the primary fully fails, never concurrently for the same read.
- One retry owner per path: repo-fetch on primary; engine/transport on fallback.
- Offline is enforced at transport boundaries (`NetworkAccessGuard`, `RepoFetchClient` offline flag).

## Startup Flow

```
CLI / new Marketplace()
  ↓
load(config?)
  ↓ config cascade → rebuild components → init state/cache
  ↓
RegistryClient.load()
  ├─ fresh local index? → serve, zero network
  ├─ fresh cache? → serve, zero network (+ background revalidate)
  ├─ stale index/cache? → try remote refresh…
  │    └─ remote fails? → SERVE STALE with warning (never empty)
  └─ nothing local + remote fails? → clear error
  ↓
Marketplace ready (search index + dep resolver populated)
```

There is deliberately **no "can I reach GitHub?" connection check**. The TUI splash runs a single load stage ("Loading Registry"); the old separate "Connecting to GitHub" stage was removed.

## State Layout

All persistent state lives under `<project>/.vetwo/marketplace/`:

| Directory | Contents |
|---|---|
| `cache/` | Legacy TTL cache entries |
| `database/` | Local JSON database (`entries.json`, `history.json`) |
| `snapshots/` | Pre-install snapshots for rollback |
| `resources/` | Default install destination |
| `locks/` | Process locks |
| `reports/` | Generated reports |
| `logs/` | Log files |
| `tmp/` | Temp files (`.part` downloads, staging) |
| `state/` | State manager root + meta |
| `indexes/` | Persistent registry index (`registry-index.json`, schema v4) |
| `transactions/` | Write-ahead transaction journals |
| `plugins/` | Namespaced plugin state |

No competing state roots. Downloads always land via `*.part` + atomic rename.

## Design Principles

- **Zero hardcoded assumptions** — categories, resource types, folder structures are discovered dynamically. The only fixed identity is the default repository `VeTwo-dev/VeTwo-Market-Place`.
- **Cache-first / offline-first** — startup and reads prefer local data; network is a refresh mechanism, not a requirement.
- **Fail loudly with causes** — every install/download failure carries the underlying reason (`cause` + message). Silent stub-only installs and bare `ENOENT`s were eliminated.
- **Single ownership** — one retry owner, one signal owner (`TransactionManager`), one state root.
- **Extensibility without core changes** — providers, resource types, installers, transforms, merges, and plugins all register through registries (`src/extensions/example-provider.ts` proves it).
- **IDs are stable, aliases resolve** — registry keys stay short names; canonical `@scope/name` manifest ids resolve as aliases everywhere (lookup, version filter, dependency graph).
