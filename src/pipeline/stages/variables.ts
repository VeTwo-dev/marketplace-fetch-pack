import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import { createVariableResolver } from "../../variables/index.js";
import { createLogger, type Logger } from "../../logger/index.js";

export function createVariablesStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:variables" });

  return {
    name: "variables",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      if (context.options.skipTransforms) return context;

      const variableCount = Object.keys(context.variables).length;
      if (variableCount === 0) return context;

      log.debug("Resolving variables", { variableCount });

      const resolver = createVariableResolver();
      const updatedFiles = context.files.map((file) => {
        const resolved = resolver.resolve(file.content, context.variables);
        return {
          ...file,
          content: resolved,
          sha: "",
          size: Buffer.byteLength(resolved),
        };
      });

      return {
        ...context,
        files: updatedFiles,
      };
    },
  };
}
