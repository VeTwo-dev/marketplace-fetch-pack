import type {
  TransformDefinition,
  TransformInput,
  TransformOutput,
  TransformRegistry,
} from "../types/transform.js";

export class TransformRegistryImpl implements TransformRegistry {
  private readonly _transforms = new Map<string, TransformDefinition>();

  register(definition: TransformDefinition): void {
    this._transforms.set(definition.name, definition);
  }

  unregister(name: string): boolean {
    return this._transforms.delete(name);
  }

  get(name: string): TransformDefinition | undefined {
    return this._transforms.get(name);
  }

  getAll(): ReadonlyArray<TransformDefinition> {
    return [...this._transforms.values()];
  }

  async apply(
    content: string,
    path: string,
    transforms: ReadonlyArray<string>,
    variables: Readonly<Record<string, string>>,
  ): Promise<string> {
    let currentContent = content;
    let currentPath = path;
    const metadata: Record<string, unknown> = {};

    const definitions = transforms
      .map((name) => this._transforms.get(name))
      .filter((def): def is TransformDefinition => def !== undefined)
      .sort((a, b) => a.order - b.order);

    for (const definition of definitions) {
      const input: TransformInput = {
        content: currentContent,
        path: currentPath,
        variables,
        metadata,
      };

      const output: TransformOutput = await definition.transform(input);
      currentContent = output.content;
      currentPath = output.path;

      if (output.metadata !== undefined) {
        Object.assign(metadata, output.metadata);
      }
    }

    return currentContent;
  }
}

function deepMergeJson(target: string, source: string): string {
  const targetObj: Record<string, unknown> = JSON.parse(target) as Record<
    string,
    unknown
  >;
  const sourceObj: Record<string, unknown> = JSON.parse(source) as Record<
    string,
    unknown
  >;
  const merged = deepMergeObjects(targetObj, sourceObj);
  return JSON.stringify(merged, null, 2);
}

function deepMergeObjects(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMergeObjects(
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

function envInject(
  content: string,
  variables: Readonly<Record<string, string>>,
): string {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    const patterns = [
      new RegExp(`process\\.env\\.${key}\\b`, "g"),
      new RegExp(`process\\.env\\[["']${key}["']\\]`, "g"),
    ];
    for (const pattern of patterns) {
      result = result.replace(pattern, JSON.stringify(value));
    }
  }
  return result;
}

function importInject(
  content: string,
  importStatements: ReadonlyArray<string>,
): string {
  const lines = content.split("\n");
  const importLines = lines.filter((line) =>
    line.trimStart().startsWith("import "),
  );
  const lastImportIndex = lines.findIndex((line) =>
    line.trimStart().startsWith("import "),
  );

  const insertIndex = lastImportIndex >= 0 ? lastImportIndex + 1 : 0;

  const newImports = importStatements.filter(
    (imp) => !importLines.some((existing) => existing.trim() === imp.trim()),
  );

  if (newImports.length === 0) return content;

  const result = [
    ...lines.slice(0, insertIndex),
    ...newImports,
    ...lines.slice(insertIndex),
  ];

  return result.join("\n");
}

export function createTransformRegistry(): TransformRegistry {
  const registry = new TransformRegistryImpl();

  registry.register({
    name: "package-json-merge",
    description: "Deep merges JSON content",
    target: "content",
    order: 10,
    transform: async (input: TransformInput): Promise<TransformOutput> => {
      const patchRaw = input.variables["package-json-patch"];
      if (patchRaw === undefined || patchRaw === "") {
        return { content: input.content, path: input.path };
      }

      try {
        const merged = deepMergeJson(input.content, patchRaw);
        return { content: merged, path: input.path };
      } catch {
        return { content: input.content, path: input.path };
      }
    },
  });

  registry.register({
    name: "prepend",
    description: "Prepends content",
    target: "content",
    order: 20,
    transform: async (input: TransformInput): Promise<TransformOutput> => {
      const prefix = input.variables["prepend-content"];
      if (prefix === undefined || prefix === "") {
        return { content: input.content, path: input.path };
      }
      return { content: prefix + input.content, path: input.path };
    },
  });

  registry.register({
    name: "append",
    description: "Appends content",
    target: "content",
    order: 30,
    transform: async (input: TransformInput): Promise<TransformOutput> => {
      const suffix = input.variables["append-content"];
      if (suffix === undefined || suffix === "") {
        return { content: input.content, path: input.path };
      }
      return { content: input.content + suffix, path: input.path };
    },
  });

  registry.register({
    name: "env-inject",
    description: "Replaces process.env.X references with variable values",
    target: "content",
    order: 40,
    transform: async (input: TransformInput): Promise<TransformOutput> => {
      const envVars = input.variables;
      const envKeys = Object.keys(envVars).filter((key) =>
        key.startsWith("ENV_"),
      );

      if (envKeys.length === 0) {
        return { content: input.content, path: input.path };
      }

      const injected: Record<string, string> = {};
      for (const key of envKeys) {
        const envName = key.slice(4);
        injected[envName] = envVars[key]!;
      }

      return {
        content: envInject(input.content, injected),
        path: input.path,
      };
    },
  });

  registry.register({
    name: "import-inject",
    description: "Adds import statements if not already present",
    target: "content",
    order: 50,
    transform: async (input: TransformInput): Promise<TransformOutput> => {
      const importsRaw = input.variables["inject-imports"];
      if (importsRaw === undefined || importsRaw === "") {
        return { content: input.content, path: input.path };
      }

      const importStatements = importsRaw
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      return {
        content: importInject(input.content, importStatements),
        path: input.path,
      };
    },
  });

  return registry;
}
