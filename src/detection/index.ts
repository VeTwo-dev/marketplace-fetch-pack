import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  DetectedProject,
  DetectedFramework,
  FrameworkType,
  PackageManagerType,
  BundlerType,
  StylingType,
  TestingType,
  RuntimeType,
} from "../types/detection.js";
import { createLogger, type Logger } from "../logger/index.js";
import { isPlainObject } from "../utils/index.js";

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
}

const FRAMEWORK_SIGNATURES: ReadonlyArray<{
  readonly type: FrameworkType;
  readonly packageName: string;
  readonly confidence: number;
}> = [
  { type: "nextjs", packageName: "next", confidence: 0.95 },
  { type: "nuxt", packageName: "nuxt", confidence: 0.95 },
  { type: "remix", packageName: "@remix-run/react", confidence: 0.95 },
  { type: "remix", packageName: "@remix-run/node", confidence: 0.9 },
  { type: "astro", packageName: "astro", confidence: 0.95 },
  { type: "svelte", packageName: "svelte", confidence: 0.85 },
  { type: "solid", packageName: "solid-js", confidence: 0.9 },
  { type: "angular", packageName: "@angular/core", confidence: 0.95 },
  { type: "vue", packageName: "vue", confidence: 0.85 },
  { type: "react", packageName: "react", confidence: 0.8 },
  { type: "tailwind", packageName: "tailwindcss", confidence: 0.9 },
  { type: "vite", packageName: "vite", confidence: 0.85 },
  { type: "express", packageName: "express", confidence: 0.9 },
  { type: "nestjs", packageName: "@nestjs/core", confidence: 0.95 },
  { type: "node", packageName: "@types/node", confidence: 0.7 },
  { type: "webpack", packageName: "webpack", confidence: 0.85 },
  { type: "rollup", packageName: "rollup", confidence: 0.85 },
  { type: "parcel", packageName: "parcel", confidence: 0.85 },
  { type: "turbopack", packageName: "turbopack", confidence: 0.85 },
  { type: "esbuild", packageName: "esbuild", confidence: 0.85 },
  { type: "sass", packageName: "sass", confidence: 0.9 },
  { type: "postcss", packageName: "postcss", confidence: 0.9 },
  { type: "css-modules", packageName: "css-modules", confidence: 0.8 },
  {
    type: "styled-components",
    packageName: "styled-components",
    confidence: 0.9,
  },
  { type: "emotion", packageName: "@emotion/react", confidence: 0.9 },
  { type: "jest", packageName: "jest", confidence: 0.9 },
  { type: "vitest", packageName: "vitest", confidence: 0.9 },
  { type: "mocha", packageName: "mocha", confidence: 0.9 },
  { type: "playwright", packageName: "@playwright/test", confidence: 0.95 },
  { type: "cypress", packageName: "cypress", confidence: 0.95 },
  { type: "bun", packageName: "bun-types", confidence: 0.9 },
];

export class ProjectDetector {
  private readonly _logger: Logger;

