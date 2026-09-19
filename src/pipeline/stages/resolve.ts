import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import type { RegistryResource } from "../../types/registry.js";
import { createLogger, type Logger } from "../../logger/index.js";

export function createResolveStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:resolve" });

  return {
    name: "resolve",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      log.debug("Resolving resource", { resourceId: context.resourceId });

      const manifest = context.manifest as RegistryResource;
      if (manifest === undefined || manifest === null) {
        throw new Error(`Resource manifest not found: ${context.resourceId}`);
      }

      if (typeof manifest !== "object" || !("id" in manifest)) {
        throw new Error(`Invalid manifest for resource: ${context.resourceId}`);
      }

      return {
        ...context,
        metadata: {
          ...context.metadata,
          filesProcessed: context.metadata.filesProcessed + 1,
        },
      };
    },
  };
}
