import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import { createLogger, type Logger } from "../../logger/index.js";

export function createDependencyStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:dependency" });

  return {
    name: "dependency",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      if (context.options.skipDependencies) return context;

      log.debug("Resolving dependencies", { resourceId: context.resourceId });

      const plan = context.dependencyPlan;
      if (!plan) {
        log.debug("No dependency plan available");
        return context;
      }

      log.info("Dependency plan summary", {
        totalResources: plan.totalResources,
        conflicts: plan.conflicts.length,
        skipped: plan.skipped.length,
        installOrder: plan.installOrder.length,
      });

      if (plan.conflicts.length > 0) {
        for (const conflict of plan.conflicts) {
          context.warnings.push(
            `Dependency conflict for ${conflict.id}: versions ${conflict.versions.join(", ")} requested by ${conflict.requestedBy.join(", ")}`,
          );
        }
      }

      return {
        ...context,
        metadata: {
          ...context.metadata,
          dependencyPlan: {
            totalResources: plan.totalResources,
            conflicts: plan.conflicts.length,
            skipped: plan.skipped.length,
          },
        },
      };
    },
  };
}
