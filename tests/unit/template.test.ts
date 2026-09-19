import { describe, it, expect } from "vitest";
import { render, extractExpressions, renderFile, createTemplateEngine } from "../../src/template/index.js";
import type { TemplateContext } from "../../src/types/template.js";

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    variables: {},
    helpers: {},
    conditions: {},
    ...overrides,
  };
}

describe("template", () => {
  describe("render()", () => {
    it("replaces simple variables", () => {
      const result = render("Hello {{name}}!", ctx({ variables: { name: "World" } }));
      expect(result).toBe("Hello World!");
    });

    it("replaces multiple variables", () => {
      const result = render("{{a}}-{{b}}-{{c}}", ctx({ variables: { a: "1", b: "2", c: "3" } }));
      expect(result).toBe("1-2-3");
    });

    it("leaves unresolved variables as-is", () => {
      const result = render("Hello {{missing}}!", ctx());
      expect(result).toBe("Hello {{missing}}!");
    });

    it("handles conditionals when condition is true", () => {
      const result = render("Before {{#if debug}}DEBUG MODE{{/if}} After", ctx({ conditions: { debug: true } }));
      expect(result).toBe("Before DEBUG MODE After");
    });

    it("removes conditional body when condition is false", () => {
      const result = render("Before {{#if debug}}DEBUG{{/if}} After", ctx({ conditions: { debug: false } }));
      expect(result).toBe("Before  After");
    });

    it("removes conditional body when condition is undefined", () => {
      const result = render("{{#if missing}}body{{/if}}", ctx());
      expect(result).toBe("");
    });

    it("handles helpers with arguments", () => {
      const context = ctx({
        helpers: {
          upper: { name: "upper", fn: (...args) => args.join(" ").toUpperCase() },
        },
      });
      const result = render("{{upper hello world}}", context);
      expect(result).toBe("HELLO WORLD");
    });

    it("leaves unknown helper calls as-is", () => {
      const result = render("{{unknown arg1}}", ctx());
      expect(result).toBe("{{unknown arg1}}");
    });

    it("handles empty template", () => {
      expect(render("", ctx())).toBe("");
    });

    it("handles variables before and after conditionals", () => {
      const result = render(
        "{{greeting}} {{#if show}}visible{{/if}} {{name}}",
        ctx({
          variables: { greeting: "Hi", name: "Bob" },
          conditions: { show: true },
        }),
      );
      expect(result).toBe("Hi visible Bob");
    });
  });

  describe("extractExpressions()", () => {
    it("finds variable expressions", () => {
      const exprs = extractExpressions("Hello {{name}}!");
      expect(exprs).toHaveLength(1);
      expect(exprs[0]!.type).toBe("variable");
      expect(exprs[0]!.name).toBe("name");
    });

    it("finds condition expressions", () => {
      const exprs = extractExpressions("{{#if debug}}body{{/if}}");
      expect(exprs.some((e) => e.type === "condition" && e.name === "debug")).toBe(true);
    });

    it("finds helper expressions", () => {
      const exprs = extractExpressions("{{upper hello}}");
      expect(exprs.some((e) => e.type === "helper" && e.name === "upper")).toBe(true);
    });

    it("does not treat 'if' keyword as a helper", () => {
      const exprs = extractExpressions("{{#if x}}body{{/if}}");
      expect(exprs.some((e) => e.type === "helper")).toBe(false);
    });

    it("returns empty array for no expressions", () => {
      expect(extractExpressions("plain text")).toEqual([]);
    });

    it("finds multiple expression types in one template", () => {
      const template = "{{name}} {{#if flag}}yes{{/if}} {{upper val}}";
      const exprs = extractExpressions(template);
      const types = exprs.map((e) => e.type);
      expect(types).toContain("variable");
      expect(types).toContain("condition");
      expect(types).toContain("helper");
    });

    it("reports each variable occurrence separately", () => {
      const exprs = extractExpressions("{{x}} and {{x}}");
      const variables = exprs.filter((e) => e.type === "variable");
      expect(variables).toHaveLength(2);
    });

    it("includes args for helper expressions", () => {
      const exprs = extractExpressions("{{join a b c}}");
      const helper = exprs.find((e) => e.type === "helper");
      expect(helper).toBeDefined();
      expect(helper!.args).toEqual(["a", "b", "c"]);
    });
  });

  describe("renderFile()", () => {
    it("returns content, expressions, and unresolved", () => {
      const result = renderFile("Hello {{name}} and {{missing}}!", ctx({ variables: { name: "World" } }));
      expect(result.content).toBe("Hello World and {{missing}}!");
      expect(result.expressions.length).toBeGreaterThan(0);
      expect(result.unresolved).toContain("missing");
      expect(result.unresolved).not.toContain("name");
    });

    it("reports no unresolved when all variables provided", () => {
      const result = renderFile("{{a}} {{b}}", ctx({ variables: { a: "1", b: "2" } }));
      expect(result.unresolved).toEqual([]);
    });
  });

  describe("createTemplateEngine()", () => {
    it("returns an object with render, renderFile, extractExpressions", () => {
      const engine = createTemplateEngine();
      expect(engine.render).toBe(render);
      expect(engine.renderFile).toBe(renderFile);
      expect(engine.extractExpressions).toBe(extractExpressions);
    });

    it("engine render works", () => {
      const engine = createTemplateEngine();
      expect(engine.render("{{x}}", ctx({ variables: { x: "OK" } }))).toBe("OK");
    });
  });

  describe("each loops", () => {
    it("renders each loop with items", () => {
      const result = render(
        "{{#each items}}-{{name}}-{{/each}}",
        ctx({
          loops: {
            items: [
              { name: "a" },
              { name: "b" },
              { name: "c" },
            ],
          },
        }),
      );
      expect(result).toBe("-a--b--c-");
    });

    it("returns empty for missing loop variable", () => {
      const result = render("{{#each missing}}item{{/each}}", ctx());
      expect(result).toBe("");
    });

    it("returns empty for empty array", () => {
      const result = render(
        "{{#each items}}item{{/each}}",
        ctx({ loops: { items: [] } }),
      );
      expect(result).toBe("");
    });

    it("handles each with multiple properties", () => {
      const result = render(
        "{{#each items}}{{name}}={{value}} {{/each}}",
        ctx({
          loops: {
            items: [{ name: "x", value: "1" }, { name: "y", value: "2" }],
          },
        }),
      );
      expect(result).toBe("x=1 y=2 ");
    });
  });

  describe("unless blocks", () => {
    it("renders body when condition is false", () => {
      const result = render(
        "Before {{#unless debug}}HIDDEN{{/unless}} After",
        ctx({ conditions: { debug: false } }),
      );
      expect(result).toBe("Before HIDDEN After");
    });

    it("removes body when condition is true", () => {
      const result = render(
        "{{#unless debug}}HIDDEN{{/unless}}",
        ctx({ conditions: { debug: true } }),
      );
      expect(result).toBe("");
    });

    it("renders body when condition is undefined", () => {
      const result = render("{{#unless missing}}body{{/unless}}", ctx());
      expect(result).toBe("body");
    });
  });

  describe("extractExpressions() with new block types", () => {
    it("finds each expressions", () => {
      const exprs = extractExpressions("{{#each items}}item{{/each}}");
      expect(exprs.some((e) => e.type === "loop" && e.name === "items")).toBe(true);
    });

    it("finds unless expressions", () => {
      const exprs = extractExpressions("{{#unless debug}}body{{/unless}}");
      expect(exprs.some((e) => e.type === "condition" && e.name === "debug")).toBe(true);
    });
  });
});
