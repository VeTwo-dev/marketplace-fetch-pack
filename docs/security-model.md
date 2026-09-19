# Security & Trust Model

## Trust levels

| Level | Data / Code | Trust | Handling |
|---|---|---|---|
| T1 | User configuration, environment | **Trusted** (user's own) | Validated for shape; secrets never logged |
| T2 | Marketplace core state (`.vetwo/marketplace/`) | Trusted after validation | Integrity + schema checked on read |
| T3 | Official registry metadata (`registry.json`) | Semi-trusted | Schema-validated; malformed entries rejected without crashing |
| T4 | Resource manifests | Untrusted | Defensive parsing; schema-version gated; paths sanitized |
| T5 | Resource files | Untrusted | Sandbox, size limits, symlink policy, integrity verification |
| T6 | Plugins / installers / transforms / resource types | **Executable code** | Explicit registration only; capability + permission declaration; compatibility gate |
| T7 | Cache content | Untrusted until validated | Hash/schema validated; corrupted entries invalidated |

## Enforcement points

1. **Path sandbox** — every resource-provided path passes `resolveWithinRoot()` before any I/O
2. **Symlink policy** — `allowSymlinks: false` by default; even allowed symlinks may not escape the destination root (canonical realpath walk)
3. **Resource bombs** — per-file size, total size, and file-count limits enforced in the generic installer
4. **Dependency explosion** — depth limit enforced inside the dependency resolver; count limit via `assertDependencyLimits`
5. **URL security** — protocol allowlist (https only by default), private-network/SSRF block, credentials-in-URL rejected
6. **Redirects** — sensitive headers never forwarded cross-origin (`mayForwardSensitiveHeaders`)
7. **Script execution** — denied by default (`scriptExecution: "deny"`); resources can never trigger commands merely by containing them
8. **Manifest versioning** — future `schemaVersion` values fail clearly at parse time
9. **Plugin gate** — explicit discovery, shape validation, marketplace-version compatibility, inspectable `permissions[]`
10. **Secret redaction** — centralized in error context construction; tokens/auth headers/credential URLs replaced with `<redacted>`

## Honest limits

Plugins execute with full Node.js process privileges — there is no sandboxing.
Mitigation is procedural: explicit registration, validation, permissions as
inspectable declarations, and deterministic failure isolation. See
`docs/plugin-security.md`.
