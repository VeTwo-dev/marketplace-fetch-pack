import type { Marketplace } from "../../marketplace/index.js";
import { CLI_NAME } from "../constants.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runInfoCommand(
  marketplace: Marketplace,
  args: ReadonlyArray<string>,
  _values: ParsedArgs["values"],
): Promise<void> {
  const id = args[0];

  if (id === undefined || id === "") {
    process.stderr.write(`Usage: ${CLI_NAME} info <id>\n`);
    process.exit(1);
  }

  const resource = await marketplace.info(id);

  if (resource === null) {
    process.stderr.write(`Resource not found: ${id}\n`);
    process.exit(1);
  }

  process.stdout.write(`\n  ${resource.name}@${resource.version}\n`);
  process.stdout.write(`  ${resource.description}\n\n`);
  process.stdout.write(`  Category:   ${resource.category}\n`);
  process.stdout.write(`  Author:     ${resource.author.name}\n`);
  if (resource.author.email !== undefined) {
    process.stdout.write(`  Email:      ${resource.author.email}\n`);
  }
  if (resource.license !== undefined) {
    process.stdout.write(`  License:    ${resource.license}\n`);
  }
  if (resource.homepage !== undefined) {
    process.stdout.write(`  Homepage:   ${resource.homepage}\n`);
  }
  if (resource.repository !== undefined) {
    process.stdout.write(`  Repository: ${resource.repository}\n`);
  }
  process.stdout.write(`  Tags:       ${resource.tags.join(", ") || "none"}\n`);
  process.stdout.write(
    `  Keywords:   ${resource.keywords.join(", ") || "none"}\n`,
  );

  if (resource.dependencies.length > 0) {
    process.stdout.write(`\n  Dependencies:\n`);
    for (const dep of resource.dependencies) {
      const optional = dep.optional ? " (optional)" : "";
      const version = dep.version !== undefined ? `@${dep.version}` : "";
      process.stdout.write(`    - ${dep.id}${version}${optional}\n`);
    }
  }

  if (resource.compatibility !== undefined) {
    process.stdout.write(`\n  Compatibility:\n`);
    if (resource.compatibility.node !== undefined) {
      process.stdout.write(`    Node.js: ${resource.compatibility.node}\n`);
    }
    if (resource.compatibility.frameworks !== undefined) {
      process.stdout.write(
        `    Frameworks: ${resource.compatibility.frameworks.join(", ")}\n`,
      );
    }
    if (resource.compatibility.platforms !== undefined) {
      process.stdout.write(
        `    Platforms: ${resource.compatibility.platforms.join(", ")}\n`,
      );
    }
  }

  process.stdout.write(`\n  Install: ${CLI_NAME} install ${resource.id}\n\n`);
}
