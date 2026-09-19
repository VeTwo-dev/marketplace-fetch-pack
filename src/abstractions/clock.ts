export interface Clock {
  now(): number;
  nowIso(): string;
  sleep(ms: number): Promise<void>;
}
export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
export class FakeClock implements Clock {
  private _now: number;
  constructor(start = 0) {
    this._now = start;
  }
  now(): number {
    return this._now;
  }
  nowIso(): string {
    return new Date(this._now).toISOString();
  }
  advance(ms: number): void {
    this._now += ms;
  }
  sleep(ms: number): Promise<void> {
    this._now += ms;
    return Promise.resolve();
  }
}
