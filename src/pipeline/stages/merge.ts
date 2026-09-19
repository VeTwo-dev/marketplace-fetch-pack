import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import type { ResourceTypeRegistry } from "../../resource-types/index.js";
import { createLogger, type Logger } from "../../logger/index.js";

export interface MergeStageDeps {
  /** Registry used to resolve the resource type's declared mergeStrategies */
  readonly typeRegistry?: ResourceTypeRegistry;
}

/**
 * Merge stage.
 *
 * Resolves per-file merge actions. When a type registry is provided and
 * the context carries a registered resourceType, only merge strategies
 * declared by that resource type are honored — undeclared strategies fall
 * back to a safe overwrite ("copy") instead of executing undefined behavior.
 */
export function createMergeStage(
  logger?: Logger,
  deps?: MergeStageDeps,
): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:merge" });

  return {
    name: "merge",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      if (context.options.skipMerge) return context;

      let declaredStrategies: ReadonlyArray<string> | null = null;
      if (
        deps?.typeRegistry !== undefined &&
        context.resourceType !== undefined
      ) {
        const registration = deps.typeRegistry.get(context.resourceType);
        if (registration !== undefined) {
          declaredStrategies = registration.type.mergeStrategies;
        }
      }

      log.debug("Merging files", { fileCount: context.files.length });

      const files = context.files.map((file) => {
        if (file.action !== "merge") return file;

        let strategy = file.mergeStrategy ?? "copy";

        // Enforce per-type policy: undeclared strategies are not executed.
        if (
          declaredStrategies !== null &&
          declaredStrategies.length > 0 &&
          !declaredStrategies.includes(strategy)
        ) {
          log.warn(
            `Merge strategy "${strategy}" not declared by resource type "${context.resourceType}" — falling back to copy`,
            { path: file.relativePath },
          );
          strategy = "copy";
        }

        log.debug("Applying merge strategy", {
          path: file.relativePath,
          strategy,
        });

        switch (strategy) {
          case "append":
          case "prepend":
          case "merge":
          case "patch":
            return file;
          case "replace":
          case "copy":
          default:
            return { ...file, action: "overwrite" as const };
        }
      });

      return { ...context, files };
    },
  };
}
