import type { Marketplace } from "../../marketplace/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runUpdateCommand(
  marketplace: Marketplace,
  _values: ParsedArgs["values"],
): Promise<void> {
  process.stderr.write("Updating marketplace registry...\n");

  await marketplace.update();

  const resources = await marketplace.resources();
  process.stderr.write(
    `Registry updated: ${resources.length} resources available.\n`,
  );
}
