export interface DependencyNode {
  readonly id: string;
  readonly version: string;
  readonly dependencies: ReadonlyArray<DependencyNode>;
  readonly optional: boolean;
}

export interface DependencyGraph {
  readonly root: string;
  readonly nodes: ReadonlyMap<string, DependencyNode>;
  readonly flat: ReadonlyArray<string>;
  readonly circular: ReadonlyArray<ReadonlyArray<string>>;
  readonly conflicts: ReadonlyArray<DependencyConflict>;
  readonly totalSize: number;
}

export interface ResolvedDependency {
  readonly id: string;
  readonly version: string;
  readonly resolved: boolean;
  readonly optional: boolean;
  readonly path: string;
}

export interface DependencyConflict {
  readonly id: string;
  readonly versions: ReadonlyArray<string>;
  readonly requestedBy: ReadonlyArray<string>;
}

export type InstallAction =
  "install" | "skip" | "update" | "repair" | "conflict";

export interface ResolvedResource {
  readonly id: string;
  readonly version: string;
  readonly requestedVersion?: string;
  readonly action: InstallAction;
  readonly dependencies: ReadonlyArray<string>;
  readonly optional: boolean;
  readonly installedVersion?: string;
  readonly conflict?: DependencyConflict;
}

export interface InstallationPlan {
  readonly root: string;
  readonly resources: ReadonlyMap<string, ResolvedResource>;
  readonly installOrder: ReadonlyArray<string>;
  readonly conflicts: ReadonlyArray<DependencyConflict>;
  readonly skipped: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly totalResources: number;
  readonly dryRun: boolean;
}

export interface PlanOptions {
  readonly installed?: ReadonlySet<string>;
  readonly installedVersions?: ReadonlyMap<string, string>;
  readonly skipOptional?: boolean;
  readonly dryRun?: boolean;
  readonly nodeVersion?: string;
  readonly frameworks?: ReadonlyArray<string>;
  readonly platform?: string;
}

interface ImpactAnalysis {
  readonly resourceId: string;
  readonly newVersion: string;
  readonly directDependents: ReadonlyArray<string>;
  readonly transitiveDependents: ReadonlyArray<string>;
  readonly potentiallyBroken: ReadonlyArray<{ id: string; reason: string }>;
  readonly impactSeverity: "safe" | "breaking";
}

interface DependencyTypeDefinition {
  readonly type: "required" | "optional" | "peer" | "development";
  readonly versionRange: string;
  readonly optional: boolean;
  readonly constraints: ReadonlyArray<string>;
}
