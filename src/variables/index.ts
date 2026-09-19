import type {
  VariableDefinition,
  VariableError,
  VariableResolver,
  VariableValidation,
} from "../types/variables.js";

const VARIABLE_PATTERN = /\{\{(\s*[\w.]+\s*)\}\}/g;

export function resolve(
  content: string,
  values: Readonly<Record<string, string>>,
): string {
  return content.replace(VARIABLE_PATTERN, (_match, raw: string) => {
    const name = raw.trim();
    return name in values ? values[name]! : _match;
  });
}

export function extractVariables(content: string): ReadonlyArray<string> {
  const seen = new Set<string>();
  const results: Array<string> = [];

  let match = VARIABLE_PATTERN.exec(content);
  while (match !== null) {
    const name = match[1]!.trim();
    if (!seen.has(name)) {
      seen.add(name);
      results.push(name);
    }
    match = VARIABLE_PATTERN.exec(content);
  }

  return results;
}

function checkType(value: string, def: VariableDefinition): boolean {
  switch (def.type) {
    case "boolean":
      return value === "true" || value === "false";
    case "number":
      return !Number.isNaN(Number(value));
    case "choice":
      return (
        def.validation?.choices !== undefined &&
        def.validation.choices.includes(value)
      );
    default:
      return true;
  }
}

function validateOne(
  value: string,
  validation: VariableValidation,
): string | undefined {
  if (validation.pattern !== undefined) {
    const regex = new RegExp(validation.pattern);
    if (!regex.test(value)) {
      return `Value does not match pattern: ${validation.pattern}`;
    }
  }
  if (validation.min !== undefined && Number(value) < validation.min) {
    return `Value is below minimum: ${validation.min}`;
  }
  if (validation.max !== undefined && Number(value) > validation.max) {
    return `Value exceeds maximum: ${validation.max}`;
  }
  if (validation.choices !== undefined && !validation.choices.includes(value)) {
    return `Value must be one of: ${validation.choices.join(", ")}`;
  }
  if (validation.custom !== undefined && !validation.custom(value)) {
    return "Value failed custom validation";
  }
  return undefined;
}

export function validate(
  values: Readonly<Record<string, string>>,
  definitions: ReadonlyArray<VariableDefinition>,
): ReadonlyArray<VariableError> {
  const errors: Array<VariableError> = [];

  for (const def of definitions) {
    const value = values[def.name];

    if (value === undefined || value === "") {
      if (def.required) {
        errors.push({
          name: def.name,
          message: `Required variable missing: ${def.name}`,
          type: "missing",
        });
      }
      continue;
    }

    if (!checkType(value, def)) {
      errors.push({
        name: def.name,
        message: `Type mismatch for "${def.name}": expected ${def.type}`,
        type: "type_mismatch",
      });
      continue;
    }

    if (def.validation !== undefined) {
      const msg = validateOne(value, def.validation);
      if (msg !== undefined) {
        errors.push({ name: def.name, message: msg, type: "invalid" });
      }
    }
  }

  return errors;
}

export function createVariableResolver(): VariableResolver {
  return { resolve, extractVariables, validate };
}
