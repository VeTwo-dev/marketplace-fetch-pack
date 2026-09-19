import type { Marketplace } from "../../marketplace/index.js";
import { CLI_NAME } from "../constants.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runCacheCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  _values: ParsedArgs["values"],
): Promise<void> {
  const action = args[0] ?? "stats";

  switch (action) {
    case "clear": {
      process.stderr.write("Clearing cache...\n");
      await marketplace.cacheClear();
      process.stderr.write("Cache cleared.\n");
      break;
    }
    case "stats": {
      const stats = await marketplace.cacheStats();
      process.stdout.write(`\n  Cache Statistics:\n\n`);
      process.stdout.write(`  Entries:         ${stats.entries}\n`);
      process.stdout.write(
        `  Total size:      ${formatSize(stats.totalSize)}\n`,
      );
      process.stdout.write(
        `  Hit rate:        ${(stats.hitRate * 100).toFixed(1)}%\n`,
      );
      process.stdout.write(
        `  Registry:        ${stats.registryEntries} entries\n`,
      );
      process.stdout.write(
        `  Manifests:       ${stats.manifestEntries} entries\n`,
      );
      process.stdout.write(
        `  Downloads:       ${stats.downloadEntries} entries\n`,
      );
      if (stats.oldestEntry !== null) {
        process.stdout.write(`  Oldest entry:    ${stats.oldestEntry}\n`);
      }
      if (stats.newestEntry !== null) {
        process.stdout.write(`  Newest entry:    ${stats.newestEntry}\n`);
      }
      process.stdout.write("\n");
      break;
    }
    default:
      process.stderr.write(`Unknown cache action: ${action}\n`);
      process.stderr.write(`Usage: ${CLI_NAME} cache [clear|stats]\n`);
      process.exit(1);
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
