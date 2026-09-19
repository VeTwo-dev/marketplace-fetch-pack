import type {
  ErrorCode,
  ErrorSeverity,
  ErrorCategory,
  Retryability,
} from "../types/errors.js";
import { ERROR_CLASSIFICATION } from "../types/errors.js";
import { CLI_NAME, OFFICIAL_MARKETPLACE_REPOSITORY } from "../constants.js";

const DOC_BASE = `${OFFICIAL_MARKETPLACE_REPOSITORY}/blob/main/docs/errors`;

interface ErrorDefinition {
  readonly message: string;
  readonly reason: string;
  readonly suggestion: string;
  readonly recovery: string;
  readonly severity: ErrorSeverity;
}

const ERROR_DEFINITIONS: Readonly<Record<ErrorCode, ErrorDefinition>> = {
  NETWORK_ERROR: {
    message: "Network request failed",
    reason: "Unable to connect to the remote server.",
    suggestion: "Check your internet connection and try again.",
    recovery: `Run \`${CLI_NAME} doctor\` to diagnose network issues.`,
    severity: "error",
  },
  GITHUB_API_ERROR: {
    message: "GitHub API request failed",
    reason: "The GitHub API returned an error or was unreachable.",
    suggestion:
      "You may have hit a rate limit or the repository may be private.",
    recovery:
      "Set a GITHUB_TOKEN environment variable to increase rate limits.",
    severity: "error",
  },
  GITHUB_RATE_LIMIT: {
    message: "GitHub API rate limit exceeded",
    reason:
      "Too many requests were made to the GitHub API without authentication.",
    suggestion:
      "Set a GITHUB_TOKEN environment variable for higher rate limits.",
    recovery: "Wait for the rate limit to reset or authenticate with a token.",
    severity: "warning",
  },
  REGISTRY_NOT_FOUND: {
    message: "Registry not found",
    reason: "The marketplace registry could not be located in the repository.",
    suggestion: "The repository may not contain a valid marketplace registry.",
    recovery:
      "Ensure the repository contains a registry.json or valid manifests.",
    severity: "error",
  },
  REGISTRY_INVALID: {
    message: "Registry data is invalid",
    reason: "The registry file exists but contains invalid or corrupted data.",
    suggestion: "The registry may have been corrupted or modified incorrectly.",
    recovery: `Clear the cache with \`${CLI_NAME} cache clear\` and try again.`,
    severity: "error",
  },
  REGISTRY_LOAD_FAILED: {
    message: "Failed to load registry",
    reason: "An error occurred while loading the marketplace registry.",
    suggestion: "This may be due to network issues or repository changes.",
    recovery: `Try again later or run \`${CLI_NAME} doctor\` to diagnose the issue.`,
    severity: "error",
  },
  RESOURCE_NOT_FOUND: {
    message: "Resource not found",
    reason: "The requested resource does not exist in the marketplace.",
    suggestion: `Check the resource ID for typos or use \`${CLI_NAME} search\` to find available resources.`,
    recovery: `Run \`${CLI_NAME} categories\` or \`${CLI_NAME} search\` to discover available resources.`,
    severity: "error",
  },
  RESOURCE_INVALID: {
    message: "Resource data is invalid",
    reason:
      "The resource manifest contains invalid or missing required fields.",
    suggestion: "The resource may have been corrupted or improperly published.",
    recovery:
      "Report this issue to the resource author or marketplace maintainers.",
    severity: "error",
  },
  RESOURCE_INCOMPATIBLE: {
    message: "Resource is incompatible",
    reason: "The resource is not compatible with your current environment.",
    suggestion:
      "Check the resource's compatibility requirements in its manifest.",
    recovery:
      "Update your environment or choose a compatible version of the resource.",
    severity: "warning",
  },
  MANIFEST_NOT_FOUND: {
    message: "Manifest not found",
    reason: "No valid manifest file was found for the resource.",
    suggestion: "The resource directory may be missing its manifest file.",
    recovery:
      "Ensure the resource contains resource.json, manifest.json, vetwo.json, or a package.json with vetwo.resource.",
    severity: "error",
  },
  MANIFEST_INVALID: {
    message: "Manifest is invalid",
    reason: "The manifest file exists but failed validation.",
    suggestion:
      "The manifest may be missing required fields or have invalid values.",
    recovery:
      "Check the manifest format against the VeTwo resource specification.",
    severity: "error",
  },
  MANIFEST_PARSE_ERROR: {
    message: "Failed to parse manifest",
    reason: "The manifest file could not be parsed as valid JSON.",
    suggestion:
      "The file may contain syntax errors or be in an unsupported format.",
    recovery: "Validate the JSON syntax of the manifest file.",
    severity: "error",
  },
  INSTALL_FAILED: {
    message: "Installation failed",
    reason: "An error occurred during the installation process.",
    suggestion:
      "Check the error details for more information about what went wrong.",
    recovery:
      "Try running the installation again or use `--force` to overwrite existing files.",
    severity: "error",
  },
  INSTALL_ABORTED: {
    message: "Installation was aborted",
    reason: "The installation was cancelled by the user or a hook.",
    suggestion: "This is expected if you cancelled the operation.",
    recovery: "No action needed. Re-run the install command to try again.",
    severity: "info",
  },
  INSTALL_TIMEOUT: {
    message: "Installation timed out",
    reason: "The installation process exceeded the maximum allowed time.",
    suggestion:
      "The operation may be stuck due to a slow network or large download.",
    recovery:
      "Increase the timeout in your configuration or try again with a better connection.",
    severity: "error",
  },
  DOWNLOAD_FAILED: {
    message: "Download failed",
    reason: "A file could not be downloaded from the repository.",
    suggestion: "Check your network connection and the file URL.",
    recovery: "Try again later or check if the file exists in the repository.",
    severity: "error",
  },
  DOWNLOAD_TIMEOUT: {
    message: "Download timed out",
    reason: "The download exceeded the maximum allowed time.",
    suggestion: "The file may be very large or the connection may be slow.",
    recovery: "Increase the timeout or try with a faster connection.",
    severity: "error",
  },
  DOWNLOAD_CANCELLED: {
    message: "Download was cancelled",
    reason: "The download was cancelled by the user or a hook.",
    suggestion: "This is expected if you cancelled the operation.",
    recovery: "No action needed. Re-run the download to try again.",
    severity: "info",
  },
  DEPENDENCY_CONFLICT: {
    message: "Dependency conflict detected",
    reason:
      "Two or more resources require conflicting versions of a dependency.",
    suggestion: "Check the dependency requirements of each resource.",
    recovery: "Choose compatible versions or resolve the conflict manually.",
    severity: "error",
  },
  DEPENDENCY_CIRCULAR: {
    message: "Circular dependency detected",
    reason: "A circular dependency chain was found between resources.",
    suggestion: "This indicates a design issue in the resource dependencies.",
    recovery: "Report this issue to the affected resource authors.",
    severity: "error",
  },
  DEPENDENCY_NOT_FOUND: {
    message: "Dependency not found",
    reason: "A required dependency could not be found in the marketplace.",
    suggestion: "The dependency may have been removed or renamed.",
    recovery:
      "Check the dependency name and ensure it exists in the marketplace.",
    severity: "error",
  },
  VERSION_NOT_FOUND: {
    message: "Version not found",
    reason: "The requested version of the resource does not exist.",
    suggestion: `Check the available versions using \`${CLI_NAME} info\`.`,
    recovery:
      "Use a version that exists or omit the version to get the latest.",
    severity: "error",
  },
  VERSION_INCOMPATIBLE: {
    message: "Version incompatible",
    reason:
      "The requested version is not compatible with the current environment.",
    suggestion: "Check the version requirements and compatibility matrix.",
    recovery: "Choose a compatible version or update your environment.",
    severity: "warning",
  },
  CACHE_READ_ERROR: {
    message: "Cache read error",
    reason: "Failed to read from the cache.",
    suggestion: "The cache may be corrupted.",
    recovery: `Clear the cache with \`${CLI_NAME} cache clear\`.`,
    severity: "warning",
  },
  CACHE_WRITE_ERROR: {
    message: "Cache write error",
    reason: "Failed to write to the cache.",
    suggestion: "Check disk space and permissions.",
    recovery:
      "Ensure the cache directory is writable and has sufficient space.",
    severity: "warning",
  },
  CACHE_CORRUPTED: {
    message: "Cache is corrupted",
    reason: "A cache entry contains invalid or corrupted data.",
    suggestion: "The cache may have been modified externally.",
    recovery: `Clear the cache with \`${CLI_NAME} cache clear\`.`,
    severity: "warning",
  },
  CACHE_OVERFLOW: {
    message: "Cache size limit exceeded",
    reason: "The cache has exceeded its maximum allowed size.",
    suggestion: "Old cache entries will be cleaned up automatically.",
    recovery: `Run \`${CLI_NAME} cache clear\` to free space or increase the cache size limit.`,
    severity: "warning",
  },
  CONFIG_INVALID: {
    message: "Configuration is invalid",
    reason: "The configuration file contains invalid values.",
    suggestion: "Check the configuration file for syntax or value errors.",
    recovery: "Fix the configuration file or remove it to use defaults.",
    severity: "error",
  },
  CONFIG_NOT_FOUND: {
    message: "Configuration not found",
    reason: "The specified configuration file does not exist.",
    suggestion:
      "This is normal if you haven't created a configuration file yet.",
    recovery:
      "Create a marketplace.config.ts in your project root or use programmatic configuration.",
    severity: "info",
  },
  CONFIG_PARSE_ERROR: {
    message: "Failed to parse configuration",
    reason: "The configuration file could not be parsed.",
    suggestion: "The file may contain syntax errors.",
    recovery: "Validate the configuration file syntax.",
    severity: "error",
  },
  PLUGIN_LOAD_FAILED: {
    message: "Plugin failed to load",
    reason: "A marketplace plugin could not be loaded.",
    suggestion:
      "The plugin may not be installed or may have compatibility issues.",
    recovery: "Check the plugin installation and version compatibility.",
    severity: "error",
  },
  PLUGIN_HOOK_ERROR: {
    message: "Plugin hook error",
    reason: "A plugin hook threw an error during execution.",
    suggestion:
      "The plugin may have a bug or be incompatible with the current version.",
    recovery:
      "Disable the problematic plugin or update it to a compatible version.",
    severity: "error",
  },
  PLUGIN_INCOMPATIBLE: {
    message: "Plugin incompatible",
    reason:
      "The plugin is not compatible with the current Marketplace version.",
    suggestion: "Check the plugin's marketplaceVersion compatibility.",
    recovery: "Update the plugin or Marketplace to a compatible version.",
    severity: "error",
  },
  PLUGIN_DUPLICATE: {
    message: "Duplicate plugin",
    reason: "A plugin with the same ID is already registered.",
    suggestion: "Only one instance of each plugin can be loaded.",
    recovery: "Remove the duplicate plugin registration.",
    severity: "error",
  },
  PLUGIN_INIT_FAILED: {
    message: "Plugin initialization failed",
    reason: "A plugin failed during the initialization phase.",
    suggestion:
      "The plugin may have unmet dependencies or configuration issues.",
    recovery: "Check the plugin's configuration and dependencies.",
    severity: "error",
  },
  PLUGIN_DISCOVERY_FAILED: {
    message: "Plugin discovery failed",
    reason: "An error occurred while discovering or loading a plugin.",
    suggestion: "The plugin may not be installed or accessible.",
    recovery: "Verify the plugin path or package name is correct.",
    severity: "error",
  },
  RESOURCE_TYPE_DUPLICATE: {
    message: "Duplicate resource type",
    reason: "A resource type with the same ID is already registered.",
    suggestion: "Each resource type ID must be unique.",
    recovery: "Unregister the existing type first or use a different ID.",
    severity: "error",
  },
  RESOURCE_TYPE_NOT_FOUND: {
    message: "Resource type not found",
    reason: "No resource type is registered with the given ID.",
    suggestion: "The resource type may not be registered yet.",
    recovery: "Register the resource type before using it.",
    severity: "error",
  },
  INSTALLER_NOT_FOUND: {
    message: "Installer not found",
    reason: "No installer is registered for the given resource type.",
    suggestion: "Install an installer that supports this resource type.",
    recovery: "Register an installer for this resource type.",
    severity: "error",
  },
  INSTALLER_DUPLICATE: {
    message: "Duplicate installer",
    reason: "An installer with the same ID is already registered.",
    suggestion: "Each installer ID must be unique.",
    recovery: "Unregister the existing installer first or use a different ID.",
    severity: "error",
  },
  UNSUPPORTED_RESOURCE_TYPE: {
    message: "Unsupported resource type",
    reason: "The operation is not supported for this resource type.",
    suggestion: "Check if the resource type supports this operation.",
    recovery:
      "Use a supported resource type or install the required extension.",
    severity: "error",
  },
  UNSUPPORTED_LIFECYCLE_OPERATION: {
    message: "Unsupported lifecycle operation",
    reason: "The requested lifecycle operation is not supported.",
    suggestion: "The resource type does not implement this operation.",
    recovery: "Use a resource type that supports this operation.",
    severity: "error",
  },
  EXTENSION_CONFLICT: {
    message: "Extension conflict",
    reason: "Two or more extensions provide the same capability.",
    suggestion: "Only one extension can provide each capability at a time.",
    recovery: "Disable the conflicting extension.",
    severity: "error",
  },
  EXTENSION_VALIDATION_FAILED: {
    message: "Extension validation failed",
    reason: "An extension failed validation before registration.",
    suggestion: "The extension may have invalid configuration or metadata.",
    recovery: "Fix the extension's configuration and try again.",
    severity: "error",
  },
  EXTENSION_DEPENDENCY_CONFLICT: {
    message: "Extension dependency conflict",
    reason: "An extension has conflicting dependencies.",
    suggestion: "The required dependency version is not available.",
    recovery: "Update the extension or its dependencies.",
    severity: "error",
  },
  PERMISSION_DENIED: {
    message: "Permission denied",
    reason: "The operation requires permissions that are not available.",
    suggestion: "Check file system permissions for the target directory.",
    recovery:
      "Run with appropriate permissions or change the destination directory.",
    severity: "error",
  },
  DISK_FULL: {
    message: "Disk full",
    reason: "There is not enough disk space to complete the operation.",
    suggestion: "Free up disk space and try again.",
    recovery: "Remove unnecessary files or choose a different destination.",
    severity: "error",
  },
  INTEGRITY_CHECK_FAILED: {
    message: "Integrity check failed",
    reason: "A downloaded file does not match its expected checksum.",
    suggestion:
      "The file may have been corrupted during download or tampered with.",
    recovery:
      "Clear the cache and retry the download. If it persists, report the issue.",
    severity: "error",
  },
  DESTINATION_INVALID: {
    message: "Invalid destination",
    reason: "The specified installation destination is not valid.",
    suggestion: "Check the path for correctness.",
    recovery: "Specify a valid directory path as the destination.",
    severity: "error",
  },
  DESTINATION_EXISTS: {
    message: "Destination already exists",
    reason: "A file or directory already exists at the destination path.",
    suggestion: "Use `--force` to overwrite or choose a different destination.",
    recovery: "Remove the existing files or use the force flag.",
    severity: "warning",
  },
  DESTINATION_NOT_WRITABLE: {
    message: "Destination not writable",
    reason: "The destination directory is not writable.",
    suggestion: "Check file system permissions for the target directory.",
    recovery: "Change permissions or choose a different destination.",
    severity: "error",
  },
  INTERNET_UNAVAILABLE: {
    message: "Internet unavailable",
    reason: "No internet connection was detected.",
    suggestion: "Check your network connection.",
    recovery:
      "Ensure you have an active internet connection to access the marketplace.",
    severity: "error",
  },
  NODE_VERSION_INCOMPATIBLE: {
    message: "Node.js version incompatible",
    reason: "Your Node.js version does not meet the requirements.",
    suggestion: "Update Node.js to the required version.",
    recovery: "Install a compatible version of Node.js (>=20).",
    severity: "error",
  },
  UNKNOWN_ERROR: {
    message: "Unknown error",
    reason: "An unexpected error occurred.",
    suggestion: "This may be a bug in the marketplace client.",
    recovery: `Report this issue at ${OFFICIAL_MARKETPLACE_REPOSITORY}/issues`,
    severity: "error",
  },
};

