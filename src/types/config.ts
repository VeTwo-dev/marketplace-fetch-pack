/** Deterministic network behavior (Phase 20 Step 46). */
export type NetworkMode = "online" | "offline" | "prefer-offline";

export interface MarketplaceConfig {
  /** Overrides `offline` when present: prefer-offline serves cache first */
  readonly networkMode?: NetworkMode;
  readonly repository?: string;
  readonly branch?: string;
  readonly cache?: Partial<CacheConfigInput>;
  readonly destination?: string;
  readonly logger?: LoggerConfigInput;
  readonly plugins?: ReadonlyArray<PluginConfigInput>;
  readonly hooks?: HooksConfig;
  readonly autoDetect?: boolean;
  readonly concurrency?: number;
  readonly timeout?: number;
  readonly token?: string;
  readonly offline?: boolean;
}

export interface CacheConfigInput {
  readonly enabled?: boolean;
  readonly directory?: string;
  readonly maxSize?: number;
  readonly ttl?: number;
  readonly autoClean?: boolean;
}

export interface LoggerConfigInput {
  readonly level?: LogLevel;
  readonly prefix?: string;
  readonly color?: boolean;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface PluginConfigInput {
  readonly name: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface HooksConfig {
  readonly beforeInstall?: ReadonlyArray<string>;
  readonly afterInstall?: ReadonlyArray<string>;
}

export type ConfigSource = "file" | "programmatic" | "environment" | "default";

export interface ResolvedConfig {
  readonly repository: string;
  readonly branch: string;
  readonly cache: ResolvedCacheConfig;
  readonly destination: string;
  readonly logger: ResolvedLoggerConfig;
  readonly plugins: ReadonlyArray<PluginConfigInput>;
  readonly hooks: HooksConfig;
  readonly autoDetect: boolean;
  readonly concurrency: number;
  readonly timeout: number;
  readonly source: ConfigSource;
  readonly token?: string;
  readonly offline: boolean;
  readonly networkMode: NetworkMode;
}

export interface ResolvedCacheConfig {
  readonly enabled: boolean;
  readonly directory: string;
  readonly maxSize: number;
  readonly ttl: number;
  readonly autoClean: boolean;
}

export interface ResolvedLoggerConfig {
  readonly level: LogLevel;
  readonly prefix: string;
  readonly color: boolean;
}
