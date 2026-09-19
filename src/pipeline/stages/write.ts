import type { PipelineStage, PipelineContext } from "../../types/pipeline.js";
import { mkdir, writeFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type Logger } from "../../logger/index.js";

const writtenFiles = new WeakMap<PipelineContext, Array<string>>();

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function createWriteStage(logger?: Logger): PipelineStage {
  const log = logger ?? createLogger({ prefix: "stage:write" });

  return {
    name: "write",
    async execute(context: PipelineContext): Promise<PipelineContext> {
      log.debug("Writing files to disk", {
        destination: context.destination,
        fileCount: context.files.length,
      });

      const resourceDir = join(context.destination, context.resourceId);
      await mkdir(resourceDir, { recursive: true });

      let bytesWritten = 0;
      const written: Array<string> = [];

      for (const file of context.files) {
        if (file.action === "skip") continue;

        const destPath = join(resourceDir, file.relativePath);
        const destDir = destPath.substring(0, destPath.lastIndexOf("/"));

        await mkdir(destDir, { recursive: true });

        if (file.action === "merge" && (await fileExists(destPath))) {
          const { readFile } = await import("node:fs/promises");
          await readFile(destPath, "utf-8");
          log.debug("File exists, merge strategy", {
            path: file.relativePath,
            strategy: file.mergeStrategy ?? "copy",
          });
          await writeFile(destPath, file.content, "utf-8");
        } else {
          await writeFile(destPath, file.content, "utf-8");
        }

        written.push(destPath);
        bytesWritten += Buffer.byteLength(file.content);
      }

      writtenFiles.set(context, written);

      log.info("Files written", {
        count: written.length,
        bytesWritten,
      });

      return {
        ...context,
        metadata: {
          ...context.metadata,
          bytesWritten: context.metadata.bytesWritten + bytesWritten,
        },
      };
    },

    async rollback(context: PipelineContext): Promise<PipelineContext> {
      log.debug("Rolling back written files", {
        resourceId: context.resourceId,
      });

      const files = writtenFiles.get(context);
      if (files) {
        for (const filePath of files) {
          try {
            await rm(filePath, { force: true });
            log.debug("Removed file", { path: filePath });
          } catch {
            log.debug("Failed to remove file during rollback", {
              path: filePath,
            });
          }
        }
        writtenFiles.delete(context);
      }

      return context;
    },
  };
}
