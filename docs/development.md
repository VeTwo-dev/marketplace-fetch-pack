# Development

## Scripts

| Script | Purpose |
|---|---|
| `npm run build` | `tsup`: ESM + DTS (`dist/index.js`) + CLI (`dist/cli/index.js`) |
| `npm test` / `test:watch` / `test:coverage` | Vitest (coverage thresholds: 95% lines/functions/branches/statements; `src/cli/**` + `src/types/**` excluded) |
| `npm run lint` | ESLint over `src/` (tests excluded) |
| `npm run format` / `format:check` | Prettier over `src/**/*.ts` |
| `npm run verify:live` | Live 15-step checklist against the real marketplace (`benchmarks/live-verify.mjs`) |
| `npm run verify:play` | Live end-to-end play incl. offline comparison (`benchmarks/real-play.mjs`) |
| `npx knip` | Unused-code audit (config: `knip.json`; should report nothing) |
| `npm run clean` | Remove `dist/` |

## Tests

- Layout: `tests/unit/*.test.ts` (+ `tests/benchmarks/perf.test.ts`, `tests/fixtures/`).
- Policy: deterministic local HTTP servers for network behavior — **never hit real GitHub in automated tests** (the two `verify:*` scripts are the explicit exception; they are tools, not tests).
- Known flakes, all load-related (pass in isolation): full-suite parallel transform contention and real-network doctor checks. Hardened via hoisted imports and explicit timeouts (`extension-integration`, `doctor-enhanced` 60s, `github-403` 30s) — do not "fix" by weakening assertions.
- Regression suites worth knowing: `real-world-install` (folder-schema manifests, dep aliases/closure, loud failures), `repo-fetch-client` (primary adapter vs local fixture provider), `github-403-public-access` (token fallback, rate-limit classification, fast-fail), `transport-download` (engine semantics), `registry-resilience` (stale fallback, fallback skip).

## Benchmarks

- `benchmarks/live-verify.mjs`, `benchmarks/real-play.mjs`: runnable with plain `node` (Node ≥ 22 type-stripping covers the `.ts` import). Require `dist/` built; online steps hit the public repo (60/hr anonymous quota — set `GITHUB_TOKEN` for sustained runs).
- `tests/benchmarks/perf.test.ts`: in-suite relative-threshold perf tests (stable on slow CI).

## Conventions

- ESM only (`import … .js` specifiers for relative files), strict TS, prettier formatting.
- Public surface = `src/index.ts` only; no internal barrels (`src/types/index.ts` etc. were removed deliberately — import per-module paths).
- Errors: always `MarketplaceClientError` with `cause`; contexts secret-redacted.
- State under `.vetwo/marketplace/` only; downloads via `*.part` + atomic rename.
- Single-owner rules: one retry owner per path, one signal owner (`TransactionManager`), one state root.
- No new direct GitHub HTTP in Marketplace proper — transport lives in `@vetwo/repo-fetch` (+ the documented native fallback).
- Dynamic imports only for CLI command loading and the optional (unpublished) sound package.

## Lockfiles & Toolchain

`package.json` is the source of truth; `package-lock.json`, `pnpm-lock.yaml`, `bun.lock` are all kept in sync. TypeScript follows the lockfiles (`^5.9.3` — v7 breaks `typescript-eslint`). `vite` is an explicit devDependency (vitest peer). `knip.json` documents the single legitimate exception (`@vetwo/cli-sound`, dynamic optional import).
