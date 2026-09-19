export type FrameworkType =
  | "react"
  | "nextjs"
  | "vue"
  | "angular"
  | "solid"
  | "svelte"
  | "astro"
  | "node"
  | "express"
  | "nestjs"
  | "tailwind"
  | "vite"
  | "nuxt"
  | "remix"
  | "webpack"
  | "rollup"
  | "parcel"
  | "turbopack"
  | "esbuild"
  | "sass"
  | "postcss"
  | "css-modules"
  | "styled-components"
  | "emotion"
  | "jest"
  | "vitest"
  | "mocha"
  | "playwright"
  | "cypress"
  | "bun"
  | "deno";

export type BundlerType =
  | "vite"
  | "webpack"
  | "rollup"
  | "parcel"
  | "turbopack"
  | "esbuild"
  | "unknown";
export type StylingType =
  | "tailwind"
  | "sass"
  | "postcss"
  | "css-modules"
  | "styled-components"
  | "emotion"
  | "unknown";
export type TestingType =
  "jest" | "vitest" | "mocha" | "playwright" | "cypress" | "unknown";

export interface DetectedProject {
  readonly frameworks: ReadonlyArray<DetectedFramework>;
  readonly rootPath: string;
  readonly packageManager: PackageManagerType;
  readonly runtime: RuntimeType;
  readonly bundler: BundlerType;
  readonly styling: StylingType;
  readonly testing: TestingType;
  readonly typescript: boolean;
  readonly eslint: boolean;
  readonly prettier: boolean;
}

export type RuntimeType = "node" | "bun" | "deno" | "unknown";

export interface DetectedFramework {
  readonly type: FrameworkType;
  readonly version?: string;
  readonly confidence: number;
}

export type PackageManagerType = "npm" | "yarn" | "pnpm" | "bun" | "unknown";
