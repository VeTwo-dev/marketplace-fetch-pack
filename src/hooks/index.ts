import { createLogger, type Logger } from "../logger/index.js";
import { MarketplaceClientError } from "../errors/index.js";

export type HookErrorPolicy = "throw" | "log" | "ignore";

export interface HookEntry {
  readonly pluginId: string;
  readonly hookName: string;
  readonly handler: HookHandler;
  readonly priority: number;
  readonly errorPolicy: HookErrorPolicy;
}

export type HookHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: HookContext,
) => TOutput | Promise<TOutput>;

interface HookContext {
  readonly pluginId: string;
  readonly hookName: string;
  readonly timestamp: string;
}

interface HookExecutionResult<T = unknown> {
  readonly success: boolean;
  readonly result?: T;
  readonly error?: Error;
  readonly pluginId: string;
  readonly hookName: string;
  readonly duration: number;
}

export class HookSystem {
  private readonly _hooks: Map<string, Array<HookEntry>> = new Map();
  private readonly _logger: Logger;

  constructor(logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "hooks" });
  }

  register<TInput = unknown, TOutput = unknown>(
    hookName: string,
    pluginId: string,
    handler: HookHandler<TInput, TOutput>,
    options?: {
      priority?: number;
      errorPolicy?: HookErrorPolicy;
    },
  ): void {
    let entries = this._hooks.get(hookName);
    if (entries === undefined) {
      entries = [];
      this._hooks.set(hookName, entries);
    }

    const entry: HookEntry = {
      pluginId,
      hookName,
      handler: handler as HookHandler,
      priority: options?.priority ?? 0,
      errorPolicy: options?.errorPolicy ?? "throw",
    };

    entries.push(entry);
    entries.sort((a, b) => a.priority - b.priority);

    this._logger.debug(`Registered hook: ${hookName}`, { pluginId });
  }

  unregister(hookName: string, pluginId: string): boolean {
    const entries = this._hooks.get(hookName);
    if (entries === undefined) return false;

    const before = entries.length;
    const filtered = entries.filter((e) => e.pluginId !== pluginId);
    this._hooks.set(hookName, filtered);

    if (filtered.length < before) {
      this._logger.debug(`Unregistered hook: ${hookName}`, { pluginId });
      return true;
    }
    return false;
  }

  unregisterAll(pluginId: string): void {
    for (const [hookName, entries] of this._hooks) {
      const filtered = entries.filter((e) => e.pluginId !== pluginId);
      if (filtered.length < entries.length) {
        this._hooks.set(hookName, filtered);
      }
    }
  }

  has(hookName: string): boolean {
    const entries = this._hooks.get(hookName);
    return entries !== undefined && entries.length > 0;
  }

  getEntries(hookName: string): ReadonlyArray<HookEntry> {
    return this._hooks.get(hookName) ?? [];
  }

  async execute<TInput = unknown, TOutput = unknown>(
    hookName: string,
    input: TInput,
    defaultHandler?: (input: TInput) => TOutput | Promise<TOutput>,
  ): Promise<TOutput> {
    const entries = this._hooks.get(hookName) ?? [];

    if (entries.length === 0 && defaultHandler !== undefined) {
      return defaultHandler(input);
    }

    let current: unknown = input;

    for (const entry of entries) {
      const context: HookContext = {
        pluginId: entry.pluginId,
        hookName,
        timestamp: new Date().toISOString(),
      };

      const startTime = Date.now();
      try {
        current = await entry.handler(current, context);
      } catch (error) {
        const duration = Date.now() - startTime;
        const err = error instanceof Error ? error : new Error(String(error));

        switch (entry.errorPolicy) {
          case "throw":
            throw new MarketplaceClientError("PLUGIN_HOOK_ERROR", {
              cause: err,
              context: {
                plugin: entry.pluginId,
                hook: hookName,
                duration,
              },
            });
          case "log":
            this._logger.error(
              `Hook error (logged): ${hookName} by ${entry.pluginId}`,
              { error: err.message },
            );
            break;
          case "ignore":
            break;
        }
      }
    }

    return current as TOutput;
  }

  getHookNames(): ReadonlyArray<string> {
    return Array.from(this._hooks.keys());
  }

  getPluginHooks(pluginId: string): ReadonlyArray<string> {
    const names: string[] = [];
    for (const [hookName, entries] of this._hooks) {
      if (entries.some((e) => e.pluginId === pluginId)) {
        names.push(hookName);
      }
    }
    return names;
  }
}

export function createHookSystem(logger?: Logger): HookSystem {
  return new HookSystem(logger);
}
