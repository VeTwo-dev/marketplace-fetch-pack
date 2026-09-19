import { describe, it, expect } from "vitest";
import { ExampleMemoryProvider } from "../../src/extensions/example-provider.js";
import { createLogger } from "../../src/logger/index.js";

describe("architecture contracts", () => {
  it("provider independence: custom provider works without core change", async () => {
    const p = new ExampleMemoryProvider();
    await p.connect({ repository: "x", branch: "main" } as any);
    const tree = await p.getTree();
    expect(tree.length).toBeGreaterThan(0);
  });
  it("core does not import TUI", async () => {
    const fs = await import("node:fs/promises");
    const txt = await fs.readFile("src/marketplace/index.ts", "utf-8");
    expect(txt).not.toMatch(/from.*tui|from.*ink/i);
  });
  it("state root canonical", async () => {
    const { resolveStateRoot } = await import("../../src/state/index.js");
    expect(resolveStateRoot("/proj")).toBe("/proj/.vetwo/marketplace");
  });
});
