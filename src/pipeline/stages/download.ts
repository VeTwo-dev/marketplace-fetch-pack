import type {
  PipelineStage,
  PipelineContext,
  PipelineFile,
} from "../../types/pipeline.js";
import type { RegistryResource } from "../../types/registry.js";
import { createHash } from "node:crypto";
import { createLogger, type Logger } from "../../logger/index.js";

export function createDownloadStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:download" });

  return {
    name: "download",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      log.debug("Preparing resource files", {
        resourceId: context.resourceId,
      });

      const files: Array<PipelineFile> = [...context.files];

      if (files.length === 0) {
        const manifest = context.manifest as RegistryResource;
        const manifestContent = JSON.stringify(
          {
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            category: manifest.category,
            tags: manifest.tags,
            author: manifest.author,
            dependencies: manifest.dependencies,
          },
          null,
          2,
        );

        files.push({
          sourcePath: manifest.manifestPath,
          relativePath: "resource.json",
          content: manifestContent,
          sha: createHash("sha256").update(manifestContent).digest("hex"),
          size: Buffer.byteLength(manifestContent),
          action: "create",
        });

        log.debug("Created resource.json metadata entry", {
          path: manifest.manifestPath,
        });
      }

      log.info("Files prepared", { count: files.length });

      return {
        ...context,
        files,
        metadata: {
          ...context.metadata,
          filesProcessed: files.length,
        },
      };
    },
  };
}
