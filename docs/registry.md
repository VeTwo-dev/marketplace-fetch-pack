# Registry

## Loading Strategy

`RegistryClient.load()` resolves in this order:

1. **Fresh local index** (`indexes/registry-index.json`, schema v4) → served with zero network.
2. **Fresh cache** → served with zero network (stale-while-revalidate in background when due).
3. **Remote refresh** → `RegistryDiscovery`:
   - Try `registry.json` at the repo root (single raw read, preferred).
   - Fall back to **manifest scan**: full git tree → every `resource.json` / `manifest.json` / `vetwo.json` / `package.json` (with `vetwo.resource`) is fetched, parsed, validated.
4. **Stale fallback** — if remote fails (rate limit, outage) *and* a local index or cache entry exists, it is served with a `Using stale …` warning. Startup never yields an empty registry when usable data exists.
5. **Clear error** — only when there is no local data *and* the network fails.

`load({ force: true })` bypasses everything and refetches. `load({ refresh: true })` revalidates.

## Manifest Schema

Recognized files (checked in this order): `resource.json`, `manifest.json`, `vetwo.json`, `package.json` (requires a `vetwo.resource` object).

```jsonc
{
  "id": "@vetwo/component-ui-primitives", // canonical scoped id (optional, kept as alias)
  "name": "ui-primitives",                // registry key (required)
  "version": "1.0.0",                     // semver (required)
  "description": "…",                     // (required)
  "author": { "name": "Vetwo Team" },     // string or object (required)
  "category": "ui",                       // (required)
  "tags": ["ui", "components"],           // (required, array)
  // EITHER an explicit file list…
  "files": [{ "path": "src/index.ts", "sha": "<sha256>", "size": 1234 }],
  // …OR nothing: the manifest's whole directory is installed (folder mode)
  "dependencies": { "@vetwo/core-registry-types": "1.0.0" }, // object form…
  // …or array form: [{ "id": "dep", "version": "^1.0.0", "optional": true }]
}
```

Notes:

- `files` entries may carry expected `sha` (integrity-verified) and `size`.
- A manifest **without** `files` installs its entire directory (minus unsafe paths). This is the schema the official marketplace repository uses.
- `dependencies` accepts both the object map form and the array form.
- The registry key stays the short `name`; a declared `id` is kept as `manifestId` and resolves everywhere as an alias (lookup, version filtering, dependency graph, `install("@scope/name")`).

## Dependencies & Versions

`DependencyResolver` builds the graph from `dependencies`, resolves version ranges with semver, detects cycles and conflicts, and produces a topological install order (`resolvePlan`). Missing **required** dependencies throw `DEPENDENCY_NOT_FOUND` with both ids; missing **optional** ones are skipped with a debug log — never silently dropped.

## Freshness, Index & Cache

- The persistent index (`indexes/registry-index.json`) carries `schemaVersion` (currently 4); a mismatch invalidates it and forces a rebuild. The in-memory resource index supports incremental updates on refresh.
- Freshness policies (`normal` default) decide fresh / stale / revalidate. Stale data is served while revalidating in the background.
- Conditional requests (`ETag` / `If-None-Match`, `Last-Modified`) avoid re-downloading unchanged registry data (`304` → cached body).

## Offline

- `offline: true` (or `networkMode: "offline"` / `prefer-offline`): network is never attempted; index → cache → clear `offlineCapabilityFailure` diagnostics if nothing is cached.
- `NetworkAccessGuard` + the repo-fetch client's offline flag enforce this at the transport boundary.
- Local providers (`LocalRegistryProvider`) work fully offline.
