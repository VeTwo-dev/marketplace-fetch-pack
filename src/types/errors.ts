export type ErrorCode =
  | "NETWORK_ERROR"
  | "GITHUB_API_ERROR"
  | "REGISTRY_NOT_FOUND"
  | "REGISTRY_INVALID"
  | "REGISTRY_LOAD_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_INVALID"
  | "RESOURCE_INCOMPATIBLE"
  | "MANIFEST_NOT_FOUND"
  | "MANIFEST_INVALID"
  | "MANIFEST_PARSE_ERROR"
  | "INSTALL_FAILED"
  | "INSTALL_ABORTED"
  | "INSTALL_TIMEOUT"
  | "DOWNLOAD_FAILED"
  | "DOWNLOAD_TIMEOUT"
  | "DOWNLOAD_CANCELLED"
  | "DEPENDENCY_CONFLICT"
  | "DEPENDENCY_CIRCULAR"
  | "DEPENDENCY_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "VERSION_INCOMPATIBLE"
  | "CACHE_READ_ERROR"
  | "CACHE_WRITE_ERROR"
  | "CACHE_CORRUPTED"
  | "CACHE_OVERFLOW"
  | "CONFIG_INVALID"
  | "CONFIG_NOT_FOUND"
  | "CONFIG_PARSE_ERROR"
  | "PLUGIN_LOAD_FAILED"
  | "PLUGIN_HOOK_ERROR"
  | "PLUGIN_INCOMPATIBLE"
  | "PLUGIN_DUPLICATE"
  | "PLUGIN_INIT_FAILED"
  | "PLUGIN_DISCOVERY_FAILED"
  | "RESOURCE_TYPE_DUPLICATE"
  | "RESOURCE_TYPE_NOT_FOUND"
  | "INSTALLER_NOT_FOUND"
  | "INSTALLER_DUPLICATE"
  | "UNSUPPORTED_RESOURCE_TYPE"
  | "UNSUPPORTED_LIFECYCLE_OPERATION"
  | "EXTENSION_CONFLICT"
  | "EXTENSION_VALIDATION_FAILED"
  | "EXTENSION_DEPENDENCY_CONFLICT"
  | "PERMISSION_DENIED"
  | "DISK_FULL"
  | "INTEGRITY_CHECK_FAILED"
  | "DESTINATION_INVALID"
  | "DESTINATION_EXISTS"
  | "DESTINATION_NOT_WRITABLE"
  | "GITHUB_RATE_LIMIT"
  | "INTERNET_UNAVAILABLE"
  | "NODE_VERSION_INCOMPATIBLE"
  | "UNKNOWN_ERROR";

export type ErrorSeverity = "info" | "warning" | "error" | "fatal";

export type ErrorCategory =
  | "configuration"
  | "network"
  | "authentication"
  | "authorization"
  | "registry"
  | "manifest"
  | "cache"
  | "download"
  | "integrity"
  | "dependency"
  | "installation"
  | "filesystem"
  | "transaction"
  | "plugin"
  | "resource-type"
  | "state"
  | "lockfile"
  | "internal";

export type Retryability = "retryable" | "non-retryable" | "retry-after-delay";

/**
 * Deterministic classification for every error code:
 * subsystem category, retryability, and whether the user can act on it.
 */
export const ERROR_CLASSIFICATION: Readonly<
  Record<ErrorCode, { category: ErrorCategory; retryable: Retryability }>
