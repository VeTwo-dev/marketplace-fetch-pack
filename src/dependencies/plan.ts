import type { InstallationPlan, PlanOptions } from "../types/dependencies.js";
import { DependencyResolver } from "./index.js";
import { VersionResolver } from "../versions/index.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";

export class InstallationPlanBuilder {
  private readonly _depResolver: DependencyResolver;
  private readonly _versionResolver: VersionResolver;
  private readonly _logger: Logger;

  constructor(
    depResolver: DependencyResolver,
    versionResolver: VersionResolver,
    logger?: Logger,
  ) {
    this._depResolver = depResolver;
    this._versionResolver = versionResolver;
    this._logger = logger ?? createLogger({ prefix: "plan-builder" });
  }

  async buildPlan(
    resourceId: string,
    options?: PlanOptions,
  ): Promise<InstallationPlan> {
    const resource = this._depResolver.getResource(resourceId);
    if (resource === undefined) {
      throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
        message: `Resource not found: ${resourceId}`,
        context: { resourceId },
      });
    }

    return this._depResolver.resolvePlan(resourceId, options);
  }

  async buildMultiPlan(
    resourceIds: ReadonlyArray<string>,
    options?: PlanOptions,
  ): Promise<InstallationPlan> {
    if (resourceIds.length === 0) {
      throw new MarketplaceClientError("RESOURCE_INVALID", {
        message: "No resource IDs provided",
      });
    }

    const firstId = resourceIds[0]!;

    if (resourceIds.length === 1) {
      return this.buildPlan(firstId, options);
    }

    const allResources = new Map<
      string,
      import("../types/dependencies.js").ResolvedResource
    >();
    const allConflicts: Array<
      import("../types/dependencies.js").DependencyConflict
    > = [];
    const allSkipped: Array<string> = [];
    const allWarnings: Array<string> = [];
    const installOrderSet = new Set<string>();
    const installOrder: Array<string> = [];

    for (const id of resourceIds) {
      const plan = await this.buildPlan(id, options);

      for (const [rid, resource] of plan.resources) {
        if (!allResources.has(rid)) {
          allResources.set(rid, resource);
        }
      }

      for (const conflict of plan.conflicts) {
        if (!allConflicts.some((c) => c.id === conflict.id)) {
          allConflicts.push(conflict);
        }
      }

      for (const skipped of plan.skipped) {
        if (!allSkipped.includes(skipped)) {
          allSkipped.push(skipped);
        }
      }

      for (const warning of plan.warnings) {
        if (!allWarnings.includes(warning)) {
          allWarnings.push(warning);
        }
      }

      for (const nodeId of plan.installOrder) {
        if (!installOrderSet.has(nodeId)) {
          installOrderSet.add(nodeId);
          installOrder.push(nodeId);
        }
      }
    }

    const orderedInstall = this._topologicalSort(allResources, installOrder);

    return {
      root: firstId,
      resources: allResources,
      installOrder: orderedInstall,
      conflicts: allConflicts,
      skipped: allSkipped,
      warnings: allWarnings,
      totalResources: allResources.size,
      dryRun: options?.dryRun ?? false,
    };
  }

  private _topologicalSort(
    resources: Map<string, import("../types/dependencies.js").ResolvedResource>,
    hint: ReadonlyArray<string>,
  ): ReadonlyArray<string> {
    const visited = new Set<string>();
    const order: Array<string> = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const resource = resources.get(id);
      if (resource !== undefined) {
        for (const depId of resource.dependencies) {
          if (resources.has(depId)) {
            visit(depId);
          }
        }
      }

      order.push(id);
    };

    for (const id of hint) {
      visit(id);
    }

    for (const id of resources.keys()) {
      visit(id);
    }

    return order;
  }
}
