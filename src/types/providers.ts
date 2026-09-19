export type ProviderType = "github" | "http" | "local";

export interface RegistryProvider {
  readonly type: ProviderType;
  readonly name: string;
  connect(config: ProviderConfig): Promise<void>;
  readFile(path: string): Promise<string>;
  readJson<T = unknown>(path: string): Promise<T>;
  getTree(): Promise<ReadonlyArray<TreeEntry>>;
  getRawUrl(path: string): Promise<string>;
  invalidate(): void;
}

export interface ProviderConfig {
  readonly repository: string;
  readonly branch: string;
  readonly timeout: number;
  readonly token?: string;
  readonly basePath?: string;
}

export interface TreeEntry {
  readonly path: string;
  readonly type: "blob" | "tree";
  readonly sha: string;
  readonly size?: number;
  readonly url?: string;
}

export interface ProviderCapabilities {
  readonly supportsTree: boolean;
  readonly supportsRawUrl: boolean;
  readonly supportsSearch: boolean;
  readonly maxPageSize: number;
  readonly rateLimitAware: boolean;
}
