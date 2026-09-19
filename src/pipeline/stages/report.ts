import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import { createLogger, type Logger } from "../../logger/index.js";

export function createReportStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:report" });

  return {
    name: "report",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      log.debug("Generating install report", {
        resourceId: context.resourceId,
        filesWritten: context.files.length,
        errors: context.errors.length,
        warnings: context.warnings.length,
      });

      return {
        ...context,
        metadata: {
          ...context.metadata,
          endTime: Date.now(),
        },
      };
    },
  };
}
