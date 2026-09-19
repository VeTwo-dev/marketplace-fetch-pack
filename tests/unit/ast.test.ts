import { describe, it, expect } from "vitest";
import { detectLanguage, parseJson, parseJavaScriptSimple, createASTTransformer, ASTTransformerImpl } from "../../src/ast/index.js";
import type { ASTNode, ASTContext, ASTTransform } from "../../src/types/ast.js";

describe("ast", () => {
  describe("detectLanguage()", () => {
    it("returns 'typescript' for .ts", () => {
      expect(detectLanguage("file.ts")).toBe("typescript");
    });

    it("returns 'typescript' for .tsx", () => {
      expect(detectLanguage("file.tsx")).toBe("typescript");
    });

    it("returns 'typescript' for .mts", () => {
      expect(detectLanguage("file.mts")).toBe("typescript");
    });

    it("returns 'typescript' for .cts", () => {
      expect(detectLanguage("file.cts")).toBe("typescript");
    });

    it("returns 'javascript' for .js", () => {
      expect(detectLanguage("file.js")).toBe("javascript");
    });

    it("returns 'javascript' for .jsx", () => {
      expect(detectLanguage("file.jsx")).toBe("javascript");
    });

    it("returns 'javascript' for .mjs", () => {
      expect(detectLanguage("file.mjs")).toBe("javascript");
    });

    it("returns 'javascript' for .cjs", () => {
      expect(detectLanguage("file.cjs")).toBe("javascript");
    });

    it("returns 'json' for .json", () => {
      expect(detectLanguage("file.json")).toBe("json");
    });

    it("returns 'yaml' for .yaml", () => {
      expect(detectLanguage("file.yaml")).toBe("yaml");
    });

    it("returns 'yaml' for .yml", () => {
      expect(detectLanguage("file.yml")).toBe("yaml");
    });

    it("returns 'unknown' for no extension", () => {
      expect(detectLanguage("Makefile")).toBe("unknown");
    });

    it("returns 'unknown' for unsupported extension", () => {
      expect(detectLanguage("file.xyz")).toBe("unknown");
    });

    it("handles files with directories in path", () => {
      expect(detectLanguage("/path/to/file.ts")).toBe("typescript");
    });
  });

  describe("parseJson()", () => {
    it("parses a simple object", () => {
      const node = parseJson('{"key": "value"}');
      expect(node.type).toBe("object");
      expect(node.children).toBeDefined();
      expect(node.children!.length).toBe(1);
    });

    it("parses nested objects", () => {
      const node = parseJson('{"a": {"b": "c"}}');
      expect(node.type).toBe("object");
      const propNode = node.children![0]!;
      expect(propNode.type).toBe("property");
      const nestedObj = propNode.children![1]!;
      expect(nestedObj.type).toBe("object");
    });

    it("parses arrays", () => {
      const node = parseJson('[1, 2, 3]');
      expect(node.type).toBe("array");
      expect(node.children).toHaveLength(3);
    });

    it("parses string literals", () => {
      const node = parseJson('"hello"');
      expect(node.type).toBe("literal");
      expect(node.value).toBe("hello");
    });

    it("parses number literals", () => {
      const node = parseJson('42');
      expect(node.type).toBe("literal");
      expect(node.value).toBe("42");
    });

    it("parses boolean literals", () => {
      const node = parseJson("true");
      expect(node.type).toBe("literal");
      expect(node.value).toBe("true");
    });

    it("parses null", () => {
      const node = parseJson("null");
      expect(node.type).toBe("literal");
      expect(node.value).toBe("null");
    });

    it("returns unknown node for invalid JSON", () => {
      const node = parseJson("{invalid json}");
      expect(node.type).toBe("unknown");
      expect(node.props).toBeDefined();
      expect((node.props as Record<string, unknown>).error).toBe("invalid JSON");
    });

    it("builds property nodes with identifier and value children", () => {
      const node = parseJson('{"name": "test"}');
      const prop = node.children![0]!;
      expect(prop.type).toBe("property");
      expect(prop.children).toHaveLength(2);
      expect(prop.children![0]!.type).toBe("identifier");
      expect(prop.children![0]!.value).toBe("name");
      expect(prop.children![1]!.type).toBe("literal");
      expect(prop.children![1]!.value).toBe("test");
    });

    it("handles empty object", () => {
      const node = parseJson("{}");
      expect(node.type).toBe("object");
      expect(node.children).toHaveLength(0);
    });

    it("handles empty array", () => {
      const node = parseJson("[]");
      expect(node.type).toBe("array");
      expect(node.children).toHaveLength(0);
    });
  });

  describe("parseJavaScriptSimple()", () => {
    it("extracts default import with braces", () => {
      const node = parseJavaScriptSimple('import { default as React } from "react";');
      expect(node.type).toBe("program");
      expect(node.children).toHaveLength(1);
      expect(node.children![0]!.type).toBe("import_declaration");
      expect(node.children![0]!.props).toMatchObject({ source: "react" });
    });

    it("extracts named imports", () => {
      const node = parseJavaScriptSimple('import { useState, useEffect } from "react";');
      expect(node.children).toHaveLength(1);
      const importNode = node.children![0]!;
      expect(importNode.type).toBe("import_declaration");
      expect(importNode.children![0]!.value).toContain("useState");
      expect(importNode.children![0]!.value).toContain("useEffect");
    });

    it("extracts namespace import", () => {
      const node = parseJavaScriptSimple('import * as fs from "fs";');
      expect(node.children).toHaveLength(1);
      expect(node.children![0]!.children![0]!.value).toContain("fs");
    });

    it("extracts default export", () => {
      const node = parseJavaScriptSimple("export default function App() {}");
      expect(node.children).toHaveLength(1);
      expect(node.children![0]!.type).toBe("export_declaration");
      expect(node.children![0]!.props).toMatchObject({ kind: "default" });
    });

    it("extracts named export", () => {
      const node = parseJavaScriptSimple("export const foo = 1;");
      expect(node.children).toHaveLength(1);
      expect(node.children![0]!.type).toBe("export_declaration");
      expect(node.children![0]!.props).toMatchObject({ kind: "named" });
      expect(node.children![0]!.value).toBe("foo");
    });

    it("extracts comments", () => {
      const node = parseJavaScriptSimple("// this is a comment");
      expect(node.children).toHaveLength(1);
      expect(node.children![0]!.type).toBe("comment");
    });

    it("skips empty lines", () => {
      const node = parseJavaScriptSimple("\n\n\n");
      expect(node.type).toBe("program");
      expect(node.children).toHaveLength(0);
    });

    it("handles mixed imports and exports", () => {
      const code = [
        'import { x } from "mod";',
        'import { a } from "other";',
        "export const val = 1;",
      ].join("\n");
      const node = parseJavaScriptSimple(code);
      expect(node.children).toHaveLength(3);
      expect(node.children![0]!.type).toBe("import_declaration");
      expect(node.children![1]!.type).toBe("import_declaration");
      expect(node.children![2]!.type).toBe("export_declaration");
    });

    it("extracts combined default and named imports", () => {
      const node = parseJavaScriptSimple('import React, { useState } from "react";');
      expect(node.children).toHaveLength(1);
      expect(node.children![0]!.children![0]!.value).toContain("React");
      expect(node.children![0]!.children![0]!.value).toContain("useState");
    });
  });

  describe("ASTTransformer", () => {
    const context: ASTContext = {
      filePath: "test.json",
      language: "json",
      variables: {},
    };

    it("addTransform and getTransforms", () => {
      const transformer = createASTTransformer();
      const t: ASTTransform = {
        name: "test",
        target: "any",
        transform: (ast) => ast,
      };
      transformer.addTransform(t);
      expect(transformer.getTransforms()).toHaveLength(1);
      expect(transformer.getTransforms()[0]!.name).toBe("test");
    });

    it("removeTransform", () => {
      const transformer = createASTTransformer();
      transformer.addTransform({ name: "t1", target: "any", transform: (ast) => ast });
      transformer.addTransform({ name: "t2", target: "any", transform: (ast) => ast });
      expect(transformer.removeTransform("t1")).toBe(true);
      expect(transformer.getTransforms()).toHaveLength(1);
      expect(transformer.getTransforms()[0]!.name).toBe("t2");
    });

    it("removeTransform returns false for unknown name", () => {
      const transformer = createASTTransformer();
      expect(transformer.removeTransform("nonexistent")).toBe(false);
    });

    it("applyTransforms applies transforms in order", () => {
      const transformer = createASTTransformer();
      transformer.addTransform({
        name: "append",
        target: "json",
        transform: (ast) => ({
          type: "literal",
          value: (ast.value ?? "") + "-modified",
        }),
      });
      const result = transformer.applyTransforms("original", context);
      expect(result).toBe("original-modified");
    });

    it("applyTransforms skips transforms with non-matching target", () => {
      const transformer = createASTTransformer();
      transformer.addTransform({
        name: "js-only",
        target: "import",
        transform: (ast) => ({ type: "literal", value: "changed" }),
      });
      const result = transformer.applyTransforms("keep", context);
      expect(result).toBe("keep");
    });

    it("applyTransforms applies 'any' target to all languages", () => {
      const transformer = createASTTransformer();
      transformer.addTransform({
        name: "any-transform",
        target: "any",
        transform: () => ({ type: "literal", value: "transformed" }),
      });
      const result = transformer.applyTransforms("original", context);
      expect(result).toBe("transformed");
    });

    it("applyTransforms skips when validate returns false", () => {
      const transformer = createASTTransformer();
      transformer.addTransform({
        name: "validated",
        target: "json",
        validate: () => false,
        transform: () => ({ type: "literal", value: "changed" }),
      });
      const result = transformer.applyTransforms("keep", context);
      expect(result).toBe("keep");
    });

    it("applyTransforms catches and skips failing transforms", () => {
      const transformer = createASTTransformer();
      transformer.addTransform({
        name: "thrower",
        target: "json",
        transform: () => {
          throw new Error("boom");
        },
      });
      transformer.addTransform({
        name: "after-throw",
        target: "json",
        transform: () => ({ type: "literal", value: "ok" }),
      });
      const result = transformer.applyTransforms("start", context);
      expect(result).toBe("ok");
    });

    it("replacing a transform with same name updates it", () => {
      const transformer = createASTTransformer();
      transformer.addTransform({ name: "t", target: "any", transform: () => ({ type: "literal", value: "v1" }) });
      transformer.addTransform({ name: "t", target: "any", transform: () => ({ type: "literal", value: "v2" }) });
      expect(transformer.getTransforms()).toHaveLength(1);
      const result = transformer.applyTransforms("", context);
      expect(result).toBe("v2");
    });
  });
});
