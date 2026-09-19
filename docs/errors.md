# Errors

## Model

All failures surface as `MarketplaceClientError`:

```typescript
import { MarketplaceClientError } from "@vetwo/marketplace";

try {
  await marketplace.install({ id: "ui-primitives", destination: "./vendor" });
} catch (error) {
  if (error instanceof MarketplaceClientError) {
    console.log(error.code);       // e.g. "DEPENDENCY_NOT_FOUND"
    console.log(error.message);    // human-readable, cause included
    console.log(error.cause);      // underlying error (never dropped)
    console.log(error.context);    // URL, ids, attempts, retry info (secrets redacted)
    console.log(error.reason);     // why it happened
    console.log(error.suggestion); // what to try
    console.log(error.recovery);   // how to recover (often a `doctor` command)
  }
}
```

Rules the codebase follows:

- Every failure carries its **cause** — no bare "Download failed" / bare `ENOENT`.
- Retryable vs terminal is explicit (`retryable`, `retryAfterMs` where known).
- Contexts are secret-redacted before logging/serialization.

## Troubleshooting (most common)

| You see | It means | Do this |
|---|---|---|
| `GITHUB_RATE_LIMIT` with retry timing | GitHub quota exhausted (60/hr anonymous) | Wait for reset, or set `GITHUB_TOKEN` (5000/hr) |
| `RESOURCE_NOT_FOUND` | Bad id (or unresolvable alias) | `search` / `categories` to discover ids |
| `DEPENDENCY_NOT_FOUND` | Required dep missing from registry | Check the manifest; install the dep's source repo |
| `INSTALL_FAILED … Could not download any of N file(s) …` | Every file failed; each `path: reason` is listed | Fix network/auth or the manifest's paths |
| `INTEGRITY_CHECK_FAILED` | Bytes don't match expected SHA | Re-run (transient corruption) or report the resource |
| `REGISTRY_LOAD_FAILED` + stale warning | Remote failed, stale local data served | Informational unless persistent — then `doctor` |
| `INTERNET_UNAVAILABLE` | Offline mode blocked a network op | Go online or rely on cache/local provider |

## Code Catalog (54 codes)

**Network / GitHub**: `NETWORK_ERROR`, `GITHUB_API_ERROR`, `GITHUB_RATE_LIMIT`, `DOWNLOAD_FAILED`, `DOWNLOAD_TIMEOUT`, `DOWNLOAD_CANCELLED`, `INTERNET_UNAVAILABLE`.

**Registry / manifests**: `REGISTRY_NOT_FOUND`, `REGISTRY_INVALID`, `REGISTRY_LOAD_FAILED`, `RESOURCE_NOT_FOUND`, `RESOURCE_INVALID`, `RESOURCE_INCOMPATIBLE`, `MANIFEST_NOT_FOUND`, `MANIFEST_INVALID`, `MANIFEST_PARSE_ERROR`.

**Install**: `INSTALL_FAILED`, `INSTALL_ABORTED`, `INSTALL_TIMEOUT`, `INTEGRITY_CHECK_FAILED`, `DESTINATION_INVALID`, `DESTINATION_EXISTS`, `DESTINATION_NOT_WRITABLE`, `DISK_FULL`, `PERMISSION_DENIED`.

**Dependencies / versions**: `DEPENDENCY_CONFLICT`, `DEPENDENCY_CIRCULAR`, `DEPENDENCY_NOT_FOUND`, `VERSION_NOT_FOUND`, `VERSION_INCOMPATIBLE`.

**Cache / config**: `CACHE_READ_ERROR`, `CACHE_WRITE_ERROR`, `CACHE_CORRUPTED`, `CACHE_OVERFLOW`, `CONFIG_INVALID`, `CONFIG_NOT_FOUND`, `CONFIG_PARSE_ERROR`, `NODE_VERSION_INCOMPATIBLE`.

**Plugins / types / extensions**: `PLUGIN_LOAD_FAILED`, `PLUGIN_HOOK_ERROR`, `PLUGIN_INCOMPATIBLE`, `PLUGIN_DUPLICATE`, `PLUGIN_INIT_FAILED`, `PLUGIN_DISCOVERY_FAILED`, `RESOURCE_TYPE_DUPLICATE`, `RESOURCE_TYPE_NOT_FOUND`, `INSTALLER_NOT_FOUND`, `INSTALLER_DUPLICATE`, `UNSUPPORTED_RESOURCE_TYPE`, `UNSUPPORTED_LIFECYCLE_OPERATION`, `EXTENSION_CONFLICT`, `EXTENSION_VALIDATION_FAILED`, `EXTENSION_DEPENDENCY_CONFLICT`.

**Fallback**: `UNKNOWN_ERROR` (internal guards that should be unreachable).

Full per-code reason/suggestion/recovery text lives in `src/errors/index.ts` (`ERROR_DEFINITIONS`) and is also printed by `error.toString()`.
