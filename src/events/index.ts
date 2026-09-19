import type {
  MarketplaceEvent,
  MarketplaceEventData,
  EventListener,
  EventUnsubscribe,
} from "../types/events.js";
import { createLogger, type Logger } from "../logger/index.js";

export class EventBus {
  private readonly _listeners: Map<
    MarketplaceEvent,
    Array<{
      listener: EventListener<unknown>;
      once: boolean;
    }>
  > = new Map();
  private readonly _logger: Logger;

  constructor(logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "events" });
  }

  on<K extends MarketplaceEvent>(
    event: K,
    listener: EventListener<MarketplaceEventData[K]>,
  ): EventUnsubscribe {
    return this._addListener(event, listener, false);
  }

  once<K extends MarketplaceEvent>(
    event: K,
    listener: EventListener<MarketplaceEventData[K]>,
  ): EventUnsubscribe {
    return this._addListener(event, listener, true);
  }

  async emit<K extends MarketplaceEvent>(
    event: K,
    data: MarketplaceEventData[K],
  ): Promise<void> {
    const listeners = this._listeners.get(event);
    if (listeners === undefined || listeners.length === 0) return;

    this._logger.debug(`Emitting event: ${event}`);

    const toRemove: Array<{ listener: EventListener<unknown>; once: boolean }> =
      [];

    for (const entry of listeners) {
      try {
        await entry.listener(data);
      } catch (error) {
        this._logger.error(`Error in event listener for ${event}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (entry.once) {
        toRemove.push(entry);
      }
    }

    if (toRemove.length > 0) {
      const remaining = listeners.filter((l) => !toRemove.includes(l));
      this._listeners.set(event, remaining);
    }
  }

  off<K extends MarketplaceEvent>(
    event: K,
    listener: EventListener<MarketplaceEventData[K]>,
  ): void {
    const listeners = this._listeners.get(event);
    if (listeners === undefined) return;

    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  }

  removeAllListeners(event?: MarketplaceEvent): void {
    if (event !== undefined) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  listenerCount(event: MarketplaceEvent): number {
    return this._listeners.get(event)?.length ?? 0;
  }

  eventNames(): ReadonlyArray<MarketplaceEvent> {
    return Array.from(this._listeners.keys());
  }

  private _addListener<K extends MarketplaceEvent>(
    event: K,
    listener: EventListener<MarketplaceEventData[K]>,
    once: boolean,
  ): EventUnsubscribe {
    let listeners = this._listeners.get(event);
    if (listeners === undefined) {
      listeners = [];
      this._listeners.set(event, listeners);
    }

    const entry = { listener: listener as EventListener<unknown>, once };
    listeners.push(entry);

    return () => {
      const idx = listeners?.indexOf(entry) ?? -1;
      if (idx >= 0 && listeners !== undefined) {
        listeners.splice(idx, 1);
      }
    };
  }
}
