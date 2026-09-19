import type { Marketplace } from "../../marketplace/index.js";
import { CLI_NAME } from "../constants.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runPreviewCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  _values: ParsedArgs["values"],
): Promise<void> {
  const id = args[0];

  if (id === undefined || id === "") {
    process.stderr.write(`Usage: ${CLI_NAME} preview <id>\n`);
    process.exit(1);
  }

  process.stderr.write(`Previewing ${id}...\n`);

  try {
    const result = await marketplace.preview(id);

    process.stdout.write(`\n  Dry Run Result for ${id}:\n\n`);
    process.stdout.write(`  Files to install: ${result.wouldInstall.length}\n`);
    process.stdout.write(
      `  Estimated size:   ${formatSize(result.estimatedSize)}\n`,
    );

    if (result.wouldInstall.length > 0) {
      process.stdout.write(`\n  Files:\n`);
      for (const file of result.wouldInstall) {
        const size = file.size > 0 ? ` (${formatSize(file.size)})` : "";
        process.stdout.write(`    ${file.path}${size}\n`);
      }
    }

    if (result.conflicts.length > 0) {
      process.stdout.write(`\n  Conflicts:\n`);
      for (const conflict of result.conflicts) {
        process.stdout.write(
          `    ${conflict.path}: existing ${conflict.existingSize ?? "unknown"} -> new ${conflict.newSize}\n`,
        );
      }
    }
  } catch (error) {
    process.stderr.write(
      `\nPreview failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  process.stdout.write("\n");
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
