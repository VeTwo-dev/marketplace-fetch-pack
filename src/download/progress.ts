import type { EventBus } from "../events/index.js";

export type DownloadProgressEvent =
  | "downloadStarted"
  | "downloadProgress"
  | "downloadCompleted"
  | "downloadFailed"
  | "downloadRetry"
  | "downloadCancelled";

export interface DownloadProgressData {
  readonly url: string;
  readonly resourceId?: string;
  readonly downloaded: number;
  readonly total: number | null;
  readonly percentage: number | null;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly durationMs?: number;
  readonly error?: string;
}

export class DownloadProgressEmitter {
  private readonly _events: EventBus;
  private readonly _active = new Map<string, DownloadProgressData>();

  constructor(events: EventBus) {
    this._events = events;
  }

  async started(url: string, resourceId?: string): Promise<void> {
    const data: DownloadProgressData = {
      url,
      resourceId,
      downloaded: 0,
      total: null,
      percentage: null,
      attempt: 1,
      maxAttempts: 1,
    };
    this._active.set(url, data);
    await this._events.emit("beforeDownload", {
      url,
      options: { url, destination: "" },
    });
  }

  async progress(
    url: string,
    downloaded: number,
    total: number | null,
  ): Promise<void> {
    const existing = this._active.get(url);
    const data: DownloadProgressData = {
      url,
      resourceId: existing?.resourceId,
      downloaded,
      total,
      percentage:
        total !== null && total > 0
          ? Math.round((downloaded / total) * 100)
          : null,
      attempt: existing?.attempt ?? 1,
      maxAttempts: existing?.maxAttempts ?? 1,
    };
    this._active.set(url, data);
    await this._events.emit("afterDownload", {
      url,
      result: {
        success: true,
        files: [],
        totalSize: downloaded,
        duration: 0,
        cached: false,
      },
    });
  }

  async completed(
    url: string,
    _size: number,
    _durationMs: number,
  ): Promise<void> {
    this._active.delete(url);
  }

  async failed(url: string, _error: string): Promise<void> {
    this._active.delete(url);
  }

  async retrying(
    url: string,
    attempt: number,
    maxAttempts: number,
    error: string,
  ): Promise<void> {
    const existing = this._active.get(url);
    if (existing !== undefined) {
      const updated: DownloadProgressData = {
        ...existing,
        attempt,
        maxAttempts,
        error,
      };
      this._active.set(url, updated);
    }
  }

  async cancelled(url: string): Promise<void> {
    this._active.delete(url);
  }

  getActive(): ReadonlyMap<string, DownloadProgressData> {
    return this._active;
  }
}
