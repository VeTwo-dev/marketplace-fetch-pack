import { describe, it, expect } from "vitest";
import { createMergeRegistry, MergeRegistryImpl } from "../../src/merge/index.js";
import type { MergeStrategy, MergeContext, MergeStrategyName } from "../../src/types/merge.js";

function ctx(strategy: MergeStrategyName = "copy"): MergeContext {
  return {
    filePath: "test.txt",
    variables: {},
    strategy,
    options: { deep: true, arrays: "replace", conflictResolution: "incoming", preserveComments: false },
  };
}

describe("merge", () => {
  describe("MergeRegistryImpl", () => {
    it("register and get", () => {
      const registry = createMergeRegistry();
      const strategy: MergeStrategy = {
        name: "copy",
        description: "copy",
        merge: (existing, incoming) => ({ content: incoming, changed: true, conflicts: [], strategy: "copy" }),
      };
      registry.register(strategy);
      expect(registry.get("copy")).toBe(strategy);
    });

    it("unregister", () => {
      const registry = createMergeRegistry();
      expect(registry.unregister("copy")).toBe(true);
      expect(registry.get("copy")).toBeUndefined();
    });

    it("unregister returns false for unknown", () => {
      const registry = createMergeRegistry();
      expect(registry.unregister("nonexistent")).toBe(false);
    });

    it("getAll returns all strategies", () => {
      const registry = createMergeRegistry();
      const all = registry.getAll();
      const names = all.map((s) => s.name);
      expect(names).toContain("copy");
      expect(names).toContain("replace");
      expect(names).toContain("merge");
      expect(names).toContain("append");
      expect(names).toContain("prepend");
      expect(names).toContain("patch");
      expect(names).toContain("ast");
      expect(names).toContain("template");
    });
  });

  describe("builtin: copy", () => {
    it("replaces existing with incoming", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("old", "new", "copy", ctx("copy"));
      expect(result.content).toBe("new");
      expect(result.changed).toBe(true);
    });

    it("reports no change when same content", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("same", "same", "copy", ctx("copy"));
      expect(result.changed).toBe(false);
    });
  });

  describe("builtin: replace", () => {
    it("replaces existing with incoming", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("old", "new", "replace", ctx("replace"));
      expect(result.content).toBe("new");
      expect(result.changed).toBe(true);
    });
  });

  describe("builtin: merge", () => {
    it("deep merges JSON objects", () => {
      const registry = createMergeRegistry();
      const existing = JSON.stringify({ a: 1, b: { c: 2, d: 3 } });
      const incoming = JSON.stringify({ b: { c: 99 }, e: 4 });
      const result = registry.apply(existing, incoming, "merge", ctx("merge"));
      const merged = JSON.parse(result.content);
      expect(merged.a).toBe(1);
      expect(merged.b.c).toBe(99);
      expect(merged.b.d).toBe(3);
      expect(merged.e).toBe(4);
    });

    it("reports conflicts for overlapping keys", () => {
      const registry = createMergeRegistry();
      const existing = JSON.stringify({ key: "old" });
      const incoming = JSON.stringify({ key: "new" });
      const result = registry.apply(existing, incoming, "merge", ctx("merge"));
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0]!.path).toBe("key");
      expect(result.conflicts[0]!.type).toBe("key");
    });

    it("reports array conflicts", () => {
      const registry = createMergeRegistry();
      const existing = JSON.stringify({ items: [1, 2] });
      const incoming = JSON.stringify({ items: [3, 4] });
      const result = registry.apply(existing, incoming, "merge", ctx("merge"));
      expect(result.conflicts.some((c) => c.type === "array")).toBe(true);
    });

    it("reports no conflicts for non-overlapping keys", () => {
      const registry = createMergeRegistry();
      const existing = JSON.stringify({ a: 1 });
      const incoming = JSON.stringify({ b: 2 });
      const result = registry.apply(existing, incoming, "merge", ctx("merge"));
      expect(result.conflicts).toHaveLength(0);
    });

    it("returns incoming for invalid JSON", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("not-json", "incoming", "merge", ctx("merge"));
      expect(result.content).toBe("incoming");
      expect(result.changed).toBe(true);
    });
  });

  describe("builtin: append", () => {
    it("appends incoming after existing", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("hello", " world", "append", ctx("append"));
      expect(result.content).toBe("hello world");
      expect(result.changed).toBe(true);
    });

    it("reports no change when both empty", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("", "", "append", ctx("append"));
      expect(result.content).toBe("");
      expect(result.changed).toBe(false);
    });
  });

  describe("builtin: prepend", () => {
    it("prepends incoming before existing", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("world", "hello ", "prepend", ctx("prepend"));
      expect(result.content).toBe("hello world");
      expect(result.changed).toBe(true);
    });
  });

  describe("builtin: patch", () => {
    it("adds only new lines", () => {
      const registry = createMergeRegistry();
      const existing = "line1\nline2";
      const incoming = "line1\nline2\nline3";
      const result = registry.apply(existing, incoming, "patch", ctx("patch"));
      expect(result.changed).toBe(true);
      expect(result.content).toContain("line3");
      expect(result.content).toContain("line1");
    });

    it("reports no change when no new lines", () => {
      const registry = createMergeRegistry();
      const existing = "line1\nline2";
      const incoming = "line1\nline2";
      const result = registry.apply(existing, incoming, "patch", ctx("patch"));
      expect(result.changed).toBe(false);
      expect(result.content).toBe(existing);
    });

    it("handles completely new content", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("old", "old\nnew", "patch", ctx("patch"));
      expect(result.changed).toBe(true);
      expect(result.content).toContain("new");
    });
  });

  describe("apply() with unknown strategy", () => {
    it("falls back to returning incoming", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("old", "new", "template" as MergeStrategyName, ctx("template" as MergeStrategyName));
      expect(result.content).toBe("new");
    });
  });

  describe("builtin: ast", () => {
    it("merges imports from both files", () => {
      const registry = createMergeRegistry();
      const existing = 'import { a } from "a";\nconst x = 1;';
      const incoming = 'import { b } from "b";\nconst y = 2;';
      const result = registry.apply(existing, incoming, "ast", ctx("ast"));
      expect(result.content).toContain('import { a } from "a"');
      expect(result.content).toContain('import { b } from "b"');
      expect(result.content).toContain("const x = 1;");
      expect(result.content).toContain("const y = 2;");
      expect(result.changed).toBe(true);
    });

    it("deduplicates identical imports", () => {
      const registry = createMergeRegistry();
      const existing = 'import { a } from "a";\nconst x = 1;';
      const incoming = 'import { a } from "a";\nconst y = 2;';
      const result = registry.apply(existing, incoming, "ast", ctx("ast"));
      const importCount = (result.content.match(/import \{ a \} from "a"/g) ?? []).length;
      expect(importCount).toBe(1);
    });

    it("reports no change for identical content", () => {
      const registry = createMergeRegistry();
      const content = 'import { a } from "a";\nconst x = 1;';
      const result = registry.apply(content, content, "ast", ctx("ast"));
      expect(result.changed).toBe(false);
    });
  });

  describe("builtin: template", () => {
    it("resolves template variables", () => {
      const registry = createMergeRegistry();
      const incoming = "Hello {{name}}, welcome to {{project}}!";
      const context = ctx("template");
      const result = registry.apply("", incoming, "template", {
        ...context,
        variables: { name: "Alice", project: "VeTwo" },
      });
      expect(result.content).toBe("Hello Alice, welcome to VeTwo!");
      expect(result.changed).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it("reports conflicts for unresolved variables", () => {
      const registry = createMergeRegistry();
      const incoming = "Hello {{name}}, version {{version}}!";
      const result = registry.apply("", incoming, "template", ctx("template"));
      expect(result.content).toContain("{{name}}");
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it("reports no change for empty content", () => {
      const registry = createMergeRegistry();
      const result = registry.apply("", "", "template", ctx("template"));
      expect(result.changed).toBe(false);
    });
  });
});
