import type { Marketplace } from "../../marketplace/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runPipelineCommand(
  marketplace: Marketplace,
  _values: ParsedArgs["values"],
): Promise<void> {
  const pipeline = marketplace.getPipeline();

  if (pipeline === null) {
    process.stderr.write("Pipeline not available.\n");
    process.exit(1);
  }

  await marketplace.load();

  const stages = pipeline.getStages();

  process.stdout.write(`\nPipeline stages (${stages.length}):\n\n`);

  if (stages.length === 0) {
    process.stdout.write(
      "  No stages registered. Use pipeline.registerStage() to add stages.\n\n",
    );
    return;
  }

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (stage === undefined) continue;
    process.stdout.write(`  ${i + 1}. ${stage.name}\n`);
    if (stage.rollback !== undefined) {
      process.stdout.write(`     (supports rollback)\n`);
    }
  }
  process.stdout.write("\n");
}