> = {
  NETWORK_ERROR: { category: "network", retryable: "retryable" },
  GITHUB_API_ERROR: { category: "network", retryable: "retryable" },
  REGISTRY_NOT_FOUND: { category: "registry", retryable: "non-retryable" },
  REGISTRY_INVALID: { category: "registry", retryable: "non-retryable" },
  REGISTRY_LOAD_FAILED: { category: "registry", retryable: "retryable" },
  RESOURCE_NOT_FOUND: { category: "registry", retryable: "non-retryable" },
  RESOURCE_INVALID: { category: "manifest", retryable: "non-retryable" },
  RESOURCE_INCOMPATIBLE: { category: "manifest", retryable: "non-retryable" },
  MANIFEST_NOT_FOUND: { category: "manifest", retryable: "non-retryable" },
  MANIFEST_INVALID: { category: "manifest", retryable: "non-retryable" },
  MANIFEST_PARSE_ERROR: { category: "manifest", retryable: "non-retryable" },
  INSTALL_FAILED: { category: "installation", retryable: "retryable" },
  INSTALL_ABORTED: { category: "installation", retryable: "non-retryable" },
  INSTALL_TIMEOUT: { category: "installation", retryable: "retryable" },
  DOWNLOAD_FAILED: { category: "download", retryable: "retryable" },
  DOWNLOAD_TIMEOUT: { category: "download", retryable: "retryable" },
  DOWNLOAD_CANCELLED: { category: "download", retryable: "non-retryable" },
  DEPENDENCY_CONFLICT: { category: "dependency", retryable: "non-retryable" },
  DEPENDENCY_CIRCULAR: { category: "dependency", retryable: "non-retryable" },
  DEPENDENCY_NOT_FOUND: { category: "dependency", retryable: "non-retryable" },
  VERSION_NOT_FOUND: { category: "dependency", retryable: "non-retryable" },
  VERSION_INCOMPATIBLE: { category: "dependency", retryable: "non-retryable" },
  CACHE_READ_ERROR: { category: "cache", retryable: "retryable" },
  CACHE_WRITE_ERROR: { category: "cache", retryable: "retryable" },
  CACHE_CORRUPTED: { category: "cache", retryable: "non-retryable" },
  CACHE_OVERFLOW: { category: "cache", retryable: "non-retryable" },
  CONFIG_INVALID: { category: "configuration", retryable: "non-retryable" },
  CONFIG_NOT_FOUND: { category: "configuration", retryable: "non-retryable" },
  CONFIG_PARSE_ERROR: { category: "configuration", retryable: "non-retryable" },
  PLUGIN_LOAD_FAILED: { category: "plugin", retryable: "non-retryable" },
  PLUGIN_HOOK_ERROR: { category: "plugin", retryable: "non-retryable" },
  PLUGIN_INCOMPATIBLE: { category: "plugin", retryable: "non-retryable" },
  PLUGIN_DUPLICATE: { category: "plugin", retryable: "non-retryable" },
  PLUGIN_INIT_FAILED: { category: "plugin", retryable: "non-retryable" },
  PLUGIN_DISCOVERY_FAILED: { category: "plugin", retryable: "non-retryable" },
  RESOURCE_TYPE_DUPLICATE: {
    category: "resource-type",
    retryable: "non-retryable",
  },
  RESOURCE_TYPE_NOT_FOUND: {
    category: "resource-type",
    retryable: "non-retryable",
  },
  INSTALLER_NOT_FOUND: {
    category: "resource-type",
    retryable: "non-retryable",
  },
  INSTALLER_DUPLICATE: {
    category: "resource-type",
    retryable: "non-retryable",
  },
  UNSUPPORTED_RESOURCE_TYPE: {
    category: "resource-type",
    retryable: "non-retryable",
  },
  UNSUPPORTED_LIFECYCLE_OPERATION: {
    category: "resource-type",
    retryable: "non-retryable",
  },
  EXTENSION_CONFLICT: { category: "resource-type", retryable: "non-retryable" },
  EXTENSION_VALIDATION_FAILED: {
    category: "plugin",
    retryable: "non-retryable",
  },
  EXTENSION_DEPENDENCY_CONFLICT: {
    category: "plugin",
    retryable: "non-retryable",
  },
  PERMISSION_DENIED: { category: "filesystem", retryable: "non-retryable" },
  DISK_FULL: { category: "filesystem", retryable: "non-retryable" },
  INTEGRITY_CHECK_FAILED: { category: "integrity", retryable: "non-retryable" },
  DESTINATION_INVALID: { category: "filesystem", retryable: "non-retryable" },
  DESTINATION_EXISTS: { category: "filesystem", retryable: "non-retryable" },
  DESTINATION_NOT_WRITABLE: {
    category: "filesystem",
    retryable: "non-retryable",
  },
  GITHUB_RATE_LIMIT: {
    category: "authorization",
    retryable: "retry-after-delay",
  },
  INTERNET_UNAVAILABLE: { category: "network", retryable: "retry-after-delay" },
  NODE_VERSION_INCOMPATIBLE: {
    category: "internal",
    retryable: "non-retryable",
  },
  UNKNOWN_ERROR: { category: "internal", retryable: "non-retryable" },
};

interface MarketplaceError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly reason: string;
  readonly suggestion: string;
  readonly recovery: string;
  readonly documentation: string;
  readonly severity: ErrorSeverity;
  readonly cause?: Error;
  readonly context?: Readonly<Record<string, unknown>>;
}
