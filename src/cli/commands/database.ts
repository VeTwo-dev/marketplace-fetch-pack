import type { Marketplace } from "../../marketplace/index.js";
import { resolveStatePaths } from "../../state/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runDatabaseCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  values: ParsedArgs["values"],
): Promise<void> {
  const action = args[0] ?? "list";
  const database = marketplace.getDatabase();

  if (database === null) {
    process.stderr.write("Database service not available.\n");
    process.exit(1);
  }

  await marketplace.load();

  const destination =
    (values["destination"] as string) ?? marketplace.config.destination;
  const statePaths = resolveStatePaths(destination);
  await database.initialize(statePaths.database);

  switch (action) {
    case "list": {
      const entries = await database.getAllEntries();

      if (entries.length === 0) {
        process.stderr.write("No database entries found.\n");
        return;
      }

      process.stdout.write(`\nDatabase entries (${entries.length}):\n\n`);
      for (const entry of entries) {
        process.stdout.write(`  ${entry.resourceId}@${entry.version}\n`);
        process.stdout.write(`    Status: ${entry.status}\n`);
        process.stdout.write(`    Installed: ${entry.installedAt}\n`);
        process.stdout.write(`    Destination: ${entry.destination}\n`);
        process.stdout.write(`    Files: ${entry.files.length}\n\n`);
      }
      break;
    }
    case "history": {
      const resourceId = args[1] as string | undefined;
      const limitStr = values["limit"] as string | undefined;
      const limit = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;

      const history = await database.getHistory(resourceId, limit);

      if (history.length === 0) {
        process.stderr.write("No history found.\n");
        return;
      }

      process.stdout.write(`\nHistory (${history.length} entries):\n\n`);
      for (const entry of history) {
        process.stdout.write(
          `  [${entry.timestamp}] ${entry.action} ${entry.resourceId}@${entry.version}\n`,
        );
        process.stdout.write(`    Success: ${entry.success}\n`);
        if (entry.details !== undefined) {
          process.stdout.write(`    Details: ${entry.details}\n`);
        }
        process.stdout.write("\n");
      }
      break;
    }
    case "clear-history": {
      await database.clearHistory();
      process.stderr.write("History cleared.\n");
      break;
    }
    default:
      process.stderr.write(`Unknown database action: ${action}\n`);
      process.stderr.write("Available actions: list, history, clear-history\n");
      process.exit(1);
  }
}
