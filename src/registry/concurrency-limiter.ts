export interface ConcurrencyLimiterConfig {
  readonly maxConcurrent: number;
  readonly queueTimeoutMs: number;
}

const DEFAULT_CONFIG: ConcurrencyLimiterConfig = {
  maxConcurrent: 5,
  queueTimeoutMs: 30_000,
};

export class ConcurrencyLimiter {
  private readonly _config: ConcurrencyLimiterConfig;
  private _running = 0;
  private readonly _queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(config?: Partial<ConcurrencyLimiterConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  get running(): number {
    return this._running;
  }

  get queued(): number {
    return this._queue.length;
  }

  get available(): number {
    return this._config.maxConcurrent - this._running;
  }

  async acquire(): Promise<void> {
    if (this._running < this._config.maxConcurrent) {
      this._running++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._queue.findIndex((entry) => entry.resolve === resolve);
        if (idx >= 0) {
          this._queue.splice(idx, 1);
        }
        reject(
          new Error(
            `Concurrency limit queue timeout after ${this._config.queueTimeoutMs}ms`,
          ),
        );
      }, this._config.queueTimeoutMs);

      this._queue.push({
        resolve: () => {
          clearTimeout(timer);
          this._running++;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  release(): void {
    if (this._running > 0) {
      this._running--;
    }

    const next = this._queue.shift();
    if (next !== undefined) {
      next.resolve();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  async runAll<T>(tasks: ReadonlyArray<() => Promise<T>>): Promise<Array<T>> {
    const results: Array<T> = [];
    const errors: Array<{ index: number; error: unknown }> = [];

    const executeTask = async (
      index: number,
      task: () => Promise<T>,
    ): Promise<void> => {
      try {
        const result = await this.run(task);
        results[index] = result;
      } catch (error) {
        errors.push({ index, error });
      }
    };

    const promises = tasks.map((task, index) => executeTask(index, task));
    await Promise.all(promises);

    if (errors.length > 0) {
      const firstError = errors[0]!;
      throw firstError.error;
    }

    return results;
  }

  clear(): void {
    for (const entry of this._queue) {
      entry.reject(new Error("Concurrency limiter cleared"));
    }
    this._queue.length = 0;
    this._running = 0;
  }
}
