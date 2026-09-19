/**
 * Shared constants used across both core library and CLI layers.
 * Keep CLI_NAME here so that core modules (errors, etc.) can reference
 * the command name without depending on the CLI layer.
 */
export const CLI_NAME = "vetwo-market";

/**
 * Marketplace core version used for plugin compatibility validation.
 */
export const MARKETPLACE_VERSION = "1.0.0";

/**
 * Legacy CLI command names that still work with a deprecation warning.
 */
export const LEGACY_CLI_NAMES: ReadonlyArray<string> = ["marketplace"];

/**
 * Canonical default marketplace repository (Step 40).
 * The ONLY place this URL may appear as a default.
 */
export const OFFICIAL_MARKETPLACE_REPOSITORY =
  "https://github.com/VeTwo-dev/VeTwo-Market-Place";
