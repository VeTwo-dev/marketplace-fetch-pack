import type { Marketplace } from "../../marketplace/index.js";
import { CLI_NAME } from "../constants.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runDependenciesCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  _values: ParsedArgs["values"],
): Promise<void> {
  const id = args[0];

  if (id === undefined || id === "") {
    process.stderr.write(`Usage: ${CLI_NAME} dependencies <id>\n`);
    process.exit(1);
  }

  process.stderr.write(`Resolving dependencies for ${id}...\n`);

  const graph = await marketplace.dependencies(id);

  process.stdout.write(`\n  Dependency graph for ${id}:\n\n`);
  process.stdout.write(`  Total dependencies: ${graph.flat.length}\n`);

  if (graph.flat.length > 0) {
    process.stdout.write(`\n  Dependencies:\n`);
    for (const depId of graph.flat) {
      if (depId === id) continue;
      const node = graph.nodes.get(depId);
      const version = node?.version ?? "unknown";
      process.stdout.write(`    ${depId}@${version}\n`);
    }
  }

  if (graph.circular.length > 0) {
    process.stdout.write(`\n  Circular dependencies:\n`);
    for (const chain of graph.circular) {
      process.stdout.write(`    ${chain.join(" -> ")}\n`);
    }
  }

  if (graph.conflicts.length > 0) {
    process.stdout.write(`\n  Conflicts:\n`);
    for (const conflict of graph.conflicts) {
      process.stdout.write(
        `    ${conflict.id}: versions ${conflict.versions.join(", ")}\n`,
      );
    }
  }

  process.stdout.write("\n");
}
