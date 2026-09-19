export interface TemplateEngine {
  render(template: string, context: TemplateContext): string;
  renderFile(template: string, context: TemplateContext): TemplateRenderResult;
  extractExpressions(template: string): ReadonlyArray<TemplateExpression>;
}

export interface TemplateContext {
  readonly variables: Readonly<Record<string, string>>;
  readonly helpers: Readonly<Record<string, TemplateHelper>>;
  readonly conditions: Readonly<Record<string, boolean>>;
  readonly loops?: Readonly<
    Record<string, ReadonlyArray<Readonly<Record<string, string>>>>
  >;
}

export interface TemplateHelper {
  readonly name: string;
  readonly fn: (...args: ReadonlyArray<string>) => string;
}

export interface TemplateExpression {
  readonly raw: string;
  readonly type: "variable" | "condition" | "loop" | "helper";
  readonly name: string;
  readonly args?: ReadonlyArray<string>;
}

export interface TemplateRenderResult {
  readonly content: string;
  readonly expressions: ReadonlyArray<TemplateExpression>;
  readonly unresolved: ReadonlyArray<string>;
}

export type TemplateSyntax = "mustache" | "ejs" | "custom";

export interface TemplateSyntaxConfig {
  readonly open: string;
  readonly close: string;
  readonly expressionMarker?: string;
  readonly blockStart?: string;
  readonly blockEnd?: string;
}
