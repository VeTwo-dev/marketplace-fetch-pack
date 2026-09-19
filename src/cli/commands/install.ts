import type { Marketplace } from "../../marketplace/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};
import { MarketplaceClientError } from "../../errors/index.js";
import { CLI_NAME } from "../constants.js";

export async function runInstallCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  values: ParsedArgs["values"],
): Promise<void> {
  const id = args[0];

  if (id === undefined || id === "") {
    process.stderr.write(
      `Usage: ${CLI_NAME} install <id> [--version <version>] [--destination <path>] [--force] [--dry-run]\n`,
    );
    process.exit(1);
  }

  const options = {
    id,
    version: values["version"] as string | undefined,
    destination: values["destination"] as string | undefined,
    force: values["force"] as boolean,
    dryRun: values["dry-run"] as boolean,
  };

  if (options.dryRun) {
    process.stderr.write(`Previewing installation of ${id}...\n`);
  } else {
    process.stderr.write(`Installing ${id}...\n`);
  }

  try {
    const result = await marketplace.install(options);

    if (result.dryRun) {
      process.stderr.write("\nDry run result:\n");
      process.stdout.write(
        `  Would install ${result.report.files.length} file(s)\n`,
      );
      process.stdout.write(`  Destination: ${result.destination}\n`);
      process.stdout.write(`  Duration: ${result.duration}ms\n`);
      return;
    }

    process.stderr.write(
      `\nSuccessfully installed ${result.id}@${result.version}\n`,
    );
    process.stdout.write(`  Files installed:    ${result.filesInstalled}\n`);
    process.stdout.write(
      `  Dependencies:       ${result.dependenciesInstalled}\n`,
    );
    process.stdout.write(`  Destination:        ${result.destination}\n`);
    process.stdout.write(`  Duration:           ${result.duration}ms\n`);

    if (result.report.warnings.length > 0) {
      process.stderr.write("\n  Warnings:\n");
      for (const warning of result.report.warnings) {
        process.stderr.write(`    - ${warning}\n`);
      }
    }

    if (!result.report.integrity.verified) {
      process.stderr.write("\n  Note: Integrity check was not performed\n");
    }
  } catch (error) {
    if (error instanceof MarketplaceClientError) {
      process.stderr.write(`\n${error.toString()}\n`);
    } else {
      process.stderr.write(
        `\nInstall failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    process.exit(1);
  }
}
