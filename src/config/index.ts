import { OFFICIAL_MARKETPLACE_REPOSITORY } from "../constants.js";
import type {
  MarketplaceConfig,
  ResolvedConfig,
  ConfigSource,
  ResolvedCacheConfig,
  ResolvedLoggerConfig,
  PluginConfigInput,
  HooksConfig,
} from "../types/config.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { deepMerge } from "../utils/index.js";
import { resolveStatePaths } from "../state/index.js";
import {
  validateMarketplaceConfig,
  ensureValidConfig,
  freezeConfig,
} from "./validate.js";
import nodePath from "node:path";

const _defaultStatePaths = resolveStatePaths(
  nodePath.resolve(process.cwd(), ".vetwo", "marketplace"),
);

function _getDefaultConfig(): ResolvedConfig {
  return {
    repository: OFFICIAL_MARKETPLACE_REPOSITORY,
    branch: "main",
    cache: {
      enabled: true,
      directory: _defaultStatePaths.cache,
      maxSize: 100 * 1024 * 1024,
      ttl: 24 * 60 * 60 * 1000,
      autoClean: true,
    },
    destination: _defaultStatePaths.resources,
    logger: {
      level: "info",
      prefix: "marketplace",
      color: true,
    },
    plugins: [],
    hooks: {},
    autoDetect: true,
    concurrency: 5,
    timeout: 30000,
    source: "default",
    offline: false,
    networkMode: "online",
  };
}

const DEFAULT_CONFIG: ResolvedConfig = _getDefaultConfig();

const CONFIG_FILE_NAMES = [
  "marketplace.config.ts",
  "marketplace.config.js",
  "marketplace.config.mjs",
  "marketplace.config.cjs",
  "marketplace.config.json",
] as const;

function resolveCacheConfig(
  input?: Partial<ResolvedCacheConfig>,
): ResolvedCacheConfig {
  return {
    enabled: input?.enabled ?? DEFAULT_CONFIG.cache.enabled,
    directory: input?.directory ?? DEFAULT_CONFIG.cache.directory,
    maxSize: input?.maxSize ?? DEFAULT_CONFIG.cache.maxSize,
    ttl: input?.ttl ?? DEFAULT_CONFIG.cache.ttl,
    autoClean: input?.autoClean ?? DEFAULT_CONFIG.cache.autoClean,
  };
}

function resolveLoggerConfig(
  input?: ResolvedLoggerConfig,
): ResolvedLoggerConfig {
  return {
    level: input?.level ?? DEFAULT_CONFIG.logger.level,
    prefix: input?.prefix ?? DEFAULT_CONFIG.logger.prefix,
    color: input?.color ?? DEFAULT_CONFIG.logger.color,
  };
}

function resolvePlugins(
  input?: ReadonlyArray<PluginConfigInput>,
): ReadonlyArray<PluginConfigInput> {
  if (input === undefined || input.length === 0) return [];
  return input.map((p) => ({ ...p }));
}

function resolveHooks(input?: HooksConfig): HooksConfig {
  return {
    beforeInstall: input?.beforeInstall ?? [],
    afterInstall: input?.afterInstall ?? [],
  };
}

function applyEnvironmentVariables(config: ResolvedConfig): ResolvedConfig {
  const repo = process.env["VETWO_MARKETPLACE_REPOSITORY"];
  const branch = process.env["VETWO_MARKETPLACE_BRANCH"];
  const dest = process.env["VETWO_MARKETPLACE_DESTINATION"];
  const logLevel = process.env["VETWO_MARKETPLACE_LOG_LEVEL"];
  const cacheDir = process.env["VETWO_MARKETPLACE_CACHE_DIR"];
  const cacheEnabled = process.env["VETWO_MARKETPLACE_CACHE_ENABLED"];
  const offline = process.env["VETWO_MARKETPLACE_OFFLINE"];
  const token = process.env["GITHUB_TOKEN"] ?? config.token;

  let logger = config.logger;
  if (logLevel !== undefined && logLevel !== "" && isValidLogLevel(logLevel)) {
    logger = { ...config.logger, level: logLevel };
  }

  let cache = config.cache;
  if (cacheDir !== undefined && cacheDir !== "") {
    cache = { ...cache, directory: cacheDir };
  }
  if (cacheEnabled !== undefined && cacheEnabled !== "") {
    cache = { ...cache, enabled: cacheEnabled === "true" };
  }

  const hasChanges =
    (repo !== undefined && repo !== "") ||
    (branch !== undefined && branch !== "") ||
    (dest !== undefined && dest !== "") ||
    (offline !== undefined && offline !== "") ||
    logger !== config.logger ||
    cache !== config.cache;

  if (!hasChanges && token === config.token) return config;

  return {
    ...config,
    repository: repo !== undefined && repo !== "" ? repo : config.repository,
    branch: branch !== undefined && branch !== "" ? branch : config.branch,
    destination: dest !== undefined && dest !== "" ? dest : config.destination,
    logger,
    cache,
    token,
    offline:
      offline !== undefined && offline !== ""
        ? offline === "true"
        : config.offline,
    networkMode:
      offline !== undefined && offline !== "" && offline === "true"
        ? "offline"
        : config.networkMode,
  };
}

function isValidLogLevel(
  value: string,
): value is "debug" | "info" | "warn" | "error" | "silent" {
  return ["debug", "info", "warn", "error", "silent"].includes(value);
}

