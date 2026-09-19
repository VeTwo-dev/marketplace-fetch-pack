export interface MergeStrategy {
  readonly name: MergeStrategyName;
  readonly description: string;
  merge(existing: string, incoming: string, context: MergeContext): MergeResult;
}

export type MergeStrategyName =
  | "copy"
  | "replace"
  | "merge"
  | "append"
  | "prepend"
  | "patch"
  | "ast"
  | "template";

export interface MergeContext {
  readonly filePath: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly strategy: MergeStrategyName;
  readonly options: MergeOptions;
}

export interface MergeOptions {
  readonly deep: boolean;
  readonly arrays: "replace" | "append" | "prepend" | "merge";
  readonly conflictResolution: "incoming" | "existing" | "manual";
  readonly preserveComments: boolean;
}

export interface MergeResult {
  readonly content: string;
  readonly changed: boolean;
  readonly conflicts: ReadonlyArray<MergeConflict>;
  readonly strategy: MergeStrategyName;
}

export interface MergeConflict {
  readonly path: string;
  readonly type: "key" | "array" | "structure";
  readonly existing: string;
  readonly incoming: string;
  readonly resolution: string;
}

export interface MergeRegistry {
  register(strategy: MergeStrategy): void;
  unregister(name: MergeStrategyName): boolean;
  get(name: MergeStrategyName): MergeStrategy | undefined;
  getAll(): ReadonlyArray<MergeStrategy>;
  apply(
    existing: string,
    incoming: string,
    strategy: MergeStrategyName,
    context: MergeContext,
  ): MergeResult;
}

export interface MergeManifest {
  readonly file: string;
  readonly strategy: MergeStrategyName;
  readonly options?: Partial<MergeOptions>;
}
