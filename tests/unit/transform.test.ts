import { describe, it, expect } from "vitest";
import { createTransformRegistry, TransformRegistryImpl } from "../../src/transform/index.js";
import type { TransformDefinition, TransformInput, TransformOutput } from "../../src/types/transform.js";

describe("transform", () => {
  describe("TransformRegistryImpl", () => {
    it("register and get", () => {
      const registry = createTransformRegistry();
      const def: TransformDefinition = {
        name: "custom",
        description: "test",
        target: "content",
        order: 1,
        transform: async (input) => ({ content: input.content, path: input.path }),
      };
      registry.register(def);
      expect(registry.get("custom")).toBe(def);
    });

    it("unregister", () => {
      const registry = createTransformRegistry();
      registry.register({
        name: "to-remove",
        description: "test",
        target: "content",
        order: 1,
        transform: async (input) => ({ content: input.content, path: input.path }),
      });
      expect(registry.unregister("to-remove")).toBe(true);
      expect(registry.get("to-remove")).toBeUndefined();
    });

    it("unregister returns false for unknown", () => {
      const registry = createTransformRegistry();
      expect(registry.unregister("nonexistent")).toBe(false);
    });

    it("getAll returns all registered transforms", () => {
      const registry = createTransformRegistry();
      const all = registry.getAll();
      expect(all.length).toBeGreaterThanOrEqual(5);
      expect(all.map((d) => d.name)).toContain("package-json-merge");
      expect(all.map((d) => d.name)).toContain("prepend");
      expect(all.map((d) => d.name)).toContain("append");
      expect(all.map((d) => d.name)).toContain("env-inject");
      expect(all.map((d) => d.name)).toContain("import-inject");
    });

    it("get returns undefined for unknown name", () => {
      const registry = createTransformRegistry();
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("apply()", () => {
    it("applies no transforms returns original content", async () => {
      const registry = createTransformRegistry();
      const result = await registry.apply("original", "test.txt", [], {});
      expect(result).toBe("original");
    });

    it("applies transforms in order", async () => {
      const registry = createTransformRegistry();
      registry.register({
        name: "first",
        description: "",
        target: "content",
        order: 1,
        transform: async (input) => ({
          content: input.content + "-first",
          path: input.path,
        }),
      });
      registry.register({
        name: "second",
        description: "",
        target: "content",
        order: 2,
        transform: async (input) => ({
          content: input.content + "-second",
          path: input.path,
        }),
      });
      const result = await registry.apply("start", "f.txt", ["second", "first"], {});
      expect(result).toBe("start-first-second");
    });

    it("skips transforms not in the provided list", async () => {
      const registry = createTransformRegistry();
      registry.register({
        name: "skip-me",
        description: "",
        target: "content",
        order: 1,
        transform: async (input) => ({
          content: input.content + "-changed",
          path: input.path,
        }),
      });
      const result = await registry.apply("keep", "f.txt", [], {});
      expect(result).toBe("keep");
    });

    it("skips transforms with unknown names", async () => {
      const registry = createTransformRegistry();
      const result = await registry.apply("keep", "f.txt", ["nonexistent"], {});
      expect(result).toBe("keep");
    });
  });

  describe("builtin: package-json-merge", () => {
    it("merges JSON content with patch variable", async () => {
      const registry = createTransformRegistry();
      const base = JSON.stringify({ name: "test", version: "1.0.0" });
      const patch = JSON.stringify({ version: "2.0.0", description: "updated" });
      const result = await registry.apply(base, "package.json", ["package-json-merge"], {
        "package-json-patch": patch,
      });
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("test");
      expect(parsed.version).toBe("2.0.0");
      expect(parsed.description).toBe("updated");
    });

    it("returns original when no patch variable", async () => {
      const registry = createTransformRegistry();
      const base = '{"key":"val"}';
      const result = await registry.apply(base, "package.json", ["package-json-merge"], {});
      expect(result).toBe(base);
    });

    it("returns original on invalid JSON", async () => {
      const registry = createTransformRegistry();
      const result = await registry.apply("not json", "package.json", ["package-json-merge"], {
        "package-json-patch": "also not json",
      });
      expect(result).toBe("not json");
    });
  });

  describe("builtin: prepend", () => {
    it("prepends content", async () => {
      const registry = createTransformRegistry();
      const result = await registry.apply("world", "f.txt", ["prepend"], {
        "prepend-content": "hello ",
      });
      expect(result).toBe("hello world");
    });

    it("returns original when no prefix variable", async () => {
      const registry = createTransformRegistry();
      const result = await registry.apply("original", "f.txt", ["prepend"], {});
      expect(result).toBe("original");
    });
  });

  describe("builtin: append", () => {
    it("appends content", async () => {
      const registry = createTransformRegistry();
      const result = await registry.apply("hello", "f.txt", ["append"], {
        "append-content": " world",
      });
      expect(result).toBe("hello world");
    });

    it("returns original when no suffix variable", async () => {
      const registry = createTransformRegistry();
      const result = await registry.apply("original", "f.txt", ["append"], {});
      expect(result).toBe("original");
    });
  });

  describe("builtin: env-inject", () => {
    it("replaces process.env.KEY references", async () => {
      const registry = createTransformRegistry();
      const content = "const x = process.env.API_KEY;";
      const result = await registry.apply(content, "f.js", ["env-inject"], {
        ENV_API_KEY: "secret123",
      });
      expect(result).toContain('"secret123"');
      expect(result).not.toContain("process.env.API_KEY");
    });

    it("replaces process.env['KEY'] references", async () => {
      const registry = createTransformRegistry();
      const content = "const x = process.env['API_KEY'];";
      const result = await registry.apply(content, "f.js", ["env-inject"], {
        ENV_API_KEY: "val",
      });
      expect(result).toContain('"val"');
    });

    it("returns original when no ENV_ prefixed variables", async () => {
      const registry = createTransformRegistry();
      const content = "const x = process.env.KEY;";
      const result = await registry.apply(content, "f.js", ["env-inject"], {
        KEY: "val",
      });
      expect(result).toBe(content);
    });
  });

  describe("builtin: import-inject", () => {
    it("injects import statements after existing imports", async () => {
      const registry = createTransformRegistry();
      const content = 'import x from "mod";\nconst a = 1;';
      const result = await registry.apply(content, "f.js", ["import-inject"], {
        "inject-imports": 'import y from "other";',
      });
      const lines = result.split("\n");
      const importIdx = lines.findIndex((l) => l.includes("other"));
      const constIdx = lines.findIndex((l) => l.includes("const"));
      expect(importIdx).toBeLessThan(constIdx);
    });

    it("does not inject duplicate imports", async () => {
      const registry = createTransformRegistry();
      const content = 'import x from "mod";';
      const result = await registry.apply(content, "f.js", ["import-inject"], {
        "inject-imports": 'import x from "mod";',
      });
      expect(result.split("\n").filter((l) => l.includes("import")).length).toBe(1);
    });

    it("inserts at top when no existing imports", async () => {
      const registry = createTransformRegistry();
      const content = "const a = 1;";
      const result = await registry.apply(content, "f.js", ["import-inject"], {
        "inject-imports": 'import z from "z";',
      });
      expect(result.startsWith('import z from "z";')).toBe(true);
    });

    it("returns original when no inject-imports variable", async () => {
      const registry = createTransformRegistry();
      const content = "const a = 1;";
      const result = await registry.apply(content, "f.js", ["import-inject"], {});
      expect(result).toBe(content);
    });

    it("handles multiple import statements in inject-imports", async () => {
      const registry = createTransformRegistry();
      const content = "const a = 1;";
      const result = await registry.apply(content, "f.js", ["import-inject"], {
        "inject-imports": 'import a from "a";\nimport b from "b";',
      });
      expect(result.split("\n").filter((l) => l.startsWith("import")).length).toBe(2);
    });
  });
});
