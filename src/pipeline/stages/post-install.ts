import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import { createLogger, type Logger } from "../../logger/index.js";

export function createPostInstallStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:post-install" });

  return {
    name: "post-install",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      log.info("Installation complete", {
        resourceId: context.resourceId,
        fileCount: context.files.length,
        errorCount: context.errors.length,
        warningCount: context.warnings.length,
      });

      if (context.errors.length > 0) {
        for (const error of context.errors) {
          log.warn(`${error.stage}: ${error.message}`);
        }
      }

      return context;
    },
  };
}
