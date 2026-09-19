import type {
  TemplateContext,
  TemplateEngine,
  TemplateExpression,
  TemplateRenderResult,
} from "../types/template.js";

const EXPR_REGEX = /\{\{(.+?)\}\}/g;
const SPACE_SPLIT = /\s+/;

export function render(template: string, context: TemplateContext): string {
  let result = template;

  const eachPattern = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  result = result.replace(
    eachPattern,
    (_match, itemsName: string, body: string) => {
      const items = context.loops?.[itemsName];
      if (items === undefined || !Array.isArray(items) || items.length === 0)
        return "";
      return items
        .map((item) => {
          let rendered = body;
          for (const [key, value] of Object.entries(
            item as Record<string, string>,
          )) {
            rendered = rendered.replaceAll(`{{${key}}}`, value);
          }
          return rendered;
        })
        .join("");
    },
  );

  const unlessPattern = /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g;
  result = result.replace(
    unlessPattern,
    (_match, cond: string, body: string) => {
      const falsy = context.conditions[cond] !== true;
      return falsy ? body : "";
    },
  );

  const ifPattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  result = result.replace(ifPattern, (_match, cond: string, body: string) => {
    const truthy = context.conditions[cond] === true;
    return truthy ? body : "";
  });

  for (const [name, value] of Object.entries(context.variables)) {
    result = result.replaceAll(`{{${name}}}`, value);
  }

  result = result.replace(EXPR_REGEX, (_match, inner: string) => {
    const parts = inner.trim().split(SPACE_SPLIT) as Array<string>;
    const fnName = parts[0]!;

    if (fnName in context.helpers) {
      const helper = context.helpers[fnName]!;
      return helper.fn(...parts.slice(1));
    }

    const value = context.variables[fnName];
    return value !== undefined ? value : _match;
  });

  return result;
}

function parseArgs(raw: string): ReadonlyArray<string> {
  return raw
    .trim()
    .split(SPACE_SPLIT)
    .filter((a) => a.length > 0);
}

export function extractExpressions(
  template: string,
): ReadonlyArray<TemplateExpression> {
  const expressions: Array<TemplateExpression> = [];
  const ifPattern = /\{\{#if\s+(\w+)\}\}/g;
  const unlessPattern = /\{\{#unless\s+(\w+)\}\}/g;
  const eachPattern = /\{\{#each\s+(\w+)\}\}/g;
  const helperPattern = /\{\{(\w+)\s+([\s\S]*?)\}\}/g;

  let ifMatch = ifPattern.exec(template);
  while (ifMatch !== null) {
    expressions.push({
      raw: ifMatch[0],
      type: "condition",
      name: ifMatch[1]!,
    });
    ifMatch = ifPattern.exec(template);
  }

  let unlessMatch = unlessPattern.exec(template);
  while (unlessMatch !== null) {
    expressions.push({
      raw: unlessMatch[0],
      type: "condition",
      name: unlessMatch[1]!,
    });
    unlessMatch = unlessPattern.exec(template);
  }

  let eachMatch = eachPattern.exec(template);
  while (eachMatch !== null) {
    expressions.push({
      raw: eachMatch[0],
      type: "loop",
      name: eachMatch[1]!,
    });
    eachMatch = eachPattern.exec(template);
  }

  let hMatch = helperPattern.exec(template);
  while (hMatch !== null) {
    const name = hMatch[1]!;
    if (name !== "if" && name !== "each" && name !== "unless") {
      expressions.push({
        raw: hMatch[0],
        type: "helper",
        name,
        args: parseArgs(hMatch[2]!),
      });
    }
    hMatch = helperPattern.exec(template);
  }

  const variablePattern = /\{\{(\w+(?:\.\w+)*)\}\}/g;
  let vMatch = variablePattern.exec(template);
  while (vMatch !== null) {
    const name = vMatch[1]!;
    const isCondition = expressions.some(
      (e) => (e.type === "condition" || e.type === "loop") && e.name === name,
    );
    if (!isCondition) {
      expressions.push({
        raw: vMatch[0],
        type: "variable",
        name,
      });
    }
    vMatch = variablePattern.exec(template);
  }

  return expressions;
}

export function renderFile(
  template: string,
  context: TemplateContext,
): TemplateRenderResult {
  const expressions = extractExpressions(template);
  const content = render(template, context);

  const resolvedNames = new Set(
    Object.keys(context.variables as Record<string, string>),
  );
  const unresolved = expressions
    .filter((e) => e.type === "variable" && !resolvedNames.has(e.name))
    .map((e) => e.name);

  return {
    content,
    expressions,
    unresolved,
  } as const satisfies TemplateRenderResult;
}

export function createTemplateEngine(): TemplateEngine {
  return { render, renderFile, extractExpressions };
}
