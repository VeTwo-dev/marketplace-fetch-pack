import type {
  MergeStrategy,
  MergeStrategyName,
  MergeContext,
  MergeResult,
  MergeRegistry,
} from "../types/merge.js";

export class MergeRegistryImpl implements MergeRegistry {
  private readonly _strategies = new Map<MergeStrategyName, MergeStrategy>();

  register(strategy: MergeStrategy): void {
    this._strategies.set(strategy.name, strategy);
  }

  unregister(name: MergeStrategyName): boolean {
    return this._strategies.delete(name);
  }

  get(name: MergeStrategyName): MergeStrategy | undefined {
    return this._strategies.get(name);
  }

  getAll(): ReadonlyArray<MergeStrategy> {
    return [...this._strategies.values()];
  }

  apply(
    existing: string,
    incoming: string,
    strategy: MergeStrategyName,
    context: MergeContext,
  ): MergeResult {
    const impl = this._strategies.get(strategy);
    if (impl === undefined) {
      return {
        content: incoming,
        changed: existing !== incoming,
        conflicts: [],
        strategy,
      };
    }
    return impl.merge(existing, incoming, context);
  }
}

function deepMergeJsonObjects(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMergeJsonObjects(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMergeJson(
  existing: string,
  incoming: string,
  context: MergeContext,
): MergeResult {
  const conflicts: Array<{
    path: string;
    type: "key" | "array" | "structure";
    existing: string;
    incoming: string;
    resolution: string;
  }> = [];

  try {
    const existingObj: Record<string, unknown> = JSON.parse(existing) as Record<
      string,
      unknown
    >;
    const incomingObj: Record<string, unknown> = JSON.parse(incoming) as Record<
      string,
      unknown
    >;
    const merged = deepMergeJsonObjects(existingObj, incomingObj);

    collectConflicts(existingObj, incomingObj, "", conflicts);

    return {
      content: JSON.stringify(merged, null, 2),
      changed: existing !== JSON.stringify(merged, null, 2),
      conflicts,
      strategy: context.strategy,
    };
  } catch {
    return {
      content: incoming,
      changed: existing !== incoming,
      conflicts: [],
      strategy: context.strategy,
    };
  }
}

function collectConflicts(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  basePath: string,
  conflicts: Array<{
    path: string;
    type: "key" | "array" | "structure";
    existing: string;
    incoming: string;
    resolution: string;
  }>,
): void {
  for (const key of Object.keys(incoming)) {
    const existingVal = existing[key];
    const incomingVal = incoming[key];
    const path = basePath === "" ? key : `${basePath}.${key}`;

    if (existingVal !== undefined) {
      if (Array.isArray(existingVal) && Array.isArray(incomingVal)) {
        conflicts.push({
          path,
          type: "array",
          existing: JSON.stringify(existingVal),
          incoming: JSON.stringify(incomingVal),
          resolution: JSON.stringify(incomingVal),
        });
      } else if (isPlainObject(existingVal) && isPlainObject(incomingVal)) {
        collectConflicts(
          existingVal as Record<string, unknown>,
          incomingVal as Record<string, unknown>,
          path,
          conflicts,
        );
      } else {
        conflicts.push({
          path,
          type: "key",
          existing: String(existingVal),
          incoming: String(incomingVal),
          resolution: String(incomingVal),
        });
      }
    }
  }
}

function lineDiff(
  existing: string,
  incoming: string,
): { added: string[]; removed: string[] } {
  const existingLines = existing.split("\n");
  const incomingLines = incoming.split("\n");

  const existingSet = new Set(existingLines);
  const incomingSet = new Set(incomingLines);

  const added: string[] = [];
  const removed: string[] = [];

  for (const line of incomingLines) {
    if (!existingSet.has(line)) {
      added.push(line);
    }
  }

  for (const line of existingLines) {
    if (!incomingSet.has(line)) {
      removed.push(line);
    }
  }

  return { added, removed };
}

function extractImports(code: string): Array<string> {
  const lines = code.split("\n");
  return lines.filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("import{") ||
      (trimmed.startsWith("const ") && trimmed.includes("require("))
    );
  });
}

