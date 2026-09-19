import { createLogger } from "../logger/index.js";

/**
 * Structured deprecation mechanism (Phase 18, Step 42).
 * Each warning fires once per code per process — no spam.
 */

export interface Deprecation {
  readonly code: string;
  readonly message: string;
  readonly replacement?: string;
  readonly introducedIn?: string;
  readonly deprecatedIn?: string;
  readonly removalTarget?: string;
}

const warnedCodes = new Set<string>();

export function resetDeprecationWarnings(): void {
  warnedCodes.clear();
}

export function warnDeprecated(
  deprecation: Deprecation,
  logger = createLogger({ prefix: "deprecations" }),
): void {
  if (warnedCodes.has(deprecation.code)) return;
  warnedCodes.add(deprecation.code);

  const parts = [`[DEPRECATED ${deprecation.code}] ${deprecation.message}`];
  if (deprecation.replacement !== undefined) {
    parts.push(`Use instead: ${deprecation.replacement}`);
  }
  if (deprecation.removalTarget !== undefined) {
    parts.push(`Scheduled removal: ${deprecation.removalTarget}`);
  }
  logger.warn(parts.join(" | "));
}

// ─── Schema version validation (Steps 27–29) ─────────────────────────

/** Currently supported manifest schema versions */
export const SUPPORTED_MANIFEST_VERSIONS = ["1"] as ReadonlyArray<string>;
/** Currently supported registry schema versions */
export const SUPPORTED_REGISTRY_VERSIONS = [
  "1.0.0",
  "1",
] as ReadonlyArray<string>;

export interface SchemaVersionResult {
  readonly supported: boolean;
  readonly version: string | null;
  readonly error?: string;
}

/**
 * Validates a declared schema version against supported versions.
 * Missing versions default to "1" (back-compat with unversioned manifests).
 * Unsupported FUTURE versions must fail clearly — never silently
 * interpreted as the current schema.
 */
export function validateSchemaVersion(
  rawVersion: unknown,
  supportedVersions: ReadonlyArray<string> = SUPPORTED_MANIFEST_VERSIONS,
  kind = "manifest",
): SchemaVersionResult {
  // Absent → treat as legacy v1
  if (rawVersion === undefined || rawVersion === null || rawVersion === "") {
    const legacy = supportedVersions.includes("1")
      ? "1"
      : supportedVersions[0]!;
    return { supported: true, version: legacy };
  }

  if (typeof rawVersion !== "string" && typeof rawVersion !== "number") {
    return {
      supported: false,
      version: null,
      error: `${kind} schemaVersion must be a string or number`,
    };
  }

  const version = String(rawVersion);
  if (supportedVersions.includes(version)) {
    return { supported: true, version };
  }

  return {
    supported: false,
    version,
    error: `Unsupported ${kind} schema version "${version}" (supported: ${supportedVersions.join(", ")})`,
  };
}
