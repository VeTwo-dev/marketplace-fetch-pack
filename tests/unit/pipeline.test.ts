import { describe, it, expect } from "vitest";
import { InstallPipeline, createInstallPipeline } from "../../src/pipeline/core.js";
import {
  createResolveStage,
  createCompatibilityStage,
  createDependencyStage,
  createDownloadStage,
  createIntegrityStage,
  createVariablesStage,
  createTransformStage,
  createMergeStage,
  createWriteStage,
  createPostInstallStage,
  createReportStage,
} from "../../src/pipeline/stages/index.js";
import { EventBus } from "../../src/events/index.js";
import type { PipelineContext, PipelineStage, PipelineResult } from "../../src/types/pipeline.js";
import type { RegistryResource } from "../../src/types/registry.js";

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    resourceId: "res-1",
    version: "1.0.0",
    destination: "/tmp/test-dest",
    variables: {},
    options: {
      force: false,
      dryRun: false,
      skipDependencies: false,
      skipTransforms: false,
      skipMerge: false,
      skipValidation: false,
      concurrency: 1,
    },
    manifest: {},
    files: [],
    snapshot: null,
    errors: [],
    warnings: [],
    metadata: {
      startTime: Date.now(),
      stagesCompleted: [],
      filesProcessed: 0,
      bytesWritten: 0,
    },
    ...overrides,
  };
}

function makeStage(name: string, execute?: PipelineStage["execute"], rollback?: PipelineStage["rollback"]): PipelineStage {
  return {
    name,
    execute: execute ?? (async (ctx) => ({ ...ctx, metadata: { ...ctx.metadata, stagesCompleted: [...ctx.metadata.stagesCompleted, name] } })),
    rollback,
  };
}

