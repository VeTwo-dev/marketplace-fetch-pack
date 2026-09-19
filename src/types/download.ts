export interface DownloadOptions {
  readonly url: string;
  readonly destination: string;
  readonly sha?: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly concurrency?: number;
  readonly overwrite?: boolean;
}

export interface DownloadResult {
  readonly success: boolean;
  readonly files: ReadonlyArray<DownloadedFile>;
  readonly totalSize: number;
  readonly duration: number;
  readonly cached: boolean;
}

export interface DownloadedFile {
  readonly path: string;
  readonly size: number;
  readonly sha: string;
}

export interface DownloadProgress {
  readonly url: string;
  readonly downloaded: number;
  readonly total: number;
  readonly percentage: number;
}