  constructor(logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "detector" });
  }

  async detect(rootPath?: string): Promise<DetectedProject> {
    const root = rootPath ?? process.cwd();
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const packageJsonPath = join(root, "package.json");
    let packageJson: PackageJson = {};

    try {
      const content = await readFile(packageJsonPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (isPlainObject(parsed)) {
        packageJson = parsed as PackageJson;
      }
    } catch {
      this._logger.debug("No package.json found");
    }

    const allDeps: Record<string, string> = {
      ...((packageJson.dependencies as Record<string, string>) ?? {}),
      ...((packageJson.devDependencies as Record<string, string>) ?? {}),
      ...((packageJson.peerDependencies as Record<string, string>) ?? {}),
    };

    const frameworks = this._detectFrameworks(allDeps);
    const packageManager = this._detectPackageManager(root);
    const runtime = this._detectRuntime(root, allDeps);
    const bundler = this._detectBundler(allDeps);
    const styling = this._detectStyling(allDeps);
    const testing = this._detectTesting(allDeps);
    const typescript = this._detectTypeScript(allDeps, packageJson);
    const eslint = this._detectESLint(allDeps);
    const prettier = this._detectPrettier(allDeps);

    return {
      frameworks,
      rootPath: root,
      packageManager,
      runtime,
      bundler,
      styling,
      testing,
      typescript,
      eslint,
      prettier,
    };
  }

  getCompatibleFrameworks(
    project: DetectedProject,
  ): ReadonlyArray<FrameworkType> {
    return project.frameworks.map((f) => f.type);
  }

  private _detectFrameworks(
    deps: Record<string, string>,
  ): Array<DetectedFramework> {
    const detected: Array<DetectedFramework> = [];

    for (const signature of FRAMEWORK_SIGNATURES) {
      const version = deps[signature.packageName];
      if (version !== undefined) {
        detected.push({
          type: signature.type,
          version: this._cleanVersion(version),
          confidence: signature.confidence,
        });
      }
    }

    return detected.sort((a, b) => b.confidence - a.confidence);
  }

  private _detectPackageManager(root: string): PackageManagerType {
    if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(root, "yarn.lock"))) return "yarn";
    if (existsSync(join(root, "bun.lockb"))) return "bun";
    if (existsSync(join(root, "package-lock.json"))) return "npm";

    return "unknown";
  }

  private _detectRuntime(
    root: string,
    deps: Record<string, string>,
  ): RuntimeType {
    if ("bun-types" in deps || existsSync(join(root, "bunfig.toml")))
      return "bun";
    if (
      existsSync(join(root, "deno.json")) ||
      existsSync(join(root, "deno.jsonc"))
    )
      return "deno";
    if (
      existsSync(join(root, "package.json")) ||
      "node" in deps ||
      "@types/node" in deps
    )
      return "node";
    return "unknown";
  }

  private _detectBundler(deps: Record<string, string>): BundlerType {
    if ("vite" in deps) return "vite";
    if ("webpack" in deps || "webpack-cli" in deps) return "webpack";
    if ("rollup" in deps || "@rollup/plugin-commonjs" in deps) return "rollup";
    if ("parcel" in deps) return "parcel";
    if ("turbopack" in deps) return "turbopack";
    if ("esbuild" in deps) return "esbuild";
    return "unknown";
  }

  private _detectStyling(deps: Record<string, string>): StylingType {
    if ("tailwindcss" in deps) return "tailwind";
    if ("sass" in deps || "node-sass" in deps) return "sass";
    if ("postcss" in deps || "autoprefixer" in deps) return "postcss";
    if ("css-modules" in deps) return "css-modules";
    if ("styled-components" in deps) return "styled-components";
    if ("@emotion/react" in deps || "@emotion/css" in deps) return "emotion";
    return "unknown";
  }

  private _detectTesting(deps: Record<string, string>): TestingType {
    if ("jest" in deps || "@jest/globals" in deps) return "jest";
    if ("vitest" in deps) return "vitest";
    if ("mocha" in deps) return "mocha";
    if ("@playwright/test" in deps) return "playwright";
    if ("cypress" in deps) return "cypress";
    return "unknown";
  }

  private _detectTypeScript(
    deps: Record<string, string>,
    packageJson: PackageJson,
  ): boolean {
    if ("typescript" in deps) return true;
    if (packageJson.scripts !== undefined) {
      const scripts = packageJson.scripts as Record<string, string>;
      for (const script of Object.values(scripts)) {
        if (typeof script === "string" && script.includes("tsc")) return true;
      }
    }
    return false;
  }

  private _detectESLint(deps: Record<string, string>): boolean {
    return "eslint" in deps || "@eslint/js" in deps;
  }

  private _detectPrettier(deps: Record<string, string>): boolean {
    return "prettier" in deps;
  }

  private _cleanVersion(version: string): string {
    return version.replace(/^[~^>=<]/, "");
  }
}
