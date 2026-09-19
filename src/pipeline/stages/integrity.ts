import type {
  PipelineStage,
  PipelineContext,
  PipelineError,
} from "../../types/pipeline.js";
import { sha256 } from "../../utils/index.js";
import { createLogger, type Logger } from "../../logger/index.js";

export function createIntegrityStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:integrity" });

  return {
    name: "integrity",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      if (context.options.skipValidation) return context;

      log.debug("Verifying file integrity", {
        fileCount: context.files.length,
      });

      const errors: Array<PipelineError> = [];
      let verified = 0;
      let skipped = 0;

      for (const file of context.files) {
        if (file.sha === "") {
          if (file.relativePath !== "resource.json") {
            context.warnings.push(`Missing SHA for file: ${file.relativePath}`);
          }
          skipped++;
          continue;
        }

        const computed = sha256(file.content);
        if (computed !== file.sha) {
          errors.push({
            stage: "integrity",
            message: `SHA-256 mismatch for ${file.relativePath}: expected ${file.sha}, got ${computed}`,
            recoverable: false,
          });
        } else {
          verified++;
        }
      }

      log.info("Integrity check complete", {
        verified,
        skipped,
        failed: errors.length,
      });

      return {
        ...context,
        errors: [...context.errors, ...errors],
        metadata: {
          ...context.metadata,
          integrityCheck: {
            verified,
            skipped,
            failed: errors.length,
          },
        },
      };
    },
  };
}
