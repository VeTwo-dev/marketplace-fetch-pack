# Plugin Security Boundary

## Honest statement of privileges

Marketplace plugins execute as regular Node.js modules inside the same
process as the Marketplace itself. **Plugins are NOT sandboxed.** A plugin
has the same filesystem, network, and process privileges as Marketplace.

Do not install plugins you do not trust.

## Mitigations implemented by the core

Even though code execution cannot be sandboxed at the library level, the
core enforces the following boundaries:

1. **Explicit discovery only**
   - Plugins are loaded ONLY when explicitly listed in configuration:
     ```yaml
     plugins:
       - "@vetwo/marketplace-plugin-x"
       - "./local-plugin"
     ```
   - The core NEVER scans `node_modules`, never walks the filesystem, and
     never auto-executes discovered packages.

2. **Shape validation before registration**
   - Every discovered module must export a value matching the
     `MarketplacePlugin` contract (`manifest.id/name/version/capabilities`
     + `hooks`). Arbitrary exports are rejected (`isPluginShape`).

3. **Manifest validation**
   - Non-empty `id`, `name`, and `version` are enforced.
   - Duplicate plugin IDs are rejected with a structured error.

4. **Version compatibility gate**
   - Plugins may declare `marketplaceVersion` (e.g. `">=1.0.0 <2.0.0"`).
     Incompatible plugins fail fast at registration — they are never
     initialized "hoping they work".

5. **Capability-based access**
   - Plugins declare capabilities; the core queries by capability rather
     than trusting plugins implicitly.

6. **Failure isolation**
   - A failing plugin transitions to `failed`; its registered hooks are
     removed; unrelated plugins continue per the failure policy.
   - Initialization errors never leave partially-registered hooks.

7. **Namespaced state**
   - Persistent plugin state must live under
     `.vetwo/marketplace/plugins/<plugin-id>/state.json`.
   - Path traversal in plugin IDs is sanitized.

8. **Controlled context**
   - `PluginContext` exposes only logger/config/state/events facades —
     not internal mutable state or private internals.

9. **Deterministic disposal**
   - Plugins are disposed in reverse initialization order so resources
     (timers, watchers, sockets) do not leak into shutdown.

## What the core does NOT guarantee

- Memory isolation between plugins.
- CPU/time quotas for hook handlers.
- Filesystem restrictions beyond state-directory conventions.
- Network egress filtering.
