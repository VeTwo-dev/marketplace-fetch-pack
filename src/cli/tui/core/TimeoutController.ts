export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly timeout: number,
  ) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class TimeoutController {
  private readonly _controller: AbortController;
  private readonly _signal: AbortSignal;
  private _timeoutId: ReturnType<typeof setTimeout> | null = null;
  private _startTime: number = 0;
  private _elapsed: number = 0;
  private _settled: boolean = false;

  constructor(timeout: number) {
    this._controller = new AbortController();
    this._signal = this._controller.signal;
    this._startTime = performance.now();

    if (timeout > 0 && timeout < Infinity) {
      this._timeoutId = setTimeout(() => {
        if (!this._settled) {
          this._controller.abort();
          this._elapsed = performance.now() - this._startTime;
          this._settled = true;
        }
      }, timeout);
    }
  }

  get signal(): AbortSignal {
    return this._signal;
  }

  get elapsed(): number {
    return this._settled ? this._elapsed : performance.now() - this._startTime;
  }

  cancel(): void {
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    if (!this._settled) {
      this._elapsed = performance.now() - this._startTime;
      this._settled = true;
    }
  }

  abort(): void {
    if (!this._settled) {
      this._controller.abort();
      this._elapsed = performance.now() - this._startTime;
      this._settled = true;
      if (this._timeoutId !== null) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }
    }
  }
}

export async function withTimeout<T>(
  promise: Promise<T> | (() => Promise<T>),
  timeout: number,
  stage: string,
): Promise<T> {
  const controller = new TimeoutController(timeout);
  const _startTime = performance.now();
  void _startTime; // kept for parity; controller tracks its own clock

  try {
    const p = typeof promise === "function" ? promise() : promise;
    const result = await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) {
          reject(
            new TimeoutError(
              `Operation "${stage}" timed out after ${timeout}ms`,
              stage,
              timeout,
            ),
          );
          return;
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            reject(
              new TimeoutError(
                `Operation "${stage}" timed out after ${timeout}ms`,
                stage,
                timeout,
              ),
            );
          },
          { once: true },
        );
      }),
    ]);
    controller.cancel();
    return result;
  } catch (error) {
    controller.cancel();
    throw error;
  }
}
