# @vetwo/marketplace

Official Package Manager for the VeTwo ecosystem. Registry-driven, plugin-first, extensible.

## Installation

```bash
npm install @vetwo/marketplace
```

Requirements: Node.js >= 20, ESM only.

## Quick Start

```typescript
import { Marketplace } from "@vetwo/marketplace";

const marketplace = new Marketplace();
await marketplace.load(); // cache-first; works offline from cache

await marketplace.search("react");
await marketplace.install({ id: "ui-primitives", destination: "./vendor" });
await marketplace.remove("ui-primitives");
```

## CLI

```bash
npx vetwo-market              # Interactive wizard
npx vetwo-market search react
npx vetwo-market install eslint
npx vetwo-market info tailwind
npx vetwo-market preview react-router
npx vetwo-market doctor
npx vetwo-market cache stats
npx vetwo-market categories
npx vetwo-market tags
npx vetwo-market list
npx vetwo-market remove eslint
npx vetwo-market dependencies react-router
npx vetwo-market update
npx vetwo-market snapshots list
npx vetwo-market lockfile show
npx vetwo-market database list
npx vetwo-market pipeline
```

> **Deprecated alias**: The old `marketplace` command has been renamed to `vetwo-market`. For one release cycle, `npx marketplace` still works but prints a deprecation notice. It will be removed in a future version.

## How It Works

```
@vetwo/marketplace          your code / CLI / TUI
        │ registry · search · install · transactions · cache · offline · doctor
        ▼
@vetwo/repo-fetch           PRIMARY transport (providers, retries, downloads)
        ▼
GitHub / GitLab / …         raw + API endpoints
```

- **Public registry needs no token.** Invalid/expired `GITHUB_TOKEN` never breaks public reads.
- **Rate limits are classified**, not misreported as auth failures, with far-off resets failing fast.
- **Startup is cache-first**: valid local index/cache → ready with zero network requests. On discovery failure, stale local data is served with a warning instead of an empty registry.
- **Single retry owner per path**: repo-fetch retries on the primary path; the native transport only runs after primary fully fails.

## Documentation

| Guide | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Module map, ownership boundaries, startup flow, state layout, design principles |
| [docs/registry.md](docs/registry.md) | Registry loading, manifest schema (files vs folder mode), dependencies, freshness, offline |
| [docs/installation.md](docs/installation.md) | Install flow, 11-stage pipeline, transactions, snapshots, rollback |
| [docs/networking.md](docs/networking.md) | Transport layers, retry policy, rate limits, 403 classification, ETag, offline |
| [docs/configuration.md](docs/configuration.md) | Config cascade, environment variables, offline modes |
| [docs/errors.md](docs/errors.md) | Error model, code catalog, troubleshooting |
| [docs/cli.md](docs/cli.md) | CLI command reference |
| [docs/api.md](docs/api.md) | Public API: `Marketplace`, providers, doctor/health, events, plugins, DI seams |
| [docs/development.md](docs/development.md) | Tests, benchmarks, Knip, scripts, project conventions |
| [docs/security-model.md](docs/security-model.md) | Security model |
| [docs/plugin-security.md](docs/plugin-security.md) | Plugin security |

## Quick Reference

**Manifest schema** ([details](docs/registry.md)): `resource.json` (also `manifest.json`, `vetwo.json`, `package.json` with `vetwo.resource`). Manifests may list explicit `files` or ship a whole folder; dependencies use `{ "<id>": "<range>" }` object form; canonical scoped ids (`@scope/name`) resolve as aliases.

**Install pipeline** ([details](docs/installation.md)): resolve → compatibility → dependency → download → integrity → variables → transform → merge → write → post-install → report. Dependency closures install recursively; every failure carries its cause.

**State** ([details](docs/architecture.md)): everything persistent lives under `.vetwo/marketplace/` (`cache/`, `database/`, `snapshots/`, `resources/`, `locks/`, `reports/`, `logs/`, `tmp/`, `state/`, `indexes/`, `transactions/`, `plugins/`).

**Config cascade** ([details](docs/configuration.md)): programmatic > environment (`GITHUB_TOKEN`, `VETWO_MARKETPLACE_*`) > config file > defaults.

## License

MIT
