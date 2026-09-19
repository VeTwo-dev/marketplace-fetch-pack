import { describe, it, expect } from "vitest";
import {
  evaluateFreshness,
  shouldUseCache,
  shouldRevalidate,
  shouldBlockOnNetwork,
  getPolicyDefaults,
  type FreshnessPolicy,
} from "../../src/registry/freshness-policy.js";

describe("FreshnessPolicy", () => {
  describe("evaluateFreshness", () => {
    describe("cache-only policy", () => {
      it("always returns fresh", () => {
        const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        const result = evaluateFreshness(oldDate, "cache-only");
        expect(result.state).toBe("fresh");
      });
    });

    describe("prefer-cache policy", () => {
      it("returns fresh for recent cache", () => {
        const recent = new Date(Date.now() - 60_000).toISOString();
        const result = evaluateFreshness(recent, "prefer-cache");
        expect(result.state).toBe("fresh");
      });

      it("returns stale for moderately old cache", () => {
        const old = new Date(Date.now() - 10 * 60_000).toISOString();
        const result = evaluateFreshness(old, "prefer-cache");
        expect(result.state).toBe("stale");
      });

      it("returns expired for very old cache", () => {
        const ancient = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
        const result = evaluateFreshness(ancient, "prefer-cache");
        expect(result.state).toBe("expired");
      });
    });

    describe("normal policy", () => {
      it("returns fresh for recent cache", () => {
        const recent = new Date(Date.now() - 60_000).toISOString();
        const result = evaluateFreshness(recent, "normal");
        expect(result.state).toBe("fresh");
      });

      it("returns stale for moderately old cache", () => {
        const old = new Date(Date.now() - 10 * 60_000).toISOString();
        const result = evaluateFreshness(old, "normal");
        expect(result.state).toBe("stale");
      });

      it("returns expired for very old cache", () => {
        const ancient = new Date(Date.now() - 30 * 60_000).toISOString();
        const result = evaluateFreshness(ancient, "normal");
        expect(result.state).toBe("expired");
      });
    });

    describe("refresh policy", () => {
      it("always returns expired", () => {
        const recent = new Date(Date.now() - 1000).toISOString();
        const result = evaluateFreshness(recent, "refresh");
        expect(result.state).toBe("expired");
      });
    });

    describe("strict policy", () => {
      it("always returns expired", () => {
        const recent = new Date(Date.now() - 1000).toISOString();
        const result = evaluateFreshness(recent, "strict");
        expect(result.state).toBe("expired");
      });
    });

    it("handles future-dated cache", () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      const result = evaluateFreshness(future, "normal");
      expect(result.state).toBe("fresh");
      expect(result.ageMs).toBe(0);
    });
  });

  describe("shouldUseCache", () => {
    it("returns true for fresh", () => {
      expect(shouldUseCache({ state: "fresh", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(true);
    });

    it("returns true for stale", () => {
      expect(shouldUseCache({ state: "stale", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(true);
    });

    it("returns false for expired", () => {
      expect(shouldUseCache({ state: "expired", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(false);
    });

    it("returns true for offline", () => {
      expect(shouldUseCache({ state: "offline", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(true);
    });

    it("returns true for remote-failed", () => {
      expect(shouldUseCache({ state: "remote-failed", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(true);
    });

    it("returns false for no-cache", () => {
      expect(shouldUseCache({ state: "no-cache", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(false);
    });
  });

  describe("shouldRevalidate", () => {
    it("returns true for stale", () => {
      expect(shouldRevalidate({ state: "stale", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(true);
    });

    it("returns false for fresh", () => {
      expect(shouldRevalidate({ state: "fresh", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(false);
    });

    it("returns false for expired", () => {
      expect(shouldRevalidate({ state: "expired", ageMs: 0, maxAgeMs: 100, source: "test" })).toBe(false);
    });
  });

  describe("shouldBlockOnNetwork", () => {
    it("returns true for refresh", () => {
      expect(shouldBlockOnNetwork("refresh")).toBe(true);
    });

    it("returns true for strict", () => {
      expect(shouldBlockOnNetwork("strict")).toBe(true);
    });

    it("returns false for normal", () => {
      expect(shouldBlockOnNetwork("normal")).toBe(false);
    });

    it("returns false for prefer-cache", () => {
      expect(shouldBlockOnNetwork("prefer-cache")).toBe(false);
    });

    it("returns false for cache-only", () => {
      expect(shouldBlockOnNetwork("cache-only")).toBe(false);
    });
  });

  describe("getPolicyDefaults", () => {
    it("returns defaults for each policy", () => {
      expect(getPolicyDefaults("cache-only")).toEqual({ maxAgeMs: Infinity, maxStaleMs: Infinity });
      expect(getPolicyDefaults("refresh")).toEqual({ maxAgeMs: 0, maxStaleMs: 0 });
      expect(getPolicyDefaults("strict")).toEqual({ maxAgeMs: 0, maxStaleMs: 0 });
      expect(getPolicyDefaults("normal").maxAgeMs).toBeGreaterThan(0);
      expect(getPolicyDefaults("prefer-cache").maxAgeMs).toBeGreaterThan(0);
    });
  });
});
