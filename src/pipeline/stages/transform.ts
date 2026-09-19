import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import type { TransformRegistry } from "../../types/transform.js";
import type { ResourceTypeRegistry } from "../../resource-types/index.js";
import { createLogger, type Logger } from "../../logger/index.js";
import { sha256 } from "../../utils/index.js";

export interface TransformStageDeps {
  /** Registry of transform implementations */
  readonly transformRegistry?: TransformRegistry;
  /** Registry used to resolve the resource type's declared transformNames */
  readonly typeRegistry?: ResourceTypeRegistry;
}

/**
 * Transform stage.
 *
 * When a transform registry AND a resource type registry are provided and
 * the context carries a registered resourceType, the stage applies exactly
 * the transforms declared by that resource type (transformNames) through
 * the shared TransformRegistry — never bypassing pipeline safety.
 * Without registries or an unknown type, it is a no-op.
 */
export function createTransformStage(
  logger?: Logger,
  deps?: TransformStageDeps,
): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:transform" });

  return {
    name: "transform",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      if (context.options.skipTransforms) return context;

      const registry = deps?.transformRegistry;
      const typeRegistry = deps?.typeRegistry;

      if (
        registry === undefined ||
        typeRegistry === undefined ||
        context.resourceType === undefined
      ) {
        log.debug("Applying transforms", { fileCount: context.files.length });
        return context;
      }

      const registration = typeRegistry.get(context.resourceType);
      if (registration === undefined) {
        log.debug("Unknown resource type — no transforms applied", {
          resourceType: context.resourceType,
        });
        return context;
      }

      const declared = registration.type.transformNames;
      if (declared === undefined || declared.length === 0) {
        log.debug("Resource type declares no transforms", {
          resourceType: context.resourceType,
        });
        return context;
      }

      // Only apply transforms that actually exist in the registry
      const applicable = declared.filter(
        (name) => registry.get(name) !== undefined,
      );
      if (applicable.length === 0) {
        return context;
      }

      log.debug("Applying resource-type transforms", {
        resourceType: context.resourceType,
        transforms: applicable,
        fileCount: context.files.length,
      });

      const files = await Promise.all(
        context.files.map(async (file) => {
          let content = file.content;
          for (const name of applicable) {
            content = await registry.apply(
              content,
              file.relativePath,
              [name],
              context.variables,
            );
          }
          if (content === file.content) return file;
          return {
            ...file,
            content,
            sha: sha256(content),
            size: Buffer.byteLength(content),
          };
        }),
      );

      return { ...context, files };
    },
  };
}
