import { describe, it, expect } from "vitest";
import {
  SingleFlight,
  RequestDeduplicator,
  buildRegistryFetchKey,
  buildManifestFetchKey,
  buildResourceFetchKey,
} from "../../src/registry/single-flight.js";

describe("SingleFlight", () => {
  it("executes function normally", async () => {
    const sf = new SingleFlight();
    const result = await sf.do("key1", async () => 42);
    expect(result).toBe(42);
  });

  it("deduplicates concurrent calls for same key", async () => {
    const sf = new SingleFlight();
    let callCount = 0;

    const fn = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return callCount;
    };

    const [r1, r2, r3] = await Promise.all([
      sf.do("key1", fn),
      sf.do("key1", fn),
      sf.do("key1", fn),
    ]);

    expect(callCount).toBe(1);
    expect(r1).toBe(1);
    expect(r2).toBe(1);
    expect(r3).toBe(1);
  });

  it("tracks inflight count", async () => {
    const sf = new SingleFlight();
    expect(sf.inflightCount).toBe(0);

    let resolveExternal: (() => void) | null = null;
    const promise = sf.do("key1", async () => {
      await new Promise<void>((r) => { resolveExternal = r; });
      return 42;
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(sf.inflightCount).toBe(1);

    resolveExternal!();
    await promise;
    expect(sf.inflightCount).toBe(0);
  });

  it("different keys execute independently", async () => {
    const sf = new SingleFlight();
    let countA = 0;
    let countB = 0;

    const [r1, r2] = await Promise.all([
      sf.do("a", async () => { countA++; return countA; }),
      sf.do("b", async () => { countB++; return countB; }),
    ]);

    expect(countA).toBe(1);
    expect(countB).toBe(1);
    expect(r1).toBe(1);
    expect(r2).toBe(1);
  });

  it("rejection does not poison future requests", async () => {
    const sf = new SingleFlight();

    await expect(sf.do("key1", async () => { throw new Error("fail"); })).rejects.toThrow("fail");

    const result = await sf.do("key1", async () => "success");
    expect(result).toBe("success");
  });

  it("caches negative results briefly", async () => {
    const sf = new SingleFlight(1000);

    await expect(sf.do("key1", async () => { throw new Error("fail"); })).rejects.toThrow("fail");

    const cached = sf.getNegativeCache("key1");
    expect(cached).toBeInstanceOf(Error);
  });

  it("negative cache expires", async () => {
    const sf = new SingleFlight(1);

    await expect(sf.do("key1", async () => { throw new Error("fail"); })).rejects.toThrow("fail");

    await new Promise((r) => setTimeout(r, 10));

    const cached = sf.getNegativeCache("key1");
    expect(cached).toBeNull();
  });

  it("clear removes all state", async () => {
    const sf = new SingleFlight();
    await sf.do("key1", async () => 42);
    sf.clear();
    expect(sf.inflightCount).toBe(0);
  });
});

describe("RequestDeduplicator", () => {
  it("deduplicates requests", async () => {
    const dedup = new RequestDeduplicator();
    let count = 0;

    const [r1, r2] = await Promise.all([
      dedup.deduplicate("key", async () => { count++; return count; }),
      dedup.deduplicate("key", async () => { count++; return count; }),
    ]);

    expect(count).toBe(1);
    expect(r1).toBe(1);
    expect(r2).toBe(1);
  });

  it("deduplicates multiple keys", async () => {
    const dedup = new RequestDeduplicator();
    const results = await dedup.deduplicateMultiple(
      ["a", "b", "c"],
      [
        async () => "a-result",
        async () => "b-result",
        async () => "c-result",
      ],
    );

    expect(results).toEqual(["a-result", "b-result", "c-result"]);
  });
});

describe("key builders", () => {
  it("buildRegistryFetchKey", () => {
    const key = buildRegistryFetchKey("https://github.com/test/repo", "main");
    expect(key).toBe("registry:https://github.com/test/repo:main");
  });

  it("buildManifestFetchKey", () => {
    const key = buildManifestFetchKey("https://github.com/test/repo", "resource.json");
    expect(key).toBe("manifest:https://github.com/test/repo:resource.json");
  });

  it("buildResourceFetchKey", () => {
    const key = buildResourceFetchKey("https://github.com/test/repo", "my-resource");
    expect(key).toBe("resource:https://github.com/test/repo:my-resource");
  });
});
