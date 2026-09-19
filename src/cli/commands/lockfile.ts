import type { Marketplace } from "../../marketplace/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runLockfileCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  values: ParsedArgs["values"],
): Promise<void> {
  const action = args[0] ?? "show";
  const lockFileService = marketplace.getLockFileService();

  if (lockFileService === null) {
    process.stderr.write("Lock file service not available.\n");
    process.exit(1);
  }

  await marketplace.load();

  const destination =
    (values["destination"] as string) ?? marketplace.config.destination;

  switch (action) {
    case "show": {
      const lockfile = await lockFileService.read(destination);

      if (lockfile === null) {
        process.stderr.write("No lock file found.\n");
        return;
      }

      process.stdout.write(`\nLock file (v${lockfile.lockfileVersion}):\n`);
      process.stdout.write(`  Generated: ${lockfile.generatedAt}\n`);
      process.stdout.write(`  Resources: ${lockfile.resources.length}\n\n`);

      for (const resource of lockfile.resources) {
        process.stdout.write(`  ${resource.id}@${resource.version}\n`);
        process.stdout.write(`    Resolved: ${resource.resolved}\n`);
        process.stdout.write(`    Installed: ${resource.installedAt}\n`);
        process.stdout.write(`    Source: ${resource.source}\n`);
        if (resource.dependencies.length > 0) {
          process.stdout.write(
            `    Dependencies: ${resource.dependencies.length}\n`,
          );
        }
        process.stdout.write("\n");
      }
      break;
    }
    case "clear": {
      await lockFileService.clear(destination);
      process.stderr.write("Lock file cleared.\n");
      break;
    }
    default:
      process.stderr.write(`Unknown lockfile action: ${action}\n`);
      process.stderr.write("Available actions: show, clear\n");
      process.exit(1);
  }
}
