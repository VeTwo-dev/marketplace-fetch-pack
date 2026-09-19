export interface ASTTransform {
  readonly name: string;
  readonly target: ASTTransformTarget;
  transform(ast: ASTNode, context: ASTContext): ASTNode;
  validate?(ast: ASTNode): boolean;
}

export type ASTTransformTarget =
  "import" | "export" | "route" | "config" | "json" | "any";

export interface ASTNode {
  readonly type: ASTNodeType;
  readonly children?: ReadonlyArray<ASTNode>;
  readonly value?: string;
  readonly props?: Readonly<Record<string, unknown>>;
}

export type ASTNodeType =
  | "program"
  | "import_declaration"
  | "export_declaration"
  | "variable_declaration"
  | "function_declaration"
  | "class_declaration"
  | "expression"
  | "statement"
  | "block"
  | "object"
  | "array"
  | "property"
  | "identifier"
  | "literal"
  | "comment"
  | "unknown";

export interface ASTContext {
  readonly filePath: string;
  readonly language: ASTLanguage;
  readonly variables: Readonly<Record<string, string>>;
}

export type ASTLanguage =
  "javascript" | "typescript" | "json" | "yaml" | "unknown";

export interface ASTParseResult {
  readonly ast: ASTNode;
  readonly language: ASTLanguage;
  readonly errors: ReadonlyArray<ASTError>;
}

export interface ASTError {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface ASTTransformer {
  addTransform(transform: ASTTransform): void;
  removeTransform(name: string): boolean;
  applyTransforms(content: string, context: ASTContext): string;
  getTransforms(): ReadonlyArray<ASTTransform>;
}
