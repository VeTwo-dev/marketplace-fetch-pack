import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/index.js";

describe("EventBus", () => {
  it("emits and receives events", async () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("beforeSearch", listener);
    await bus.emit("beforeSearch", { query: "test" });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ query: "test" });
  });

  it("supports multiple listeners on same event", async () => {
    const bus = new EventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    bus.on("beforeSearch", listener1);
    bus.on("beforeSearch", listener2);
    await bus.emit("beforeSearch", { query: "q" });
    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it("once() fires listener only once", async () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.once("beforeSearch", listener);
    await bus.emit("beforeSearch", { query: "1" });
    await bus.emit("beforeSearch", { query: "2" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("off() removes a listener", async () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("beforeSearch", listener);
    bus.off("beforeSearch", listener);
    await bus.emit("beforeSearch", { query: "test" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("removeAllListeners() for specific event", async () => {
    const bus = new EventBus();
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.on("beforeSearch", l1);
    bus.on("afterSearch", l2);
    bus.removeAllListeners("beforeSearch");
    await bus.emit("beforeSearch", { query: "q" });
    await bus.emit("afterSearch", { query: "q", resultCount: 0 });
    expect(l1).not.toHaveBeenCalled();
    expect(l2).toHaveBeenCalledOnce();
  });

  it("removeAllListeners() without event removes all", async () => {
    const bus = new EventBus();
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.on("beforeSearch", l1);
    bus.on("afterSearch", l2);
    bus.removeAllListeners();
    await bus.emit("beforeSearch", { query: "q" });
    await bus.emit("afterSearch", { query: "q", resultCount: 0 });
    expect(l1).not.toHaveBeenCalled();
    expect(l2).not.toHaveBeenCalled();
  });

  it("listenerCount() returns correct count", () => {
    const bus = new EventBus();
    expect(bus.listenerCount("beforeSearch")).toBe(0);
    const unsub = bus.on("beforeSearch", () => {});
    expect(bus.listenerCount("beforeSearch")).toBe(1);
    bus.on("beforeSearch", () => {});
    expect(bus.listenerCount("beforeSearch")).toBe(2);
    unsub();
    expect(bus.listenerCount("beforeSearch")).toBe(1);
  });

  it("eventNames() returns names with listeners", () => {
    const bus = new EventBus();
    bus.on("beforeSearch", () => {});
    bus.on("afterSearch", () => {});
    const names = bus.eventNames();
    expect(names).toContain("beforeSearch");
    expect(names).toContain("afterSearch");
  });

  it("async listeners are awaited in order", async () => {
    const bus = new EventBus();
    const order: number[] = [];
    bus.on("beforeSearch", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });
    bus.on("beforeSearch", async () => {
      order.push(2);
    });
    await bus.emit("beforeSearch", { query: "q" });
    expect(order).toEqual([1, 2]);
  });

  it("error in listener doesn't break subsequent listeners", async () => {
    const bus = new EventBus();
    const badListener = () => {
      throw new Error("boom");
    };
    const goodListener = vi.fn();
    bus.on("beforeSearch", badListener);
    bus.on("beforeSearch", goodListener);
    await bus.emit("beforeSearch", { query: "q" });
    expect(goodListener).toHaveBeenCalledOnce();
  });

  it("unsubscribe function from on() works", async () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const unsub = bus.on("beforeSearch", listener);
    unsub();
    await bus.emit("beforeSearch", { query: "q" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("emit does nothing when no listeners", async () => {
    const bus = new EventBus();
    await expect(bus.emit("beforeSearch", { query: "q" })).resolves.toBeUndefined();
  });

  it("off for non-existent listener does nothing", () => {
    const bus = new EventBus();
    bus.off("beforeSearch", () => {}); // no-op
  });
});
