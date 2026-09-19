import type { MarketplaceConfig, ResolvedConfig } from "../types/config.js";
import { MarketplaceClientError } from "../errors/index.js";

const VALID_LOG_LEVELS: ReadonlyArray<string> = [
  "debug",
  "info",
  "warn",
  "error",
  "silent",
];

const SENSITIVE_KEYS: ReadonlyArray<string> = [
  "token",
  "githubToken",
  "secret",
  "password",
  "apiKey",
];

export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<ConfigValidationError>;
}

export interface ConfigValidationError {
  readonly path: string;
  readonly message: string;
  readonly value: unknown;
}

export function validateMarketplaceConfig(
  config: MarketplaceConfig,
): ConfigValidationResult {
  const errors: Array<ConfigValidationError> = [];

  if (config.repository !== undefined) {
    const err = validateUrl(config.repository, "repository");
    if (err !== null) errors.push(err);
  }

  if (config.branch !== undefined) {
    if (typeof config.branch !== "string" || config.branch.trim() === "") {
      errors.push({
        path: "branch",
        message: "Branch must be a non-empty string",
        value: config.branch,
      });
    }
  }

  if (config.concurrency !== undefined) {
    const err = validatePositiveInt(config.concurrency, "concurrency");
    if (err !== null) errors.push(err);
  }

  if (config.timeout !== undefined) {
    const err = validatePositiveInt(config.timeout, "timeout");
    if (err !== null) errors.push(err);
  }

  if (config.logger !== undefined) {
    if (config.logger.level !== undefined) {
      const err = validateLogLevel(config.logger.level);
      if (err !== null) errors.push(err);
    }
  }

  if (config.cache !== undefined) {
    if (config.cache.maxSize !== undefined) {
      const err = validatePositiveInt(config.cache.maxSize, "cache.maxSize");
      if (err !== null) errors.push(err);
    }
    if (config.cache.ttl !== undefined) {
      const err = validatePositiveInt(config.cache.ttl, "cache.ttl");
      if (err !== null) errors.push(err);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateResolvedConfig(
  config: ResolvedConfig,
): ConfigValidationResult {
  const errors: Array<ConfigValidationError> = [];

  const repoErr = validateUrl(config.repository, "repository");
  if (repoErr !== null) errors.push(repoErr);

  const concurrencyErr = validatePositiveInt(config.concurrency, "concurrency");
  if (concurrencyErr !== null) errors.push(concurrencyErr);

  const timeoutErr = validatePositiveInt(config.timeout, "timeout");
  if (timeoutErr !== null) errors.push(timeoutErr);

  const logErr = validateLogLevel(config.logger.level);
  if (logErr !== null) errors.push(logErr);

  const cacheMaxErr = validatePositiveInt(
    config.cache.maxSize,
    "cache.maxSize",
  );
  if (cacheMaxErr !== null) errors.push(cacheMaxErr);

  const cacheTtlErr = validatePositiveInt(config.cache.ttl, "cache.ttl");
  if (cacheTtlErr !== null) errors.push(cacheTtlErr);

  if (typeof config.offline !== "boolean") {
    errors.push({
      path: "offline",
      message: "Offline must be a boolean",
      value: config.offline,
    });
  }

  return { valid: errors.length === 0, errors };
}

export function ensureValidConfig(config: ResolvedConfig): void {
  const result = validateResolvedConfig(config);
  if (!result.valid) {
    const details = result.errors
      .map((e) => `${e.path}: ${e.message}`)
      .join("; ");
    throw new MarketplaceClientError("CONFIG_INVALID", {
      message: `Configuration validation failed: ${details}`,
      context: {
        errors: result.errors.map((e) => ({
          path: e.path,
          message: e.message,
        })),
      },
    });
  }
}

function validateUrl(
  value: string,
  field: string,
): ConfigValidationError | null {
  if (typeof value !== "string" || value.trim() === "") {
    return { path: field, message: "Must be a non-empty string", value };
  }
  try {
    new URL(value);
    return null;
  } catch {
    return {
      path: field,
      message: `Invalid URL: ${value}`,
      value,
    };
  }
}

function validatePositiveInt(
  value: unknown,
  field: string,
): ConfigValidationError | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return {
      path: field,
      message: `Must be a positive number, got: ${String(value)}`,
      value,
    };
  }
  return null;
}

function validateLogLevel(value: string): ConfigValidationError | null {
  if (!VALID_LOG_LEVELS.includes(value)) {
    return {
      path: "logger.level",
      message: `Invalid log level: ${value}. Must be one of: ${VALID_LOG_LEVELS.join(", ")}`,
      value,
    };
  }
  return null;
}

export function redactSecrets(
  obj: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(key) && typeof value === "string") {
      result[key] = redactString(value);
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = redactSecrets(value as Readonly<Record<string, unknown>>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function redactString(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function freezeConfig(config: ResolvedConfig): ResolvedConfig {
  const frozen = Object.freeze(config);
  Object.freeze(frozen.cache);
  Object.freeze(frozen.logger);
  Object.freeze(frozen.hooks);
  Object.freeze(frozen.plugins);
  return frozen;
}
