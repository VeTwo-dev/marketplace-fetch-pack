import * as readline from "node:readline";
import { Marketplace } from "../../marketplace/index.js";
import type { RegistryCategory } from "../../types/registry.js";
import type { DetectedProject, FrameworkType } from "../../types/detection.js";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
} as const;

type WizardState = {
  marketplace: Marketplace;
  rl: readline.Interface;
  project: DetectedProject | null;
  selectedCategory: RegistryCategory | null;
  searchQuery: string;
};

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function promptChoice(
  rl: readline.Interface,
  title: string,
  choices: ReadonlyArray<{
    label: string;
    value: string;
    description?: string;
  }>,
): Promise<string | null> {
  process.stdout.write(
    `\n${COLORS.bold}${COLORS.cyan}${title}${COLORS.reset}\n\n`,
  );

  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i]!;
    const num = String(i + 1).padStart(2);
    const desc =
      choice.description !== undefined
        ? `${COLORS.dim} - ${choice.description}${COLORS.reset}`
        : "";
    process.stdout.write(
      `  ${COLORS.yellow}${num}${COLORS.reset}. ${choice.label}${desc}\n`,
    );
  }

  process.stdout.write(`\n  ${COLORS.dim}0. Back${COLORS.reset}\n`);
  process.stdout.write(`  ${COLORS.dim}q. Quit${COLORS.reset}\n`);

  const answer = await question(rl, `\n${COLORS.green}> ${COLORS.reset}`);

  if (answer === "q" || answer === "Q") return null;
  if (answer === "0") return "back";

  const index = parseInt(answer, 10) - 1;
  if (isNaN(index) || index < 0 || index >= choices.length) {
    process.stdout.write(`${COLORS.red}Invalid choice.${COLORS.reset}\n`);
    return promptChoice(rl, title, choices);
  }

  return choices[index]!.value;
}

async function showWelcome(state: WizardState): Promise<void> {
  process.stdout.write(`
${COLORS.bold}${COLORS.cyan}╔══════════════════════════════════════════╗
║     VeTwo Marketplace Wizard             ║
║     Discover & Install Resources         ║
╚══════════════════════════════════════════╝${COLORS.reset}
`);

  process.stderr.write("Loading marketplace...\n");
  await state.marketplace.load();

  const resources = await state.marketplace.resources();
  const categories = await state.marketplace.categories();

  process.stdout.write(
    `${COLORS.dim}  ${resources.length} resources in ${categories.length} categories${COLORS.reset}\n`,
  );

  if (state.marketplace.config.autoDetect) {
    process.stderr.write("Detecting project...\n");
    state.project = await state.marketplace.detectProject();
    if (state.project.frameworks.length > 0) {
      const frameworkNames = state.project.frameworks
        .map((f) => f.type)
        .join(", ");
      process.stdout.write(
        `${COLORS.dim}  Detected: ${frameworkNames}${COLORS.reset}\n`,
      );
    }
  }
}

async function showMainMenu(state: WizardState): Promise<boolean> {
  const choices = [
    {
      label: "Browse Categories",
      value: "categories",
      description: "Explore resources by category",
    },
    { label: "Search", value: "search", description: "Search for resources" },
    {
      label: "Recommended",
      value: "recommended",
      description: "Resources recommended for your project",
    },
    {
      label: "Install",
      value: "install",
      description: "Install a resource by ID",
    },
    {
      label: "List Installed",
      value: "list",
      description: "View installed resources",
    },
    { label: "Doctor", value: "doctor", description: "Run diagnostics" },
    { label: "Cache", value: "cache", description: "View cache statistics" },
  ];

  const choice = await promptChoice(state.rl, "Main Menu", choices);

  if (choice === null) return false;
  if (choice === "back") return false;

  switch (choice) {
    case "categories":
      await showCategories(state);
      break;
    case "search":
      await showSearch(state);
      break;
    case "recommended":
      await showRecommended(state);
      break;
    case "install":
      await showInstall(state);
      break;
    case "list":
      await showList(state);
      break;
    case "doctor":
      await showDoctor(state);
      break;
    case "cache":
      await showCache(state);
      break;
  }

  return true;
}

