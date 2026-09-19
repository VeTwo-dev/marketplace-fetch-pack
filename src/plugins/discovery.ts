import { isAbsolute, resolve } from "node:path";
import type { Plugin } from "../types/plugin.js";
import type { PluginConfigInput } from "../types/config.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";

export interface DiscoveredPlugin {
  readonly source: string;
  readonly plugin: Plugin;
}

/**
 * Explicit, deterministic plugin discovery.
 *
 * Supported sources:
 * - npm package names (e.g. "@vetwo/marketplace-plugin-example")
 * - relative/absolute file paths (e.g. "./local-plugin")
 *
 * Discovery NEVER scans node_modules or the filesystem recursively.
 * Each entry must be explicitly listed in configuration.
 * The module's default export (or the module itself) must be a valid
 * Plugin shape — validated before registration.
 */
export class PluginDiscovery {
  private readonly _logger: Logger;
  private readonly _projectRoot: string;

  constructor(projectRoot: string, logger?: Logger) {
    this._projectRoot = projectRoot;
    this._logger = logger ?? createLogger({ prefix: "plugin-discovery" });
  }

  async discoverOne(
    config: PluginConfigInput | string,
  ): Promise<DiscoveredPlugin> {
    const name = typeof config === "string" ? config : config.name;
    const specifier = this._resolveSpecifier(name);

    let mod: unknown;
    try {
      mod = await import(/* @vite-ignore */ specifier);
    } catch (error) {
      throw new MarketplaceClientError("PLUGIN_DISCOVERY_FAILED", {
        message: `Failed to load plugin "${name}": ${error instanceof Error ? error.message : String(error)}`,
        context: { plugin: name, specifier },
        cause: error instanceof Error ? error : undefined,
      });
    }

    const candidate =
      (mod as { default?: unknown } | null)?.default !== null &&
      (mod as { default?: unknown } | null)?.default !== undefined
        ? (mod as { default: unknown }).default
        : mod;

    if (!isPluginShape(candidate)) {
      throw new MarketplaceClientError("PLUGIN_LOAD_FAILED", {
        message: `Module "${name}" does not export a valid MarketplacePlugin`,
        context: { plugin: name, specifier },
      });
    }

    return { source: name, plugin: candidate };
  }

  async discoverAll(
    configs: ReadonlyArray<PluginConfigInput>,
  ): Promise<DiscoveredPlugin[]> {
    const found: DiscoveredPlugin[] = [];
    for (const config of configs) {
      try {
        found.push(await this.discoverOne(config));
      } catch (error) {
        this._logger.error(
          `Plugin discovery failed for "${typeof config === "string" ? config : config.name}"`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    return found;
  }

  private _resolveSpecifier(name: string): string {
    const looksLikePath = name.startsWith("./") || name.startsWith("../");
    if (looksLikePath && !isAbsolute(name)) {
      return resolve(this._projectRoot, name);
    }
    return name;
  }
}

/**
 * Structural validation of an unknown value against the Plugin contract.
 * Prevents executing or registering arbitrary exports.
 */
export function isPluginShape(value: unknown): value is Plugin {
  if (value === null || typeof value !== "object") return false;

  const candidate = value as Partial<Plugin>;
  if (candidate.manifest === null || typeof candidate.manifest !== "object") {
    return false;
  }
  if (candidate.hooks === null || typeof candidate.hooks !== "object") {
    return false;
  }

  const manifest = candidate.manifest as unknown as Record<string, unknown>;
  if (typeof manifest.id !== "string" || manifest.id.length === 0) return false;
  if (typeof manifest.name !== "string" || manifest.name.length === 0)
    return false;
  if (typeof manifest.version !== "string" || manifest.version.length === 0)
    return false;
  if (!Array.isArray(manifest.capabilities)) return false;

  return true;
}

export function createPluginDiscovery(
  projectRoot: string,
  logger?: Logger,
): PluginDiscovery {
  return new PluginDiscovery(projectRoot, logger);
}
