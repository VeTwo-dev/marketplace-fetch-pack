import type {
  ASTContext,
  ASTError,
  ASTLanguage,
  ASTNode,
  ASTTransform,
  ASTTransformer,
} from "../types/ast.js";

const EXTENSION_MAP: Readonly<Record<string, ASTLanguage>> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function detectLanguage(filePath: string): ASTLanguage {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return "unknown";
  const ext = filePath.slice(dotIndex);
  return EXTENSION_MAP[ext] ?? "unknown";
}

function buildObjectNode(obj: Readonly<Record<string, unknown>>): ASTNode {
  const children = Object.entries(obj).map(([key, val]) =>
    buildPropertyNode(key, val),
  );
  return { type: "object", children } as const satisfies ASTNode;
}

function buildPropertyNode(key: string, value: unknown): ASTNode {
  const valNode = buildValueNode(value);
  return {
    type: "property",
    children: [
      { type: "identifier", value: key } as const satisfies ASTNode,
      valNode,
    ],
  } as const satisfies ASTNode;
}

function buildValueNode(value: unknown): ASTNode {
  if (value === null)
    return { type: "literal", value: "null" } as const satisfies ASTNode;
  if (value === undefined)
    return { type: "literal", value: "undefined" } as const satisfies ASTNode;

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return {
        type: "literal",
        value: String(value),
      } as const satisfies ASTNode;
    case "object":
      if (Array.isArray(value)) {
        return buildArrayNode(value);
      }
      return buildObjectNode(value as Readonly<Record<string, unknown>>);
    default:
      return {
        type: "unknown",
        value: String(value),
      } as const satisfies ASTNode;
  }
}

function buildArrayNode(arr: ReadonlyArray<unknown>): ASTNode {
  const children = arr.map((item) => buildValueNode(item));
  return { type: "array", children } as const satisfies ASTNode;
}

export function parseJson(content: string): ASTNode {
  try {
    const parsed: unknown = JSON.parse(content);
    return buildValueNode(parsed);
  } catch {
    return {
      type: "unknown",
      value: content,
      props: { error: "invalid JSON" },
    } as const satisfies ASTNode;
  }
}

const IMPORT_PATTERN =
  /^import\s+(?:(\w+)\s*,\s*)?(?:{([^}]*)}|\*\s+as\s+(\w+))?\s+from\s+['"]([^'"]+)['"]/;
const EXPORT_DEFAULT = /^export\s+default\s+/;
const EXPORT_NAMED = /^export\s+(?:const|let|var|function|class)\s+(\w+)/;

export function parseJavaScriptSimple(content: string): ASTNode {
  const lines = content.split("\n");
  const children: Array<ASTNode> = [];
  const errors: Array<ASTError> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (
      trimmed.length === 0 ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*")
    ) {
      if (trimmed.startsWith("//") || trimmed.startsWith("/*")) {
        children.push({
          type: "comment",
          value: trimmed,
        } as const satisfies ASTNode);
      }
      continue;
    }

    const importMatch = IMPORT_PATTERN.exec(trimmed);
    if (importMatch !== null) {
      const imports: Array<string> = [];
      if (importMatch[1] !== undefined) imports.push(importMatch[1]);
      if (importMatch[2] !== undefined) {
        for (const spec of importMatch[2]!.split(",")) {
          const name = spec
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (name !== undefined && name.length > 0) imports.push(name);
        }
      }
      if (importMatch[3] !== undefined) imports.push(importMatch[3]);

      children.push({
        type: "import_declaration",
        children: [
          {
            type: "identifier",
            value: imports.join(", "),
          } as const satisfies ASTNode,
          {
            type: "literal",
            value: importMatch[4]!,
          } as const satisfies ASTNode,
        ],
        props: { source: importMatch[4]!, line: i + 1 },
      } as const satisfies ASTNode);
      continue;
    }

    if (EXPORT_DEFAULT.test(trimmed)) {
      children.push({
        type: "export_declaration",
        value: trimmed,
        props: { kind: "default", line: i + 1 },
      } as const satisfies ASTNode);
      continue;
    }

    const exportMatch = EXPORT_NAMED.exec(trimmed);
    if (exportMatch !== null) {
      children.push({
        type: "export_declaration",
        value: exportMatch[1],
        children: [
          {
            type: "identifier",
            value: exportMatch[1]!,
          } as const satisfies ASTNode,
        ],
        props: { kind: "named", line: i + 1 },
      } as const satisfies ASTNode);
    }
  }

  if (errors.length > 0) {
    const errMsg = errors.map((e) => `Line ${e.line}: ${e.message}`).join("; ");
    return {
      type: "unknown",
      value: content,
      props: { error: errMsg },
    } as const satisfies ASTNode;
  }

  return { type: "program", children } as const satisfies ASTNode;
}

export class ASTTransformerImpl implements ASTTransformer {
  private readonly transforms = new Map<string, ASTTransform>();

  addTransform(transform: ASTTransform): void {
    this.transforms.set(transform.name, transform);
  }

  removeTransform(name: string): boolean {
    return this.transforms.delete(name);
  }

  getTransforms(): ReadonlyArray<ASTTransform> {
    return Array.from(this.transforms.values());
  }

  applyTransforms(content: string, context: ASTContext): string {
    let result = content;

    for (const transform of this.transforms.values()) {
      if (transform.target !== "any" && transform.target !== context.language) {
        continue;
      }

      try {
        let ast: ASTNode;
        if (context.language === "json") {
          ast = parseJson(result);
        } else if (
          context.language === "javascript" ||
          context.language === "typescript"
        ) {
          ast = parseJavaScriptSimple(result);
        } else {
          ast = { type: "unknown", value: result } as const satisfies ASTNode;
        }

        if (transform.validate !== undefined && !transform.validate(ast)) {
          continue;
        }

        const transformed = transform.transform(ast, context);
        if (transformed.value !== undefined) {
          result = transformed.value;
        } else if (
          transformed.children !== undefined &&
          transformed.children.length > 0
        ) {
          const parts = transformed.children
            .map((child) => child.value ?? "")
            .filter((v) => v.length > 0);
          if (parts.length > 0) result = parts.join("\n");
        }
      } catch {
        continue;
      }
    }

    return result;
  }
}

export function createASTTransformer(): ASTTransformer {
  return new ASTTransformerImpl();
}
