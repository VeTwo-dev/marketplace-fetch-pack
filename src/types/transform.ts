export interface TransformDefinition {
  readonly name: string;
  readonly description: string;
  readonly target: TransformTarget;
  readonly order: number;
  readonly transform: TransformFunction;
}

export type TransformTarget = "content" | "filename" | "path" | "metadata";
export type TransformFunction = (
  input: TransformInput,
) => Promise<TransformOutput>;

export interface TransformInput {
  readonly content: string;
  readonly path: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface TransformOutput {
  readonly content: string;
  readonly path: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TransformRegistry {
  register(definition: TransformDefinition): void;
  unregister(name: string): boolean;
  get(name: string): TransformDefinition | undefined;
  getAll(): ReadonlyArray<TransformDefinition>;
  apply(
    content: string,
    path: string,
    transforms: ReadonlyArray<string>,
    variables: Readonly<Record<string, string>>,
  ): Promise<string>;
}

export interface TransformResult {
  readonly original: string;
  readonly transformed: string;
  readonly path: string;
  readonly transformsApplied: ReadonlyArray<string>;
  readonly duration: number;
}

export type TransformHook = (
  input: TransformInput,
) => Promise<TransformInput | null>;