function resolveConfigFromInput(
  input: MarketplaceConfig,
  source: ConfigSource,
): ResolvedConfig {
  return {
    repository: input.repository ?? DEFAULT_CONFIG.repository,
    branch: input.branch ?? DEFAULT_CONFIG.branch,
    cache: resolveCacheConfig(input.cache),
    destination: input.destination ?? DEFAULT_CONFIG.destination,
    logger: resolveLoggerConfig(
      input.logger as ResolvedLoggerConfig | undefined,
    ),
    plugins: resolvePlugins(input.plugins),
    hooks: resolveHooks(input.hooks),
    autoDetect: input.autoDetect ?? DEFAULT_CONFIG.autoDetect,
    concurrency: input.concurrency ?? DEFAULT_CONFIG.concurrency,
    timeout: input.timeout ?? DEFAULT_CONFIG.timeout,
    source,
    token: input.token,
    offline: input.offline ?? DEFAULT_CONFIG.offline,
    networkMode:
      input.networkMode ??
      (input.offline === true ? "offline" : DEFAULT_CONFIG.networkMode),
  };
}

export class ConfigManager {
  private _config: ResolvedConfig;
  private readonly _logger: Logger;

  constructor() {
    this._config = DEFAULT_CONFIG;
    this._logger = createLogger({ prefix: "config" });
  }

  get config(): ResolvedConfig {
    return this._config;
  }

  async load(inputConfig?: MarketplaceConfig): Promise<ResolvedConfig> {
    if (inputConfig !== undefined) {
      const validation = validateMarketplaceConfig(inputConfig);
      if (!validation.valid) {
        const details = validation.errors
          .map((e) => `${e.path}: ${e.message}`)
          .join("; ");
        throw new MarketplaceClientError("CONFIG_INVALID", {
          message: `Invalid programmatic config: ${details}`,
          context: {
            errors: validation.errors.map((e) => ({
              path: e.path,
              message: e.message,
            })),
          },
        });
      }
      this._config = resolveConfigFromInput(inputConfig, "programmatic");
      this._logger.debug("Loaded programmatic configuration");
      this._config = freezeConfig(this._config);
      return this._config;
    }

    const envConfig = this._loadFromEnvironment();
    if (envConfig !== null) {
      this._config = envConfig;
      this._logger.debug("Loaded environment configuration");
      this._config = freezeConfig(this._config);
      return this._config;
    }

    const fileConfig = await this._loadFromFile();
    if (fileConfig !== null) {
      this._config = fileConfig;
      this._logger.debug("Loaded file configuration");
      this._config = freezeConfig(this._config);
      return this._config;
    }

    this._config = { ...DEFAULT_CONFIG, source: "default" };
    this._logger.debug("Using default configuration");
    this._config = freezeConfig(this._config);
    return this._config;
  }

  update(input: Partial<MarketplaceConfig>): void {
    const resolved = resolveConfigFromInput(input, this._config.source);
    this._config = deepMerge(
      this._config as unknown as Record<string, unknown>,
      resolved as unknown as Record<string, unknown>,
    ) as unknown as ResolvedConfig;
    ensureValidConfig(this._config);
    this._config = freezeConfig(this._config);
  }

  reset(): void {
    this._config = freezeConfig({ ...DEFAULT_CONFIG, source: "default" });
  }

  private _loadFromEnvironment(): ResolvedConfig | null {
    const hasAny = [
      process.env["VETWO_MARKETPLACE_REPOSITORY"],
      process.env["VETWO_MARKETPLACE_BRANCH"],
      process.env["VETWO_MARKETPLACE_DESTINATION"],
      process.env["VETWO_MARKETPLACE_LOG_LEVEL"],
      process.env["VETWO_MARKETPLACE_CACHE_DIR"],
      process.env["VETWO_MARKETPLACE_CACHE_ENABLED"],
      process.env["VETWO_MARKETPLACE_OFFLINE"],
      process.env["GITHUB_TOKEN"],
    ].some((v) => v !== undefined && v !== "");

    if (!hasAny) return null;
    return applyEnvironmentVariables({
      ...DEFAULT_CONFIG,
      source: "environment",
    });
  }

  private async _loadFromFile(): Promise<ResolvedConfig | null> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = path.resolve(process.cwd(), fileName);
      try {
        await fs.access(filePath);
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = this._parseConfigFile(content, fileName);
        if (parsed !== null) {
          return resolveConfigFromInput(parsed, "file");
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private _parseConfigFile(
    content: string,
    fileName: string,
  ): MarketplaceConfig | null {
    try {
      if (fileName.endsWith(".json")) {
        const parsed: unknown = JSON.parse(content);
        if (this._isMarketplaceConfig(parsed)) {
          return parsed;
        }
        return null;
      }

      if (
        fileName.endsWith(".ts") ||
        fileName.endsWith(".js") ||
        fileName.endsWith(".mjs")
      ) {
        this._logger.warn(
          "TypeScript/JavaScript config files are loaded via import. Use JSON config for static loading.",
        );
        return null;
      }

      return null;
    } catch {
      throw new MarketplaceClientError("CONFIG_PARSE_ERROR", {
        context: { file: fileName },
      });
    }
  }

  private _isMarketplaceConfig(value: unknown): value is MarketplaceConfig {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    const allowedKeys = [
      "repository",
      "branch",
      "cache",
      "destination",
      "logger",
      "plugins",
      "hooks",
      "autoDetect",
      "concurrency",
      "timeout",
      "token",
      "offline",
    ];
    return Object.keys(obj).every((key) => allowedKeys.includes(key));
  }
}
