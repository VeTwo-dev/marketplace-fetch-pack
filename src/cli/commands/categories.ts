import type { Marketplace } from "../../marketplace/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runCategoriesCommand(
  marketplace: Marketplace,
  _values: ParsedArgs["values"],
): Promise<void> {
  const categories = await marketplace.categories();

  if (categories.length === 0) {
    process.stderr.write("No categories found.\n");
    return;
  }

  process.stdout.write(`\nCategories (${categories.length}):\n\n`);
  for (const cat of categories) {
    process.stdout.write(`  ${cat.name} (${cat.resourceCount} resources)\n`);
    process.stdout.write(`    ${cat.description}\n`);
  }
  process.stdout.write("\n");
}
