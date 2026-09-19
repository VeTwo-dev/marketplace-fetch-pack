export type VersionRange = string;

export interface VersionSpec {
  readonly raw: string;
  readonly operator: VersionOperator;
  readonly version: string;
}

export type VersionOperator =
  "exact" | "gte" | "lte" | "gt" | "lt" | "range" | "caret" | "tilde" | "any";

export interface ResolvedVersion {
  readonly requested: VersionRange;
  readonly resolved: string;
  readonly satisfies: boolean;
}

export interface CompatibilityResult {
  readonly compatible: boolean;
  readonly resource: string;
  readonly resourceVersion: string;
  readonly nodeVersion: string;
  readonly platforms: ReadonlyArray<string>;
  readonly frameworks: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<CompatibilityIssue>;
}

export interface CompatibilityIssue {
  readonly type: "node" | "platform" | "framework";
  readonly expected: string;
  readonly actual: string;
  readonly severity: "error" | "warning";
}
