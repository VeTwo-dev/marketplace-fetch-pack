import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import type { RegistryResource } from "../../types/registry.js";
import { createLogger, type Logger } from "../../logger/index.js";

export function createCompatibilityStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:compatibility" });

  return {
    name: "compatibility",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      if (context.options.skipValidation) return context;

      log.debug("Checking compatibility", { resourceId: context.resourceId });

      const manifest = context.manifest as RegistryResource;
      if (manifest?.compatibility !== undefined) {
        const compat = manifest.compatibility;

        if (compat.node !== undefined) {
          const nodeVersion = process.version.replace(/^v/, "");
          const satisfies = _versionSatisfies(nodeVersion, compat.node);
          if (!satisfies) {
            context.warnings.push(
              `Node version ${nodeVersion} may not be compatible (requires ${compat.node})`,
            );
          }
        }
      }

      return context;
    },
  };
}

function _versionSatisfies(actual: string, range: string): boolean {
  const clean = range.replace(/^[~^>=<]+/, "");
  return actual.startsWith(clean.split(".")[0] ?? "");
}
