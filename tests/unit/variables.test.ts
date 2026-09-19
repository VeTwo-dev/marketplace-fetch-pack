import { describe, it, expect } from "vitest";
import { resolve, extractVariables, validate, createVariableResolver } from "../../src/variables/index.js";
import type { VariableDefinition } from "../../src/types/variables.js";

describe("variables", () => {
  describe("resolve()", () => {
    it("replaces a single {{var}} pattern", () => {
      expect(resolve("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
    });

    it("replaces multiple different variables", () => {
      const result = resolve("{{greet}} {{name}}, version {{ver}}", {
        greet: "Hi",
        name: "Alice",
        ver: "2.0",
      });
      expect(result).toBe("Hi Alice, version 2.0");
    });

    it("replaces repeated variable occurrences", () => {
      expect(resolve("{{x}} and {{x}}", { x: "foo" })).toBe("foo and foo");
    });

    it("leaves missing variables as-is", () => {
      expect(resolve("Hello {{missing}}!", {})).toBe("Hello {{missing}}!");
    });

    it("leaves partial matches intact", () => {
      expect(resolve("{{name}}", {})).toBe("{{name}}");
    });

    it("handles content with no variables", () => {
      expect(resolve("no vars here", { a: "b" })).toBe("no vars here");
    });

    it("handles whitespace inside braces", () => {
      expect(resolve("Hello {{ name }}!", { name: "World" })).toBe("Hello World!");
    });

    it("handles dotted variable names", () => {
      expect(resolve("{{config.debug}}", { "config.debug": "true" })).toBe("true");
    });

    it("handles empty values", () => {
      expect(resolve("Hello {{name}}!", { name: "" })).toBe("Hello !");
    });
  });

  describe("extractVariables()", () => {
    it("extracts a single variable name", () => {
      expect(extractVariables("Hello {{name}}!")).toEqual(["name"]);
    });

    it("extracts multiple unique variable names", () => {
      const result = extractVariables("{{a}} {{b}} {{c}}");
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("deduplicates repeated variables", () => {
      const result = extractVariables("{{x}} {{y}} {{x}}");
      expect(result).toEqual(["x", "y"]);
    });

    it("returns empty array when no variables present", () => {
      expect(extractVariables("no vars here")).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      expect(extractVariables("")).toEqual([]);
    });

    it("handles dotted variable names", () => {
      expect(extractVariables("{{config.debug}}")).toEqual(["config.debug"]);
    });

    it("extracts mixed variables and plain text", () => {
      const result = extractVariables("prefix {{a}} middle {{b}} suffix");
      expect(result).toEqual(["a", "b"]);
    });
  });

  describe("validate()", () => {
    const defs: ReadonlyArray<VariableDefinition> = [
      { name: "name", type: "string", description: "Name", required: true },
      { name: "age", type: "number", description: "Age", required: false },
      { name: "color", type: "choice", description: "Color", required: false, validation: { choices: ["red", "green", "blue"] } },
      { name: "flag", type: "boolean", description: "Flag", required: true },
      { name: "pattern", type: "string", description: "Pattern", required: false, validation: { pattern: "^[a-z]+$" } },
    ];

    it("returns no errors when all required values provided", () => {
      const errors = validate({ name: "Alice", flag: "true" }, defs);
      expect(errors).toHaveLength(0);
    });

    it("returns error for missing required variable", () => {
      const errors = validate({ age: "25" }, defs);
      expect(errors).toHaveLength(2);
      expect(errors.find((e) => e.name === "name")).toBeDefined();
      expect(errors.find((e) => e.name === "name")!.type).toBe("missing");
      expect(errors.find((e) => e.name === "flag")).toBeDefined();
    });

    it("returns error for empty string on required variable", () => {
      const errors = validate({ name: "", flag: "true" }, defs);
      expect(errors.find((e) => e.name === "name")).toBeDefined();
      expect(errors.find((e) => e.name === "name")!.type).toBe("missing");
    });

    it("does not require non-required variables", () => {
      const errors = validate({ name: "Alice", flag: "true" }, defs);
      expect(errors.find((e) => e.name === "age")).toBeUndefined();
    });

    it("returns type mismatch for invalid boolean", () => {
      const errors = validate({ name: "Alice", flag: "yes" }, defs);
      expect(errors.find((e) => e.name === "flag")).toBeDefined();
      expect(errors.find((e) => e.name === "flag")!.type).toBe("type_mismatch");
    });

    it("returns type mismatch for invalid number", () => {
      const errors = validate({ name: "Alice", age: "not-a-number", flag: "true" }, defs);
      expect(errors.find((e) => e.name === "age")).toBeDefined();
      expect(errors.find((e) => e.name === "age")!.type).toBe("type_mismatch");
    });

    it("validates choices - rejects invalid value via type check", () => {
      const errors = validate({ name: "Alice", flag: "true", color: "purple" }, defs);
      expect(errors.find((e) => e.name === "color")).toBeDefined();
      expect(errors.find((e) => e.name === "color")!.type).toBe("type_mismatch");
    });

    it("accepts valid choice", () => {
      const errors = validate({ name: "Alice", flag: "true", color: "red" }, defs);
      expect(errors.find((e) => e.name === "color")).toBeUndefined();
    });

    it("validates pattern", () => {
      const errors = validate({ name: "Alice", flag: "true", pattern: "ABC" }, defs);
      expect(errors.find((e) => e.name === "pattern")).toBeDefined();
      expect(errors.find((e) => e.name === "pattern")!.message).toContain("pattern");
    });

    it("accepts valid pattern", () => {
      const errors = validate({ name: "Alice", flag: "true", pattern: "hello" }, defs);
      expect(errors.find((e) => e.name === "pattern")).toBeUndefined();
    });

    it("validates min/max for numbers", () => {
      const defsMin: VariableDefinition[] = [
        { name: "count", type: "number", description: "Count", required: false, validation: { min: 1, max: 10 } },
      ];
      const low = validate({ count: "0" }, defsMin);
      expect(low.find((e) => e.name === "count")).toBeDefined();
      expect(low.find((e) => e.name === "count")!.type).toBe("invalid");

      const high = validate({ count: "20" }, defsMin);
      expect(high.find((e) => e.name === "count")).toBeDefined();
    });

    it("validates custom function", () => {
      const defsCustom: VariableDefinition[] = [
        { name: "val", type: "string", description: "Val", required: false, validation: { custom: (v) => v.startsWith("ok-") } },
      ];
      expect(validate({ val: "ok-123" }, defsCustom)).toHaveLength(0);
      expect(validate({ val: "bad" }, defsCustom).find((e) => e.name === "val")).toBeDefined();
    });

    it("returns empty array for empty definitions", () => {
      expect(validate({ name: "Alice" }, [])).toEqual([]);
    });
  });

  describe("createVariableResolver()", () => {
    it("returns an object with resolve, extractVariables, validate", () => {
      const resolver = createVariableResolver();
      expect(resolver.resolve).toBe(resolve);
      expect(resolver.extractVariables).toBe(extractVariables);
      expect(resolver.validate).toBe(validate);
    });

    it("resolve works through the resolver", () => {
      const resolver = createVariableResolver();
      expect(resolver.resolve("{{x}}", { x: "42" })).toBe("42");
    });

    it("extractVariables works through the resolver", () => {
      const resolver = createVariableResolver();
      expect(resolver.extractVariables("{{a}} {{b}}")).toEqual(["a", "b"]);
    });
  });
});
