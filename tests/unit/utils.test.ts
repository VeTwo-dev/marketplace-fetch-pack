import { describe, it, expect, vi } from "vitest";
import {
  sha256,
  sleep,
  truncate,
  slugify,
  normalizeVersion,
  isPlainObject,
  deepMerge,
  uniqueBy,
  groupBy,
  sortBy,
  computeLevenshtein,
  pick,
  omit,
  invariant,
} from "../../src/utils/index.js";

describe("sha256()", () => {
  it("returns a 64-char hex string", () => {
    const hash = sha256("hello");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("same input gives same output", () => {
    expect(sha256("test")).toBe(sha256("test"));
  });

  it("different input gives different output", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("handles empty string", () => {
    expect(sha256("")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("sleep()", () => {
  it("resolves after specified time", async () => {
    const start = performance.now();
    await sleep(50);
    const elapsed = performance.now() - start;
    // Monotonic clock: no integer rounding flake; allow small scheduler jitter
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});

describe("truncate()", () => {
  it("returns original string if shorter than max", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("handles very short max", () => {
    expect(truncate("hello", 3)).toBe("...");
  });
});

describe("slugify()", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Hello! @World#")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("handles multiple spaces", () => {
    expect(slugify("hello   world")).toBe("hello-world");
  });
});

describe("normalizeVersion()", () => {
  it("removes v prefix", () => {
    expect(normalizeVersion("v1.0.0")).toBe("1.0.0");
  });

  it("leaves version without prefix unchanged", () => {
    expect(normalizeVersion("1.0.0")).toBe("1.0.0");
  });
});

describe("isPlainObject()", () => {
  it("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("returns false for arrays", () => {
    expect(isPlainObject([])).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPlainObject(undefined)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject("str")).toBe(false);
  });
});

describe("deepMerge()", () => {
  it("merges flat objects", () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("deep merges nested objects", () => {
    const result = deepMerge(
      { a: { x: 1, y: 2 }, b: 1 },
      { a: { y: 3, z: 4 } },
    );
    expect(result).toEqual({ a: { x: 1, y: 3, z: 4 }, b: 1 });
  });

  it("does not mutate original", () => {
    const target = { a: 1 };
    const source = { b: 2 };
    deepMerge(target, source);
    expect(target).toEqual({ a: 1 });
  });

  it("handles empty source", () => {
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
  });
});

describe("uniqueBy()", () => {
  it("removes duplicates by key", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }];
    const result = uniqueBy(items, (i) => i.id);
    expect(result).toHaveLength(3);
  });

  it("preserves first occurrence", () => {
    const items = [{ id: 1, val: "a" }, { id: 1, val: "b" }];
    const result = uniqueBy(items, (i) => i.id);
    expect(result[0]!.val).toBe("a");
  });

  it("handles empty array", () => {
    expect(uniqueBy([], (i: { id: number }) => i.id)).toEqual([]);
  });
});

describe("groupBy()", () => {
  it("groups items by key", () => {
    const items = [
      { type: "a", val: 1 },
      { type: "b", val: 2 },
      { type: "a", val: 3 },
    ];
    const result = groupBy(items, (i) => i.type);
    expect(result.a).toHaveLength(2);
    expect(result.b).toHaveLength(1);
  });

  it("handles empty array", () => {
    const result = groupBy([], (i: { type: string }) => i.type);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("sortBy()", () => {
  it("sorts ascending by default", () => {
    const items = [3, 1, 2];
    const result = sortBy(items, (i) => i);
    expect(result).toEqual([1, 2, 3]);
  });

  it("sorts descending", () => {
    const items = [3, 1, 2];
    const result = sortBy(items, (i) => i, "desc");
    expect(result).toEqual([3, 2, 1]);
  });

  it("sorts strings", () => {
    const items = ["banana", "apple", "cherry"];
    const result = sortBy(items, (i) => i);
    expect(result).toEqual(["apple", "banana", "cherry"]);
  });

  it("does not mutate original", () => {
    const items = [3, 1, 2];
    sortBy(items, (i) => i);
    expect(items).toEqual([3, 1, 2]);
  });
});

describe("computeLevenshtein()", () => {
  it("returns 0 for identical strings", () => {
    expect(computeLevenshtein("abc", "abc")).toBe(0);
  });

  it("returns length difference for completely different strings", () => {
    expect(computeLevenshtein("abc", "xyz")).toBe(3);
  });

  it("computes correct distance", () => {
    expect(computeLevenshtein("kitten", "sitting")).toBe(3);
  });

  it("handles empty strings", () => {
    expect(computeLevenshtein("", "abc")).toBe(3);
    expect(computeLevenshtein("abc", "")).toBe(3);
    expect(computeLevenshtein("", "")).toBe(0);
  });

  it("is symmetric", () => {
    expect(computeLevenshtein("abc", "xyz")).toBe(computeLevenshtein("xyz", "abc"));
  });
});

describe("pick()", () => {
  it("picks specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("ignores missing keys", () => {
    const obj = { a: 1 } as Record<string, unknown>;
    expect(pick(obj, ["a" as any, "b" as any])).toEqual({ a: 1 });
  });

  it("handles empty keys", () => {
    expect(pick({ a: 1 }, [])).toEqual({});
  });
});

describe("omit()", () => {
  it("omits specified keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("omits multiple keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["a", "c"])).toEqual({ b: 2 });
  });

  it("returns same object for empty keys", () => {
    const obj = { a: 1 };
    const result = omit(obj, []);
    expect(result).toEqual({ a: 1 });
  });
});

describe("invariant()", () => {
  it("does nothing when condition is true", () => {
    expect(() => invariant(true, "msg")).not.toThrow();
  });

  it("throws when condition is false", () => {
    expect(() => invariant(false, "failed")).toThrow("Invariant violation: failed");
  });
});