export class MarketplaceClientError extends Error {
  readonly code: ErrorCode;
  readonly reason: string;
  readonly suggestion: string;
  readonly recovery: string;
  readonly documentation: string;
  readonly severity: ErrorSeverity;
  readonly category: ErrorCategory;
  readonly retryable: Retryability;
  override readonly cause?: Error;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    options: {
      readonly message?: string;
      readonly cause?: Error;
      readonly context?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    const definition = ERROR_DEFINITIONS[code]!;
    const classification = ERROR_CLASSIFICATION[code]!;
    const message = options.message ?? definition.message;
    super(message);
    this.name = "MarketplaceClientError";
    this.code = code;
    this.reason = definition.reason;
    this.suggestion = definition.suggestion;
    this.recovery = definition.recovery;
    this.documentation = `${DOC_BASE}/${code.toLowerCase()}.md`;
    this.severity = definition.severity;
    this.category = classification.category;
    this.retryable = classification.retryable;
    this.cause = options.cause;
    this.context = redactContext(options.context);
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      reason: this.reason,
      suggestion: this.suggestion,
      recovery: this.recovery,
      documentation: this.documentation,
      severity: this.severity,
      context: this.context,
    };
  }

  override toString(): string {
    const parts = [
      `[${this.severity.toUpperCase()}] ${this.code}: ${this.message}`,
      `Reason: ${this.reason}`,
      `Suggestion: ${this.suggestion}`,
      `Recovery: ${this.recovery}`,
    ];
    if (this.context !== undefined) {
      parts.push(`Context: ${JSON.stringify(this.context)}`);
    }
    return parts.join("\n");
  }
}

export function createError(
  code: ErrorCode,
  options?: {
    readonly message?: string;
    readonly cause?: Error;
    readonly context?: Readonly<Record<string, unknown>>;
  },
): MarketplaceClientError {
  return new MarketplaceClientError(code, options);
}

/**
 * Secret redaction for error context and debug output.
 * Removes tokens, authorization values, credentials, and secret-bearing
 * URL query parameters. Never mutates the input.
 */
const SENSITIVE_KEYS =
  /token|secret|password|passwd|authorization|auth|credential|apikey|api_key|api[-_]?key|private[-_]?key|session|cookie/i;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    // Redact URL query params that may carry secrets (e.g. ?token=...)
    return value.replace(
      /([?&](?:token|access_token|key|sig|signature)=)[^&\s]+/gi,
      "$1<redacted>",
    );
  }
  return "<redacted>";
}

export function redactContext(
  context?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  if (context === undefined) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEYS.test(key)) {
      out[key] =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? "<redacted>"
          : null;
      continue;
    }
    if (typeof value === "string") {
      out[key] = redactValue(value);
      continue;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactContext(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}
