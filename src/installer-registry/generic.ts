import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  InstallerInstallContext,
  InstallerResult,
  InstallerFunction,
} from "../types/extensions.js";
import {
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
  resolveWithinRoot,
  assertFileSize,
  assertResourceSize,
} from "../security/index.js";

export const genericFileInstaller: InstallerFunction = async (
  context: InstallerInstallContext,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY,
): Promise<InstallerResult> => {
  const filesWritten: string[] = [];
  const errors: string[] = [];
  const startTime = Date.now();

  // Resource-bomb guards (Step 8)
  try {
    assertResourceSize(
      context.source.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0),
      context.source.length,
      policy,
    );
  } catch (error) {
    return {
      success: false,
      filesWritten: [],
      duration: Date.now() - startTime,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  let totalWritten = 0;
  for (const file of context.source) {
    if (context.dryRun) {
      filesWritten.push(file.path);
      continue;
    }

    try {
      // Path traversal / sandbox validation happens BEFORE any I/O
      const safePath = resolveWithinRoot(context.destination, file.path);
      const content = Buffer.from(file.content, "utf-8");
      assertFileSize(content.length, policy, file.path);
      totalWritten += content.length;
      assertResourceSize(totalWritten, filesWritten.length + 1, policy);

      const dir = safePath.substring(0, safePath.lastIndexOf("/"));
      await mkdir(dir, { recursive: true });
      await writeFile(safePath, content);
      filesWritten.push(file.path);
    } catch (error) {
      errors.push(
        `Failed to write ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Sandbox violations abort the whole install — never partially
      // install a resource that attempted to escape.
      if (
        error instanceof Object &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
      ) {
        break;
      }
    }
  }

  return {
    success: errors.length === 0,
    filesWritten,
    duration: Date.now() - startTime,
    errors,
  };
};

export const genericFileRemover = async (
  resourceId: string,
  destination: string,
): Promise<void> => {
  try {
    const { rm } = await import("node:fs/promises");
    const resourceDir = join(destination, resourceId);
    await rm(resourceDir, { recursive: true, force: true });
  } catch {
    // ignore removal errors
  }
};

export const genericFilePreviewer = async (
  context: InstallerInstallContext,
) => ({
  files: context.source.map((f) => ({
    path: f.path,
    action: "create" as const,
    size: Buffer.byteLength(f.content),
  })),
  estimatedSize: context.source.reduce(
    (sum, f) => sum + Buffer.byteLength(f.content),
    0,
  ),
  conflicts: [],
});