function stripImports(code: string): string {
  return code
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("import ") &&
        !trimmed.startsWith("import{") &&
        !(trimmed.startsWith("const ") && trimmed.includes("require("))
      );
    })
    .join("\n");
}

export function createMergeRegistry(): MergeRegistry {
  const registry = new MergeRegistryImpl();

  registry.register({
    name: "copy",
    description: "Simply replaces existing with incoming",
    merge(
      existing: string,
      incoming: string,
      context: MergeContext,
    ): MergeResult {
      return {
        content: incoming,
        changed: existing !== incoming,
        conflicts: [],
        strategy: context.strategy,
      };
    },
  });

  registry.register({
    name: "replace",
    description: "Same as copy (alias)",
    merge(
      existing: string,
      incoming: string,
      context: MergeContext,
    ): MergeResult {
      return {
        content: incoming,
        changed: existing !== incoming,
        conflicts: [],
        strategy: context.strategy,
      };
    },
  });

  registry.register({
    name: "merge",
    description: "Deep JSON merge for .json files",
    merge(
      existing: string,
      incoming: string,
      context: MergeContext,
    ): MergeResult {
      return deepMergeJson(existing, incoming, context);
    },
  });

  registry.register({
    name: "append",
    description: "Appends incoming after existing",
    merge(
      existing: string,
      incoming: string,
      context: MergeContext,
    ): MergeResult {
      const content = existing + incoming;
      return {
        content,
        changed: existing !== content,
        conflicts: [],
        strategy: context.strategy,
      };
    },
  });

  registry.register({
    name: "prepend",
    description: "Prepends incoming before existing",
    merge(
      existing: string,
      incoming: string,
      context: MergeContext,
    ): MergeResult {
      const content = incoming + existing;
      return {
        content,
        changed: existing !== content,
        conflicts: [],
        strategy: context.strategy,
      };
    },
  });

  registry.register({
    name: "patch",
    description: "Line-based patch (only changed lines)",
    merge(
      existing: string,
      incoming: string,
      context: MergeContext,
    ): MergeResult {
      const { added } = lineDiff(existing, incoming);

      if (added.length === 0) {
        return {
          content: existing,
          changed: false,
          conflicts: [],
          strategy: context.strategy,
        };
      }

      const patched = existing + "\n" + added.join("\n");

      return {
        content: patched,
        changed: true,
        conflicts: [],
        strategy: context.strategy,
      };
    },
  });

  registry.register({
    name: "ast",
    description: "AST-based merge for code files",
    merge(
      existing: string,
      incoming: string,
      context: MergeContext,
    ): MergeResult {
      if (existing === incoming) {
        return {
          content: existing,
          changed: false,
          conflicts: [],
          strategy: context.strategy,
        };
      }

      const existingImports = extractImports(existing);
      const incomingImports = extractImports(incoming);

      const mergedImports = [
        ...new Set([...existingImports, ...incomingImports]),
      ];

      const existingBody = stripImports(existing);
      const incomingBody = stripImports(incoming);

      const merged = [...mergedImports, existingBody, incomingBody]
        .filter((l) => l.length > 0)
        .join("\n");

      return {
        content: merged,
        changed: existing !== merged,
        conflicts: [],
        strategy: context.strategy,
      };
    },
  });

  registry.register({
    name: "template",
    description: "Template-based merge using variables from context",
    merge(
      existing: string,
      incoming: string,
      context: MergeContext,
    ): MergeResult {
      let result = incoming;

      for (const [key, value] of Object.entries(context.variables)) {
        const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
        result = result.replace(pattern, value);
      }

      const hasUnresolved = /\{\{\s*\w+\s*\}\}/.test(result);

      return {
        content: result,
        changed: existing !== result,
        conflicts: hasUnresolved
          ? [
              {
                path: context.filePath,
                type: "key",
                existing: "unresolved template variables",
                incoming: result,
                resolution: result,
              },
            ]
          : [],
        strategy: context.strategy,
      };
    },
  });

  return registry;
}
