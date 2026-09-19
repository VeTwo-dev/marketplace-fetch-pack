import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectDetector } from "../../src/detection/index.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `vetwo-detect-test-${Date.now()}`);

async function setupPackageJson(deps: Record<string, string> = {}, devDeps: Record<string, string> = {}, scripts?: Record<string, string>) {
  const pkg: Record<string, unknown> = {
    name: "test-project",
    dependencies: deps,
  };
  if (Object.keys(devDeps).length > 0) {
    pkg.devDependencies = devDeps;
  }
  if (scripts) {
    pkg.scripts = scripts;
  }
  await writeFile(join(TEST_DIR, "package.json"), JSON.stringify(pkg), "utf-8");
}

describe("ProjectDetector", () => {
  let detector: ProjectDetector;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    detector = new ProjectDetector();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("detect()", () => {
    it("returns empty frameworks for plain project", async () => {
      await setupPackageJson({ lodash: "^4.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks).toHaveLength(0);
      expect(project.typescript).toBe(false);
      expect(project.eslint).toBe(false);
      expect(project.prettier).toBe(false);
      expect(project.rootPath).toBe(TEST_DIR);
    });

    it("detects react", async () => {
      await setupPackageJson({ react: "^18.2.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "react")).toBe(true);
    });

    it("detects nextjs", async () => {
      await setupPackageJson({ next: "14.0.0", react: "^18.0.0" });
      const project = await detector.detect(TEST_DIR);
      const nextFramework = project.frameworks.find((f) => f.type === "nextjs");
      expect(nextFramework).toBeDefined();
      expect(nextFramework!.version).toBe("14.0.0");
    });

    it("detects vue", async () => {
      await setupPackageJson({ vue: "^3.3.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "vue")).toBe(true);
    });

    it("detects angular", async () => {
      await setupPackageJson({ "@angular/core": "^17.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "angular")).toBe(true);
    });

    it("detects svelte", async () => {
      await setupPackageJson({ svelte: "^4.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "svelte")).toBe(true);
    });

    it("detects solid", async () => {
      await setupPackageJson({ "solid-js": "^1.8.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "solid")).toBe(true);
    });

    it("detects express", async () => {
      await setupPackageJson({ express: "^4.18.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "express")).toBe(true);
    });

    it("detects nestjs", async () => {
      await setupPackageJson({ "@nestjs/core": "^10.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "nestjs")).toBe(true);
    });

    it("detects vite", async () => {
      await setupPackageJson({}, { vite: "^5.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "vite")).toBe(true);
    });

    it("detects tailwind", async () => {
      await setupPackageJson({}, { tailwindcss: "^3.4.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.some((f) => f.type === "tailwind")).toBe(true);
    });

    it("detects typescript via dependencies", async () => {
      await setupPackageJson({}, { typescript: "^5.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.typescript).toBe(true);
    });

    it("detects typescript via tsc in scripts", async () => {
      await setupPackageJson({}, {}, { build: "tsc" });
      const project = await detector.detect(TEST_DIR);
      expect(project.typescript).toBe(true);
    });

    it("detects eslint", async () => {
      await setupPackageJson({}, { eslint: "^8.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.eslint).toBe(true);
    });

    it("detects prettier", async () => {
      await setupPackageJson({}, { prettier: "^3.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.prettier).toBe(true);
    });

    it("works without package.json", async () => {
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks).toHaveLength(0);
      expect(project.rootPath).toBe(TEST_DIR);
    });

    it("detects multiple frameworks", async () => {
      await setupPackageJson({
        react: "^18.0.0",
        vue: "^3.0.0",
      });
      const project = await detector.detect(TEST_DIR);
      expect(project.frameworks.length).toBeGreaterThanOrEqual(2);
    });

    it("frameworks are sorted by confidence descending", async () => {
      await setupPackageJson({
        react: "^18.0.0",
        "@angular/core": "^17.0.0",
        vue: "^3.0.0",
      });
      const project = await detector.detect(TEST_DIR);
      const confidences = project.frameworks.map((f) => f.confidence);
      for (let i = 1; i < confidences.length; i++) {
        expect(confidences[i]!).toBeLessThanOrEqual(confidences[i - 1]!);
      }
    });
  });

  describe("getCompatibleFrameworks()", () => {
    it("returns framework types", async () => {
      await setupPackageJson({ react: "^18.0.0" });
      const project = await detector.detect(TEST_DIR);
      const types = detector.getCompatibleFrameworks(project);
      expect(types).toContain("react");
    });
  });

  describe("new detection fields", () => {
    it("detects runtime as node by default", async () => {
      await setupPackageJson({});
      const project = await detector.detect(TEST_DIR);
      expect(project.runtime).toBe("node");
    });

    it("detects webpack bundler", async () => {
      await setupPackageJson({}, { webpack: "^5.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.bundler).toBe("webpack");
    });

    it("detects rollup bundler", async () => {
      await setupPackageJson({}, { rollup: "^4.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.bundler).toBe("rollup");
    });

    it("detects sass styling", async () => {
      await setupPackageJson({}, { sass: "^1.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.styling).toBe("sass");
    });

    it("detects postcss styling", async () => {
      await setupPackageJson({}, { postcss: "^8.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.styling).toBe("postcss");
    });

    it("detects jest testing", async () => {
      await setupPackageJson({}, { jest: "^29.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.testing).toBe("jest");
    });

    it("detects vitest testing", async () => {
      await setupPackageJson({}, { vitest: "^1.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.testing).toBe("vitest");
    });

    it("detects playwright testing", async () => {
      await setupPackageJson({}, { "@playwright/test": "^1.0.0" });
      const project = await detector.detect(TEST_DIR);
      expect(project.testing).toBe("playwright");
    });

    it("returns unknown for no bundler", async () => {
      await setupPackageJson({});
      const project = await detector.detect(TEST_DIR);
      expect(project.bundler).toBe("unknown");
    });

    it("returns unknown for no testing", async () => {
      await setupPackageJson({});
      const project = await detector.detect(TEST_DIR);
      expect(project.testing).toBe("unknown");
    });
  });
});
