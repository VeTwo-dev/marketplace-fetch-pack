export interface VariableDefinition {
  readonly name: string;
  readonly type: VariableType;
  readonly description: string;
  readonly defaultValue?: string;
  readonly required: boolean;
  readonly validation?: VariableValidation;
}

export type VariableType = "string" | "number" | "boolean" | "choice" | "path";

export interface VariableValidation {
  readonly pattern?: string;
  readonly min?: number;
  readonly max?: number;
  readonly choices?: ReadonlyArray<string>;
  readonly custom?: (value: string) => boolean;
}

export interface VariableSet {
  readonly variables: ReadonlyArray<VariableDefinition>;
  readonly values: Readonly<Record<string, string>>;
}

export interface VariableResolver {
  resolve(content: string, values: Readonly<Record<string, string>>): string;
  extractVariables(content: string): ReadonlyArray<string>;
  validate(
    values: Readonly<Record<string, string>>,
    definitions: ReadonlyArray<VariableDefinition>,
  ): ReadonlyArray<VariableError>;
}

export interface VariableError {
  readonly name: string;
  readonly message: string;
  readonly type: "missing" | "invalid" | "type_mismatch";
}
