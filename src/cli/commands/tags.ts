import type { Marketplace } from "../../marketplace/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runTagsCommand(
  marketplace: Marketplace,
  _values: ParsedArgs["values"],
): Promise<void> {
  const resources = await marketplace.resources();

  const tagMap = new Map<string, number>();
  for (const resource of resources) {
    for (const tag of resource.tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }

  const tags = Array.from(tagMap.entries()).sort((a, b) => b[1] - a[1]);

  if (tags.length === 0) {
    process.stderr.write("No tags found.\n");
    return;
  }

  process.stdout.write(`\nTags (${tags.length}):\n\n`);
  for (const [tag, count] of tags) {
    process.stdout.write(`  ${tag} (${count})\n`);
  }
  process.stdout.write("\n");
}