describe("pipeline", () => {
  describe("InstallPipeline", () => {
    it("registerStage and getStages", () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      const stage = makeStage("validate");
      pipeline.registerStage(stage);
      expect(pipeline.getStages()).toHaveLength(1);
      expect(pipeline.getStages()[0]!.name).toBe("validate");
    });

    it("registerStage replaces existing stage with same name", () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      pipeline.registerStage(makeStage("write", async (ctx) => ({ ...ctx })));
      pipeline.registerStage(makeStage("write", async (ctx) => ({ ...ctx, warnings: [...ctx.warnings, "updated"] })));
      expect(pipeline.getStages()).toHaveLength(1);
    });

    it("unregisterStage", () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      pipeline.registerStage(makeStage("a"));
      pipeline.registerStage(makeStage("b"));
      expect(pipeline.unregisterStage("a")).toBe(true);
      expect(pipeline.getStages()).toHaveLength(1);
      expect(pipeline.getStages()[0]!.name).toBe("b");
    });

    it("unregisterStage returns false for unknown name", () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      expect(pipeline.unregisterStage("unknown")).toBe(false);
    });
  });

  describe("execute()", () => {
    it("executes stages in order", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      const order: string[] = [];

      pipeline.registerStage(makeStage("first", async (ctx) => {
        order.push("first");
        return ctx;
      }));
      pipeline.registerStage(makeStage("second", async (ctx) => {
        order.push("second");
        return ctx;
      }));

      const result = await pipeline.execute(makeContext());
      expect(order).toEqual(["first", "second"]);
      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toEqual(["first", "second"]);
    });

    it("returns success when all stages pass", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      pipeline.registerStage(makeStage("ok"));
      const result = await pipeline.execute(makeContext());
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("stops on stage failure", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      const order: string[] = [];

      pipeline.registerStage(makeStage("before-fail", async (ctx) => {
        order.push("before-fail");
        return ctx;
      }));
      pipeline.registerStage(makeStage("failing", async () => {
        throw new Error("stage failed");
      }));
      pipeline.registerStage(makeStage("after-fail", async (ctx) => {
        order.push("after-fail");
        return ctx;
      }));

      const result = await pipeline.execute(makeContext());
      expect(order).toEqual(["before-fail"]);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.stage).toBe("failing");
      expect(result.errors[0]!.message).toBe("stage failed");
      expect(result.errors[0]!.recoverable).toBe(false);
      expect(result.stagesCompleted).toEqual(["before-fail"]);
    });

    it("collects errors without breaking on recoverable error (not yet implemented - non-recoverable breaks)", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);

      pipeline.registerStage(makeStage("failing", async () => {
        throw new Error("boom");
      }));
      pipeline.registerStage(makeStage("after", async (ctx) => ctx));

      const result = await pipeline.execute(makeContext());
      expect(result.success).toBe(false);
      expect(result.stagesCompleted).not.toContain("after");
    });

    it("skips 'write' stage in dryRun mode", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      const order: string[] = [];

      pipeline.registerStage(makeStage("validate", async (ctx) => {
        order.push("validate");
        return ctx;
      }));
      pipeline.registerStage(makeStage("write", async (ctx) => {
        order.push("write");
        return ctx;
      }));

      const result = await pipeline.execute(makeContext({
        options: {
          force: false,
          dryRun: true,
          skipDependencies: false,
          skipTransforms: false,
          skipMerge: false,
          skipValidation: false,
          concurrency: 1,
        },
      }));
      expect(order).toEqual(["validate"]);
      expect(result.stagesCompleted).toContain("validate");
      expect(result.stagesCompleted).toContain("write");
    });

    it("returns resourceId, version, destination", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      pipeline.registerStage(makeStage("stage1"));

      const result = await pipeline.execute(makeContext({
        resourceId: "plugin-x",
        version: "3.0.0",
        destination: "/dest",
      }));
      expect(result.resourceId).toBe("plugin-x");
      expect(result.version).toBe("3.0.0");
      expect(result.destination).toBe("/dest");
    });

    it("records duration", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      pipeline.registerStage(makeStage("stage1"));

      const result = await pipeline.execute(makeContext());
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("handles non-Error thrown values", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      pipeline.registerStage(makeStage("throw-string", async () => {
        throw "string error";
      }));

      const result = await pipeline.execute(makeContext());
      expect(result.errors[0]!.message).toBe("string error");
    });
  });

  describe("rollback()", () => {
    it("calls rollback on stages in reverse order", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      const rollbackOrder: string[] = [];

      pipeline.registerStage(makeStage("stage1", undefined, async (ctx) => {
        rollbackOrder.push("stage1");
        return ctx;
      }));
      pipeline.registerStage(makeStage("stage2", undefined, async (ctx) => {
        rollbackOrder.push("stage2");
        return ctx;
      }));

      await pipeline.rollback(makeContext());
      expect(rollbackOrder).toEqual(["stage2", "stage1"]);
    });

    it("skips stages without rollback", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);
      const rollbackOrder: string[] = [];

      pipeline.registerStage(makeStage("no-rollback"));
      pipeline.registerStage(makeStage("with-rollback", undefined, async (ctx) => {
        rollbackOrder.push("with-rollback");
        return ctx;
      }));

      await pipeline.rollback(makeContext());
      expect(rollbackOrder).toEqual(["with-rollback"]);
    });

    it("handles rollback errors gracefully", async () => {
      const events = new EventBus();
      const pipeline = new InstallPipeline(events);

      pipeline.registerStage(makeStage("failing-rollback", undefined, async () => {
        throw new Error("rollback failed");
      }));

      // Should not throw
      await pipeline.rollback(makeContext());
    });
  });

  describe("createInstallPipeline()", () => {
    it("returns an InstallPipeline", () => {
      const events = new EventBus();
      const pipeline = createInstallPipeline(events);
      expect(pipeline).toBeInstanceOf(InstallPipeline);
    });

    it("registers all 11 stages by default", () => {
      const events = new EventBus();
      const pipeline = createInstallPipeline(events);
      const stages = pipeline.getStages();
      expect(stages).toHaveLength(11);
      expect(stages.map((s) => s.name)).toEqual([
        "resolve",
        "compatibility",
        "dependency",
        "download",
        "integrity",
        "variables",
        "transform",
        "merge",
        "write",
        "post-install",
        "report",
      ]);
    });
  });

  describe("pipeline stages", () => {
    it("resolve stage validates manifest", async () => {
      const stage = createResolveStage();
      const ctx = makeContext({ manifest: { id: "test" } });
      const result = await stage.execute(ctx);
      expect(result.resourceId).toBe("res-1");
    });

    it("resolve stage throws for missing manifest", async () => {
      const stage = createResolveStage();
      const ctx = makeContext({ manifest: null });
      await expect(stage.execute(ctx)).rejects.toThrow("Resource manifest not found");
    });

    it("compatibility stage skips when skipValidation is true", async () => {
      const stage = createCompatibilityStage();
      const ctx = makeContext({
        options: {
          force: false,
          dryRun: false,
          skipDependencies: false,
          skipTransforms: false,
          skipMerge: false,
          skipValidation: true,
          concurrency: 1,
        },
      });
      const result = await stage.execute(ctx);
      expect(result.warnings).toHaveLength(0);
    });

    it("dependency stage skips when skipDependencies is true", async () => {
      const stage = createDependencyStage();
      const ctx = makeContext({
        options: {
          force: false,
          dryRun: false,
          skipDependencies: true,
          skipTransforms: false,
          skipMerge: false,
          skipValidation: false,
          concurrency: 1,
        },
      });
      const result = await stage.execute(ctx);
      expect(result.resourceId).toBe("res-1");
    });

    it("download stage creates manifest file", async () => {
      const stage = createDownloadStage();
      const manifest: RegistryResource = {
        id: "test",
        name: "Test",
        displayName: "Test",
        description: "Test resource",
        version: "1.0.0",
        category: "test",
        tags: [],
        author: { name: "Test" },
        manifestPath: "test/manifest.json",
        manifestHash: "",
        dependencies: [],
        keywords: [],
      };
      const ctx = makeContext({ manifest });
      const result = await stage.execute(ctx);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files[0]!.relativePath).toBe("resource.json");
    });

    it("variables stage resolves variables in files", async () => {
      const stage = createVariablesStage();
      const ctx = makeContext({
        variables: { name: "World" },
        files: [
          {
            sourcePath: "test.txt",
            relativePath: "test.txt",
            content: "Hello {{name}}!",
            sha: "",
            size: 0,
            action: "create",
          },
        ],
      });
      const result = await stage.execute(ctx);
      expect(result.files[0]!.content).toBe("Hello World!");
    });

    it("variables stage skips when no variables", async () => {
      const stage = createVariablesStage();
      const ctx = makeContext({
        files: [
          {
            sourcePath: "test.txt",
            relativePath: "test.txt",
            content: "Hello {{name}}!",
            sha: "",
            size: 0,
            action: "create",
          },
        ],
      });
      const result = await stage.execute(ctx);
      expect(result.files[0]!.content).toBe("Hello {{name}}!");
    });

    it("report stage sets endTime", async () => {
      const stage = createReportStage();
      const ctx = makeContext();
      const result = await stage.execute(ctx);
      expect(result.metadata.endTime).toBeDefined();
    });
  });
});
