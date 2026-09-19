# Public API

Package entry: `@vetwo/marketplace` → `dist/index.js` (+ types). Everything below is importable from the root.

## Core

```typescript
import {
  Marketplace,
  MarketplaceClientError,
  RepoFetchClient,
  getSharedTransport,
} from "@vetwo/marketplace";

const mp = new Marketplace({ config?: {...}, logger? });
await mp.load();                       // or load(config) — preserves ctor config
await mp.load({ offline: true });      // cache/index only, never network

mp.config; mp.loaded;
await mp.search("react");              // SearchResult from local index
await mp.resources();                  // RegistryResource[]
await mp.categories();
await mp.info(id);                     // Resource | null
await mp.install({ id, destination, force?, dryRun?, skipDependencies?, skipValidation?, concurrency? });
await mp.remove(id);                   // uses config destination
await mp.list();
await mp.dependencies(id);             // DependencyGraph
await mp.update();
await mp.doctor();                     // DoctorReport { result, healthy, timestamp }
await mp.detectProject(root?);
await mp.getRecommendedFrameworks();
await mp.cacheStats(); await mp.cacheClear();
await mp.diagnostics(); await mp.debugReport();
mp.timeline; mp.diagnosticsCollector;
mp.getTypeRegistry(); mp.getInstallerRegistry();
mp.setProvider(provider);              // custom RegistryProvider
```

`install()` accepts a bare id string or full options. `destination` falls back to config. Constructor `config` is applied immediately and preserved across bare `load()`.

## Transport & Fetch

- `RepoFetchClient` — primary fetch adapter (`readText`, `getTree`, `downloadTo`, `downloadMany`, `downloadFolder`), offline-aware, error causes preserved.
- `GitHubRepositoryTransport`, `getApiBase`, `getRawBase`, `NodeFetchTransport`, `getSharedTransport` — native fallback layer (runs only after primary fully fails).
- `Downloader`, `DownloadEngine` — file download facades.

## Registry & Manifests

`RegistryClient`, `RegistryDiscovery`, `ManifestParser`, `VersionResolver`, `InstallationPlanBuilder`, `DependencyResolver`, `SearchEngine`, registry-index/snapshot/freshness/provider-capability/single-flight/resource-index/concurrency/diagnostics helpers.

## Install & Safety

`Installer`, `InstallPipeline` + `createInstallPipeline`, transform/merge registries, snapshot manager, `TransactionManager` (+ `TransactionManagerOptions` for `{ clock, ids }` DI), lockfile/database services, `ProjectDetector`.

## Operations

- `Doctor` (+ `DoctorDeps.updateDeps`), `getHealth` / `HealthStatus` — lazy aggregate probe, zero network.
- `Cache`, `CacheManager`, `EventBus` (67 events, see `src/types/events.ts`), `DiagnosticCollector`, `PerformanceTimeline`.
- `ConfigManager` + validators; `createLogger`.

## Extensibility

- Providers: `GitHubRegistryProvider`, `LocalRegistryProvider`, `HttpRegistryProvider` (+ capabilities). See `src/extensions/example-provider.ts`.
- `PluginManager`, `createPlugin`, `HookSystem` (16 hook points: lifecycle, search, install, download, registry, wizard, …).
- `createVariableResolver`, `createTemplateEngine`, `createASTTransformer`, `detectLanguage`.
- Deterministic seams: `systemClock`/`FakeClock`/`Clock`, `defaultIdGenerator`/`DeterministicIdGenerator`/`IdGenerator`.
- Errors: `MarketplaceClientError`, `createError`, all types under `./types/*` (re-exported per-module, no barrel).

## Events (selection)

`before/afterRegistryLoad`, `before/afterDiscovery`, `before/afterInstall`, `before/afterDownload` (+`downloadProgress/Retry/Cancelled`), `before/afterWrite/Transform/Merge`, `before/afterSearch/Preview`, `before/afterRollback/Snapshot/LockUpdate`, `before/afterPipelineStage`, `onError`, cache events (`Hit/Miss/Set/Invalidate/Evict/Corrupt/Prune`), plugin/type/installer registry events, `networkAccessBlocked`, `offlineFallback`, `staleDataUsed`, `localRegistryLoaded`, `transaction*` lifecycle. Full list: `src/types/events.ts`.
