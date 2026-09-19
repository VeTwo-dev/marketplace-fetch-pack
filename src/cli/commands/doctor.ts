import type { Marketplace } from "../../marketplace/index.js";
type ParsedArgs = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

export async function runDoctorCommand(
  marketplace: Marketplace,
  _values: ParsedArgs["values"],
): Promise<void> {
  process.stderr.write("Running diagnostics...\n\n");

  const report = await marketplace.doctor();

  const STATUS_ICONS: Record<string, string> = {
    pass: "\x1b[32m✓\x1b[0m",
    warn: "\x1b[33m⚠\x1b[0m",
    fail: "\x1b[31m✗\x1b[0m",
    skip: "\x1b[36m○\x1b[0m",
  };

  for (const check of report.result.checks) {
    const icon = STATUS_ICONS[check.status] ?? "?";
    const message = check.message;
    const suggestion =
      check.suggestion !== undefined
        ? `\n    Suggestion: ${check.suggestion}`
        : "";
    process.stdout.write(`  ${icon} ${check.name}: ${message}${suggestion}\n`);
  }

  process.stdout.write(
    `\n  Summary: ${report.result.passed} passed, ${report.result.warned} warnings, ${report.result.failed} failed, ${report.result.skipped} skipped\n`,
  );
  process.stdout.write(`  Duration: ${report.result.duration}ms\n`);
  process.stdout.write(
    `  Status: ${report.healthy ? "\x1b[32mHealthy\x1b[0m" : "\x1b[31mIssues Found\x1b[0m"}\n\n`,
  );

  if (!report.healthy) {
    process.exit(1);
  }
}