async function showCategories(state: WizardState): Promise<void> {
  const categories = await state.marketplace.categories();

  if (categories.length === 0) {
    process.stdout.write(
      `${COLORS.yellow}No categories found.${COLORS.reset}\n`,
    );
    return;
  }

  const choices = categories.map((cat) => ({
    label: `${cat.name} (${cat.resourceCount})`,
    value: cat.id,
    description: cat.description,
  }));

  const choice = await promptChoice(state.rl, "Categories", choices);

  if (choice === "back" || choice === null) return;

  state.selectedCategory = categories.find((c) => c.id === choice) ?? null;
  await showCategoryResources(state);
}

async function showCategoryResources(state: WizardState): Promise<void> {
  if (state.selectedCategory === null) return;

  const resources = await state.marketplace.resources();
  const filtered = resources.filter(
    (r) => r.category === state.selectedCategory!.id,
  );

  if (filtered.length === 0) {
    process.stdout.write(
      `${COLORS.yellow}No resources in this category.${COLORS.reset}\n`,
    );
    return;
  }

  const choices = filtered.map((r) => ({
    label: `${r.name}@${r.version}`,
    value: r.id,
    description: r.description,
  }));

  const choice = await promptChoice(
    state.rl,
    `${state.selectedCategory.name} Resources`,
    choices,
  );

  if (choice === "back" || choice === null) return;

  await showResourceDetail(state, choice);
}

async function showSearch(state: WizardState): Promise<void> {
  const query = await question(
    state.rl,
    `\n${COLORS.green}Search query: ${COLORS.reset}`,
  );

  if (query === "") return;

  process.stderr.write("Searching...\n");
  const result = await state.marketplace.search({ keyword: query });

  if (result.items.length === 0) {
    process.stdout.write(`${COLORS.yellow}No results found.${COLORS.reset}\n`);
    return;
  }

  const choices = result.items.map((item) => ({
    label: `${item.resource.name}@${item.resource.version}`,
    value: item.resource.id,
    description: item.resource.description,
  }));

  const choice = await promptChoice(
    state.rl,
    `Search Results (${result.total})`,
    choices,
  );

  if (choice === "back" || choice === null) return;

  await showResourceDetail(state, choice);
}

async function showRecommended(state: WizardState): Promise<void> {
  if (state.project === null || state.project.frameworks.length === 0) {
    process.stdout.write(
      `${COLORS.yellow}No project detected. Cannot recommend resources.${COLORS.reset}\n`,
    );
    return;
  }

  const resources = await state.marketplace.resources();
  const frameworks = state.project.frameworks.map((f) => f.type);

  const compatible = resources.filter((r) => {
    if (r.compatibility?.frameworks === undefined) return false;
    return r.compatibility.frameworks.some((f) =>
      frameworks.includes(f as FrameworkType),
    );
  });

  if (compatible.length === 0) {
    process.stdout.write(
      `${COLORS.yellow}No compatible resources found for your project.${COLORS.reset}\n`,
    );
    return;
  }

  const choices = compatible.map((r) => ({
    label: `${r.name}@${r.version}`,
    value: r.id,
    description: r.description,
  }));

  const choice = await promptChoice(state.rl, "Recommended Resources", choices);

  if (choice === "back" || choice === null) return;

  await showResourceDetail(state, choice);
}

