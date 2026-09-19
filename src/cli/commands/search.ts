import type { Marketplace } from "../../marketplace/index.js";
import { CLI_NAME } from "../constants.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runSearchCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  _values: ParsedArgs["values"],
): Promise<void> {
  const query = args.join(" ");

  if (query === "") {
    process.stderr.write(`Usage: ${CLI_NAME} search <query>\n`);
    process.exit(1);
  }

  process.stderr.write(`Searching for "${query}"...\n`);
  const result = await marketplace.search({ keyword: query });

  if (result.items.length === 0) {
    process.stderr.write(`No results found for "${query}".\n`);
    return;
  }

  process.stderr.write(
    `\nFound ${result.total} result(s) (${result.duration}ms):\n\n`,
  );

  for (const item of result.items) {
    const r = item.resource;
    const tags = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
    process.stdout.write(`  ${r.name}@${r.version}\n`);
    process.stdout.write(`    ${r.description}\n`);
    process.stdout.write(
      `    Category: ${r.category} | Author: ${r.author}${tags}\n\n`,
    );
  }
}
