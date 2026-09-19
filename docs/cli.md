# CLI Reference

Binary: `vetwo-market` (deprecated alias `marketplace` still works with a warning).

Global flags: `-d/--destination`, `-v/--version`, `-f/--force`, `--dry-run`, `--no-color`, `--verbose`, `--quiet`, `-h/--help`, `--version`, `--debug`. With no command, the interactive Ink TUI wizard launches.

## Commands

| Command | Purpose |
|---|---|
| `search <query>` | Search the local registry index (keyword, tags, category, author) |
| `info <id>` | Show a resource's manifest details |
| `install <id>` | Install a resource + dependency closure (`--dry-run` previews) |
| `preview <id>` | Dry-run preview of an install |
| `remove <id>` | Remove an installed resource |
| `list` | List installed resources in the destination |
| `dependencies <id>` | Print the dependency graph/plan |
| `update` | Refresh installed resources |
| `categories` / `tags` | Browse the registry taxonomy |
| `wizard` | Guided install wizard (non-TUI) |
| `cache` | Cache inspection (`cache stats`) |
| `doctor` | Run the 15 on-demand diagnostics checks (incl. `health`) |
| `snapshots list` | List pre-install snapshots (rollback source) |
| `lockfile show` | Show `vetwo.lock.json` entries |
| `database list` | Query the local install database/history |
| `pipeline` | Inspect the install pipeline |

## Doctor

`vetwo-market doctor` runs 15 independent checks — one failure never blocks the others: `node-version`, `internet`, `github`, `permissions`, `cache`, `registry`, `configuration`, `state-directory`, `lockfile`, `stale-locks`, `transactions`, `health`, `disk-space`, `installed-state`, `resource-types`.

- Network checks are skipped (not failed) in offline mode.
- `health` aggregates runtime state (state/cache/transactions/local registry) with zero network access.
- Token is used for checks but never recorded in results.

## TUI

The fullscreen wizard (`npx vetwo-market`) flows splash → main menu → category → resources → preview → install, driven by registry data. Keyboard-first (`~` toggles sound when the optional sound package is present). Startup is a single cache-first registry load — there is no connection-test stage.
