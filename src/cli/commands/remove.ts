import type { Marketplace } from "../../marketplace/index.js";
import { CLI_NAME } from "../constants.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runRemoveCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  _values: ParsedArgs["values"],
): Promise<void> {
  const id = args[0];

  if (id === undefined || id === "") {
    process.stderr.write(`Usage: ${CLI_NAME} remove <id>\n`);
    process.exit(1);
  }

  process.stderr.write(`Removing ${id}...\n`);

  await marketplace.remove(id);

  process.stderr.write(`Removed ${id}.\n`);
}