async function showResourceDetail(
  state: WizardState,
  resourceId: string,
): Promise<void> {
  const info = await state.marketplace.info(resourceId);

  if (info === null) {
    process.stdout.write(`${COLORS.red}Resource not found.${COLORS.reset}\n`);
    return;
  }

  process.stdout.write(`
${COLORS.bold}${COLORS.cyan}${info.name}@${info.version}${COLORS.reset}
${info.description}

${COLORS.dim}Category:${COLORS.reset}   ${info.category}
${COLORS.dim}Author:${COLORS.reset}     ${info.author.name}
${COLORS.dim}Tags:${COLORS.reset}       ${info.tags.join(", ") || "none"}
${COLORS.dim}License:${COLORS.reset}    ${info.license ?? "unknown"}
`);

  if (info.dependencies.length > 0) {
    process.stdout.write(`${COLORS.dim}Dependencies:${COLORS.reset}\n`);
    for (const dep of info.dependencies) {
      process.stdout.write(
        `  - ${dep.id}${dep.version !== undefined ? `@${dep.version}` : ""}${dep.optional ? " (optional)" : ""}\n`,
      );
    }
  }

  const actions = [
    { label: "Install", value: "install", description: `Install ${info.name}` },
    {
      label: "Preview (Dry Run)",
      value: "preview",
      description: "Preview what would be installed",
    },
  ];

  const choice = await promptChoice(state.rl, "Actions", actions);

  if (choice === null || choice === "back") return;

  if (choice === "install") {
    process.stderr.write(`Installing ${info.name}...\n`);
    try {
      const result = await state.marketplace.install(info.id);
      process.stdout.write(
        `${COLORS.green}✓ Installed ${result.id}@${result.version} (${result.filesInstalled} files)${COLORS.reset}\n`,
      );
    } catch (error) {
      process.stdout.write(
        `${COLORS.red}✗ Installation failed: ${error instanceof Error ? error.message : String(error)}${COLORS.reset}\n`,
      );
    }
  } else if (choice === "preview") {
    process.stderr.write("Previewing...\n");
    try {
      const preview = await state.marketplace.preview(info.id);
      process.stdout.write(
        `\n${COLORS.dim}Would install ${preview.wouldInstall.length} files (${formatSize(preview.estimatedSize)})${COLORS.reset}\n`,
      );
      for (const file of preview.wouldInstall) {
        process.stdout.write(`  ${file.path}\n`);
      }
    } catch (error) {
      process.stdout.write(
        `${COLORS.red}✗ Preview failed: ${error instanceof Error ? error.message : String(error)}${COLORS.reset}\n`,
      );
    }
  }
}

async function showInstall(state: WizardState): Promise<void> {
  const id = await question(
    state.rl,
    `\n${COLORS.green}Resource ID to install: ${COLORS.reset}`,
  );
  if (id === "") return;

  process.stderr.write(`Installing ${id}...\n`);
  try {
    const result = await state.marketplace.install(id);
    process.stdout.write(
      `${COLORS.green}✓ Installed ${result.id}@${result.version} (${result.filesInstalled} files)${COLORS.reset}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${COLORS.red}✗ Installation failed: ${error instanceof Error ? error.message : String(error)}${COLORS.reset}\n`,
    );
  }
}

async function showList(state: WizardState): Promise<void> {
  const installed = await state.marketplace.list();

  if (installed.length === 0) {
    process.stdout.write(
      `${COLORS.yellow}No resources installed.${COLORS.reset}\n`,
    );
    return;
  }

  process.stdout.write(
    `\n${COLORS.bold}Installed resources:${COLORS.reset}\n\n`,
  );
  for (const id of installed) {
    process.stdout.write(`  ${id}\n`);
  }
}

async function showDoctor(state: WizardState): Promise<void> {
  process.stderr.write("Running diagnostics...\n");
  const report = await state.marketplace.doctor();

  const STATUS_COLORS: Record<string, string> = {
    pass: COLORS.green,
    warn: COLORS.yellow,
    fail: COLORS.red,
    skip: COLORS.dim,
  };

  process.stdout.write("\n");
  for (const check of report.result.checks) {
    const color = STATUS_COLORS[check.status] ?? "";
    process.stdout.write(
      `  ${color}● ${check.name}: ${check.message}${COLORS.reset}\n`,
    );
  }

  process.stdout.write(
    `\n  ${report.healthy ? `${COLORS.green}Healthy${COLORS.reset}` : `${COLORS.red}Issues Found${COLORS.reset}`}\n`,
  );
}

async function showCache(state: WizardState): Promise<void> {
  const stats = await state.marketplace.cacheStats();
  process.stdout.write(`
${COLORS.bold}Cache Statistics:${COLORS.reset}

  Entries:    ${stats.entries}
  Size:       ${formatSize(stats.totalSize)}
  Hit rate:   ${(stats.hitRate * 100).toFixed(1)}%
  Registry:   ${stats.registryEntries}
  Manifests:  ${stats.manifestEntries}
  Downloads:  ${stats.downloadEntries}
`);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function runWizardCommand(
  marketplace: Marketplace,
  _values: Record<string, unknown>,
): Promise<void> {
  const rl = createReadline();
  const state: WizardState = {
    marketplace,
    rl,
    project: null,
    selectedCategory: null,
    searchQuery: "",
  };

  try {
    await showWelcome(state);

    let running = true;
    while (running) {
      running = await showMainMenu(state);
    }

    process.stdout.write(`\n${COLORS.cyan}Goodbye!${COLORS.reset}\n`);
  } finally {
    rl.close();
  }
}
