# Installation

## Flow

```
install({ id, destination, force?, dryRun?, skipDependencies?, skipValidation?, concurrency? })
  ↓ resolve resource (+ version)
  ↓ resolvePlan → topological install order (cycles/conflicts checked)
  ↓ createTransaction (write-ahead journal; manager self-initializes)
  ↓ pre-install snapshot (best-effort, warned — never fatal)
  ↓ _downloadResourceFiles
  │     files-mode:  explicit `files` → repo-fetch batch (fallback: engine),
  │                  zero-success → INSTALL_FAILED listing every per-file cause
  │     folder-mode: no `files` → whole manifest directory via repo-fetch,
  │                  real manifest replaces the synthesized stub
  ↓ pipeline (11 stages, content read back from disk — correct paths, real bytes)
  ↓ integrity validation → report → hooks → lockfile → database → commit
  ↓ dependency closure: each planned dep installs recursively (skipDependencies),
      a failed required dep fails the whole install with its cause
```

`dryRun: true` returns the plan without touching disk. `remove(id)` deletes the resource directory; `list()` enumerates the destination.

## The 11 Stages

1. **Resolve** — look up the resource.
2. **Compatibility** — Node/platform/framework checks.
3. **Dependency** — attach the plan (informational; closure handled by installer).
4. **Download** — stage file entries (content already on disk from the fetch phase).
5. **Integrity** — SHA-256 of content vs expected; mismatches fail with both hashes.
6. **Variables** — `{{var}}` replacement.
7. **Transform** — registered transforms (per resource type).
8. **Merge** — per-file merge strategy (`copy`/`replace`/`merge`/`append`/`prepend`/`patch`).
9. **Write** — atomic writes to the destination.
10. **Post-install** — lockfile + database updates.
11. **Report** — installation report.

## Transactions & Safety

- Every install runs inside a write-ahead journaled transaction (`created → preparing → snapshotting → executing → writing → committing → committed`, with `rolling-back/rolled-back/failed/recovery-required`).
- `SIGINT`/`SIGTERM` mark active transactions `recovery-required` instead of losing them; the next run can recover (single signal owner: `TransactionManager`).
- Snapshots allow rollback; the lockfile (`vetwo.lock.json`) and database record what landed.
- Files are written via `*.part` + atomic rename; failed downloads never corrupt existing files and clean up their temp files.

## Deterministic Mode (Tests)

`TransactionManager` accepts injected seams with zero default-behavior change:

```typescript
import { TransactionManager } from "@vetwo/marketplace";
import { FakeClock, DeterministicIdGenerator } from "@vetwo/marketplace";

const tx = new TransactionManager(state, logger, events, {
  clock: new FakeClock(Date.parse("2026-01-01T00:00:00Z")),
  ids: new DeterministicIdGenerator("tx"), // tx_0000, tx_0001, …
});
```
