import { describe, it, expect, vi } from "vitest";
import {
  HookSystem,
  createHookSystem,
} from "../../src/hooks/index.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

describe("HookSystem", () => {
  describe("register/unregister", () => {
    it("registers and executes a hook", async () => {
      const hooks = new HookSystem();
      const handler = vi.fn((input: number) => input + 1);
      hooks.register("double", "p1", handler);

      expect(hooks.has("double")).toBe(true);
      const result = await hooks.execute<number, number>("double", 1);
      expect(result).toBe(2);
      expect(handler).toHaveBeenCalledWith(1, expect.anything());
    });

    it("unregisters a specific plugin's hook", async () => {
      const hooks = new HookSystem();
      const h1 = vi.fn((n: number) => n + 1);
      const h2 = vi.fn((n: number) => n + 10);
      hooks.register("add", "p1", h1);
      hooks.register("add", "p2", h2);

      expect(hooks.unregister("add", "p1")).toBe(true);
      expect(hooks.unregister("add", "p1")).toBe(false);
      const result = await hooks.execute<number, number>("add", 0);
      expect(result).toBe(10);
    });

    it("unregisters all hooks for a plugin", async () => {
      const hooks = new HookSystem();
      hooks.register("a", "p1", (x) => x);
      hooks.register("b", "p1", (x) => x);
      hooks.register("a", "p2", (x) => x);

      hooks.unregisterAll("p1");
      expect(hooks.has("a")).toBe(true);
      expect(hooks.getEntries("a").map((e) => e.pluginId)).toEqual(["p2"]);
      expect(hooks.getPluginHooks("p1")).toEqual([]);
      expect(hooks.getPluginHooks("p2")).toEqual(["a"]);
    });
  });

  describe("ordering", () => {
    it("executes hooks in priority order (lower first)", async () => {
      const hooks = new HookSystem();
      const order: string[] = [];
      hooks.register("h", "late", async (s: string) => {
        order.push("late");
        return s;
      }, { priority: 100 });
      hooks.register("h", "early", async (s: string) => {
        order.push("early");
        return s;
      }, { priority: -10 });
      hooks.register("h", "middle", async (s: string) => {
        order.push("middle");
        return s;
      }, { priority: 0 });

      await hooks.execute<string, string>("h", "x");
      expect(order).toEqual(["early", "middle", "late"]);
    });

    it("chains results through multiple hooks", async () => {
      const hooks = new HookSystem();
      hooks.register("chain", "p1", (n: number) => n + 1);
      hooks.register("chain", "p2", (n: number) => n * 10);

      const result = await hooks.execute<number, number>("chain", 2);
      expect(result).toBe(30);
    });
  });

  describe("error policies", () => {
    it("throws PLUGIN_HOOK_ERROR under throw policy", async () => {
      const hooks = new HookSystem();
      hooks.register("h", "bad", () => {
        throw new Error("boom");
      }, { errorPolicy: "throw" });

      await expect(hooks.execute("h", 0)).rejects.toThrow(MarketplaceClientError);
    });

    it("logs and continues under log policy", async () => {
      const hooks = new HookSystem();
      hooks.register("h", "bad", () => {
        throw new Error("boom");
      }, { errorPolicy: "log" });
      hooks.register("h", "good", (n: number) => n + 5);

      const result = await hooks.execute<number, number>("h", 0);
      expect(result).toBe(5);
    });

    it("ignores errors under ignore policy", async () => {
      const hooks = new HookSystem();
      hooks.register("h", "bad", () => {
        throw new Error("boom");
      }, { errorPolicy: "ignore" });
      hooks.register("h", "good", (n: number) => n + 7);

      const result = await hooks.execute<number, number>("h", 0);
      expect(result).toBe(7);
    });
  });

  describe("fast path", () => {
    it("uses defaultHandler when no hooks registered", async () => {
      const hooks = new HookSystem();
      expect(hooks.has("nothing")).toBe(false);

      const result = await hooks.execute<number, number>(
        "nothing",
        41,
        (n) => n + 1,
      );
      expect(result).toBe(42);
    });

    it("returns input unchanged when no hooks and no default", async () => {
      const hooks = new HookSystem();
      const input = { a: 1 };
      const result = await hooks.execute<typeof input, typeof input>("none", input);
      expect(result).toBe(input);
    });
  });

  describe("introspection", () => {
    it("lists hook names", () => {
      const hooks = new HookSystem();
      hooks.register("alpha", "p1", (x) => x);
      hooks.register("beta", "p1", (x) => x);
      expect(hooks.getHookNames().sort()).toEqual(["alpha", "beta"]);
    });
  });

  describe("createHookSystem", () => {
    it("creates a HookSystem instance", () => {
      expect(createHookSystem()).toBeInstanceOf(HookSystem);
    });
  });
});
