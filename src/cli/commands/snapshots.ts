import type { Marketplace } from "../../marketplace/index.js";
import { CLI_NAME } from "../constants.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runSnapshotsCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  _values: ParsedArgs["values"],
): Promise<void> {
  const action = args[0] ?? "list";
  const snapshotManager = marketplace.getSnapshotManager();

  if (snapshotManager === null) {
    process.stderr.write("Snapshot manager not available.\n");
    process.exit(1);
  }

  await marketplace.load();

  switch (action) {
    case "list": {
      const resourceId = args[1] as string | undefined;
      const snapshots = await snapshotManager.list(resourceId);

      if (snapshots.length === 0) {
        process.stderr.write("No snapshots found.\n");
        return;
      }

      process.stdout.write(`\nSnapshots (${snapshots.length}):\n\n`);
      for (const snapshot of snapshots) {
        process.stdout.write(`  ${snapshot.id}\n`);
        process.stdout.write(
          `    Resource: ${snapshot.resourceId}@${snapshot.version}\n`,
        );
        process.stdout.write(`    Time: ${snapshot.timestamp}\n`);
        process.stdout.write(`    Files: ${snapshot.metadata.totalFiles}\n`);
        process.stdout.write(
          `    Size: ${snapshot.metadata.totalSize} bytes\n\n`,
        );
      }
      break;
    }
    case "restore": {
      const snapshotId = args[1] as string | undefined;
      if (snapshotId === undefined || snapshotId === "") {
        process.stderr.write(
          `Usage: ${CLI_NAME} snapshots restore <snapshot-id>\n`,
        );
        process.exit(1);
      }

      process.stderr.write(`Restoring snapshot ${snapshotId}...\n`);
      const result = await snapshotManager.restore(snapshotId);

      if (result.success) {
        process.stderr.write(`\nSnapshot restored successfully.\n`);
        process.stdout.write(`  Files restored: ${result.filesRestored}\n`);
      } else {
        process.stderr.write(`\nSnapshot restore failed.\n`);
        process.stdout.write(`  Files restored: ${result.filesRestored}\n`);
        process.stdout.write(`  Files failed: ${result.filesFailed}\n`);
        for (const error of result.errors) {
          process.stderr.write(`    - ${error}\n`);
        }
      }
      break;
    }
    case "clean": {
      const daysStr = args[1] as string | undefined;
      const days = daysStr !== undefined ? parseInt(daysStr, 10) : 30;
      const olderThanMs = days * 24 * 60 * 60 * 1000;

      process.stderr.write(`Cleaning snapshots older than ${days} days...\n`);
      const count = await snapshotManager.clean(olderThanMs);
      process.stderr.write(`Cleaned ${count} snapshot(s).\n`);
      break;
    }
    case "delete": {
      const snapshotId = args[1] as string | undefined;
      if (snapshotId === undefined || snapshotId === "") {
        process.stderr.write(
          `Usage: ${CLI_NAME} snapshots delete <snapshot-id>\n`,
        );
        process.exit(1);
      }

      const deleted = await snapshotManager.delete(snapshotId);
      if (deleted) {
        process.stderr.write(`Snapshot ${snapshotId} deleted.\n`);
      } else {
        process.stderr.write(`Snapshot ${snapshotId} not found.\n`);
      }
      break;
    }
    default:
      process.stderr.write(`Unknown snapshot action: ${action}\n`);
      process.stderr.write("Available actions: list, restore, clean, delete\n");
      process.exit(1);
  }
}
