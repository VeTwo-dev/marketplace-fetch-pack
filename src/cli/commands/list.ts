import type { Marketplace } from "../../marketplace/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runListCommand(
  marketplace: Marketplace,
  _values: ParsedArgs["values"],
): Promise<void> {
  const installed = await marketplace.list();

  if (installed.length === 0) {
    process.stderr.write("No resources installed.\n");
    return;
  }

  process.stdout.write(`\nInstalled resources (${installed.length}):\n\n`);
  for (const id of installed) {
    process.stdout.write(`  ${id}\n`);
  }
  process.stdout.write("\n");
}
