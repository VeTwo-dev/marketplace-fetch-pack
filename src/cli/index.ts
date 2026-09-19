import { parseArgs } from "node:util";
import { Marketplace } from "../marketplace/index.js";
import { createLogger } from "../logger/index.js";
import { CLI_NAME } from "./constants.js";
import { getInvokedCliName, isLegacyInvocation } from "./names.js";

const VERSION = "1.0.0";

const HELP_TEXT = `
@vetwo/marketplace v${VERSION}

Usage:
  ${CLI_NAME} [command] [options]

Commands:
  search [query]          Search for resources
  info <id>               Show resource details
  install <id>            Install a resource
  preview <id>            Preview what would be installed
  cache [action]          Cache management (clear, stats)
  doctor                  Run diagnostics
  update                  Update the registry cache
  remove <id>             Remove an installed resource
  list                    List installed resources
  categories              Show all categories
  tags                    Show all tags
  dependencies <id>       Show resource dependencies
  wizard                  Launch interactive wizard
  snapshots [action]      Manage snapshots (list, restore, clean)
  lockfile [action]       Show lockfile status
  database [action]       Show database entries
  pipeline                Show pipeline stages

Options:
  --destination, -d       Installation destination
  --version, -v           Resource version
  --force, -f             Force overwrite
  --dry-run               Preview without installing
  --no-color              Disable colored output
  --verbose               Enable debug output
  --quiet                 Suppress output
  --help, -h              Show this help
  --version               Show version

Environment Variables:
  GITHUB_TOKEN            GitHub API token for higher rate limits
  VETWO_MARKETPLACE_REPOSITORY   Override marketplace repository
  VETWO_MARKETPLACE_BRANCH       Override marketplace branch
  VETWO_MARKETPLACE_DESTINATION  Override installation destination
  VETWO_MARKETPLACE_LOG_LEVEL    Override log level
  VETWO_MARKETPLACE_CACHE_DIR    Override cache directory
  VETWO_MARKETPLACE_CACHE_ENABLED Enable/disable cache
`;

async function main(): Promise<void> {
  if (isLegacyInvocation()) {
    process.stderr.write(
      `\n⚠️ The command "${getInvokedCliName()}" has been renamed.\n\nPlease use:\n\n    npx ${CLI_NAME}\n\nThe old command will be removed in a future version.\n\n`,
    );
  }

  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      destination: { type: "string", short: "d" },
      version: { type: "string", short: "v" },
      force: { type: "boolean", short: "f", default: false },
      "dry-run": { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      debug: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values["help"]) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  if (values["version"]) {
    process.stdout.write(`@vetwo/marketplace v${VERSION}\n`);
    process.exit(0);
  }

  const logLevel = values["verbose"]
    ? "debug"
    : values["quiet"]
      ? "silent"
      : "info";

  const logger = createLogger({
    level: logLevel as "debug" | "info" | "warn" | "error" | "silent",
    prefix: CLI_NAME,
    color: !values["no-color"],
  });

  const marketplace = new Marketplace({ logger });

  const command = positionals[0];

  try {
    switch (command) {
      case "search": {
        const { runSearchCommand } = await import("./commands/search.js");
        await runSearchCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "info": {
        const { runInfoCommand } = await import("./commands/info.js");
        await runInfoCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "install": {
        const { runInstallCommand } = await import("./commands/install.js");
        await runInstallCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "preview": {
        const { runPreviewCommand } = await import("./commands/preview.js");
        await runPreviewCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "cache": {
        const { runCacheCommand } = await import("./commands/cache.js");
        await runCacheCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "doctor": {
        const { runDoctorCommand } = await import("./commands/doctor.js");
        await runDoctorCommand(marketplace, values);
        break;
      }
      case "update": {
        const { runUpdateCommand } = await import("./commands/update.js");
        await runUpdateCommand(marketplace, values);
        break;
      }
      case "remove": {
        const { runRemoveCommand } = await import("./commands/remove.js");
        await runRemoveCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "list": {
        const { runListCommand } = await import("./commands/list.js");
        await runListCommand(marketplace, values);
        break;
      }
      case "categories": {
        const { runCategoriesCommand } =
          await import("./commands/categories.js");
        await runCategoriesCommand(marketplace, values);
        break;
      }
      case "tags": {
        const { runTagsCommand } = await import("./commands/tags.js");
        await runTagsCommand(marketplace, values);
        break;
      }
      case "dependencies": {
        const { runDependenciesCommand } =
          await import("./commands/dependencies.js");
        await runDependenciesCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "wizard": {
        const { runWizardCommand } = await import("./wizard/index.js");
        await runWizardCommand(marketplace, values);
        break;
      }
      case "snapshots": {
        const { runSnapshotsCommand } = await import("./commands/snapshots.js");
        await runSnapshotsCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "lockfile": {
        const { runLockfileCommand } = await import("./commands/lockfile.js");
        await runLockfileCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "database": {
        const { runDatabaseCommand } = await import("./commands/database.js");
        await runDatabaseCommand(marketplace, positionals.slice(1), values);
        break;
      }
      case "pipeline": {
        const { runPipelineCommand } = await import("./commands/pipeline.js");
        await runPipelineCommand(marketplace, values);
        break;
      }
      case undefined: {
        const { launchTUI } = await import("./tui/index.js");
        launchTUI(marketplace, values["debug"] === true);
        break;
      }
      default:
        process.stderr.write(`Unknown command: ${command}\n\n`);
        process.stderr.write(HELP_TEXT);
        process.exit(1);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Marketplace not loaded")
    ) {
      logger.error("Failed to initialize marketplace");
      process.exit(1);
    }
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
