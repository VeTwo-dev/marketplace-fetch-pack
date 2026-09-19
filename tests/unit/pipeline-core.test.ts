import { describe, it, expect, beforeEach } from "vitest";
import { InstallPipeline, createInstallPipeline } from "../../src/pipeline/core.js";
import { EventBus } from "../../src/events/index.js";
import { createLogger } from "../../src/logger/index.js";
import type {
  PipelineContext,
  PipelineResult,
  PipelineStage,
} from "../../src/types/pipeline.js";

const logger = createLogger({ prefix: "test", level: "silent" });

function defaultOptions(): PipelineContext["options"] {
  return {
    force: false,
    dryRun: false,
    skipDependencies: false,
    skipTransforms: false,
    skipMerge: false,
    skipValidation: false,
    concurrency: 4,
  };
}

function makeContext(
  overrides: Partial<PipelineContext> = {},
): PipelineContext {
  return {
    resourceId: "test-resource",
    version: "1.0.0",
    destination: "/tmp/target",
    variables: {},
    options: defaultOptions(),
    manifest: null,
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

function makeStage(
  name: string,
  fn: (ctx: PipelineContext) => Promise<PipelineContext>,
  rollbackFn?: (ctx: PipelineContext) => Promise<PipelineContext>,
): PipelineStage {
  return {
    name,
    execute: fn,
    rollback: rollbackFn,
  };
}

describe("InstallPipeline", () => {
  let events: EventBus;

  beforeEach(() => {
    events = new EventBus(logger);
  });

  it("runs a single stage", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("test", async (ctx) => ({
        ...ctx,
        metadata: { ...ctx.metadata, filesProcessed: 1 },
      })),
    );
    const result = await pipeline.execute(makeContext());
    expect(result.success).toBe(true);
    expect(result.stagesCompleted).toContain("test");
  });

  it("runs multiple stages in order", async () => {
    const order: string[] = [];
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("first", async (ctx) => {
        order.push("first");
        return ctx;
      }),
    );
    pipeline.registerStage(
      makeStage("second", async (ctx) => {
        order.push("second");
        return ctx;
      }),
    );
    pipeline.registerStage(
      makeStage("third", async (ctx) => {
        order.push("third");
        return ctx;
      }),
    );
    const result = await pipeline.execute(makeContext());
    expect(result.success).toBe(true);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("returns failure on stage error", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("fail", async () => {
        throw new Error("stage failed");
      }),
    );
    const result = await pipeline.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("stage failed");
  });

  it("executes rollback stages on failure", async () => {
    const rollbacks: string[] = [];
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage(
        "step1",
        async (ctx) => ctx,
        async (ctx) => {
          rollbacks.push("step1");
          return ctx;
        },
      ),
    );
    pipeline.registerStage(
      makeStage(
        "step2",
        async (ctx) => ctx,
        async (ctx) => {
          rollbacks.push("step2");
          return ctx;
        },
      ),
    );
    pipeline.registerStage(
      makeStage("fail", async () => {
        throw new Error("boom");
      }),
    );
    const result = await pipeline.execute(makeContext());
    expect(result.success).toBe(false);
    expect(rollbacks).toContain("step2");
    expect(rollbacks).toContain("step1");
  });

  it("rolls back in reverse order", async () => {
    const rollbacks: string[] = [];
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage(
        "s1",
        async (ctx) => ctx,
        async (ctx) => {
          rollbacks.push("s1");
          return ctx;
        },
      ),
    );
    pipeline.registerStage(
      makeStage(
        "s2",
        async (ctx) => ctx,
        async (ctx) => {
          rollbacks.push("s2");
          return ctx;
        },
      ),
    );
    pipeline.registerStage(
      makeStage("fail", async () => {
        throw new Error("fail");
      }),
    );
    await pipeline.execute(makeContext());
    expect(rollbacks[0]).toBe("s2");
    expect(rollbacks[1]).toBe("s1");
  });

  it("does not run stages after failure", async () => {
    const ran: string[] = [];
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("ok", async (ctx) => {
        ran.push("ok");
        return ctx;
      }),
    );
    pipeline.registerStage(
      makeStage("fail", async () => {
        throw new Error("fail");
      }),
    );
    pipeline.registerStage(
      makeStage("after", async (ctx) => {
        ran.push("after");
        return ctx;
      }),
    );
    await pipeline.execute(makeContext());
    expect(ran).not.toContain("after");
  });

  it("emits beforePipelineStage and afterPipelineStage events", async () => {
    const eventsFired: string[] = [];
    events.on("beforePipelineStage", (data: { stage: string }) => {
      eventsFired.push(`before:${data.stage}`);
    });
    events.on("afterPipelineStage", (data: { stage: string }) => {
      eventsFired.push(`after:${data.stage}`);
    });
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(makeStage("s1", async (ctx) => ctx));
    await pipeline.execute(makeContext());
    expect(eventsFired).toContain("before:s1");
    expect(eventsFired).toContain("after:s1");
  });

  it("records stages completed in result", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(makeStage("s1", async (ctx) => ctx));
    pipeline.registerStage(makeStage("s2", async (ctx) => ctx));
    const result = await pipeline.execute(makeContext());
    expect(result.stagesCompleted).toContain("s1");
    expect(result.stagesCompleted).toContain("s2");
  });

  it("deep clones context between stages", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("first", async (ctx) => ({
        ...ctx,
        metadata: { ...ctx.metadata, filesProcessed: 10 },
      })),
    );
    pipeline.registerStage(
      makeStage("second", async (ctx) => {
        expect(ctx.metadata.filesProcessed).toBe(10);
        return ctx;
      }),
    );
    const result = await pipeline.execute(makeContext());
    expect(result.success).toBe(true);
  });

  it("continues rollback even if a rollback stage fails", async () => {
    const rollbacks: string[] = [];
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage(
        "s1",
        async (ctx) => ctx,
        async (ctx) => {
          rollbacks.push("s1");
          return ctx;
        },
      ),
    );
    pipeline.registerStage(
      makeStage(
        "s2",
        async (ctx) => ctx,
        async () => {
          throw new Error("rollback fail");
        },
      ),
    );
    pipeline.registerStage(
      makeStage(
        "s3",
        async (ctx) => ctx,
        async (ctx) => {
          rollbacks.push("s3");
          return ctx;
        },
      ),
    );
    pipeline.registerStage(
      makeStage("fail", async () => {
        throw new Error("fail");
      }),
    );
    await pipeline.execute(makeContext());
    expect(rollbacks).toContain("s3");
  });

  it("registerStage replaces existing stage with same name", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("s1", async (ctx) => ({
        ...ctx,
        metadata: { ...ctx.metadata, filesProcessed: 1 },
      })),
    );
    pipeline.registerStage(
      makeStage("s1", async (ctx) => ({
        ...ctx,
        metadata: { ...ctx.metadata, filesProcessed: 2 },
      })),
    );
    const result = await pipeline.execute(makeContext());
    expect(result.stagesCompleted).toHaveLength(1);
    expect(result.stagesCompleted).toContain("s1");
  });

  it("unregisterStage removes a stage", () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(makeStage("s1", async (ctx) => ctx));
    pipeline.registerStage(makeStage("s2", async (ctx) => ctx));
    const removed = pipeline.unregisterStage("s2");
    expect(removed).toBe(true);
    const stages = pipeline.getStages();
    expect(stages).toHaveLength(1);
    expect(stages[0].name).toBe("s1");
  });

  it("unregisterStage returns false for unknown name", () => {
    const pipeline = new InstallPipeline(events, logger);
    const removed = pipeline.unregisterStage("unknown");
    expect(removed).toBe(false);
  });

  it("getStages returns all registered stages", () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(makeStage("a", async (ctx) => ctx));
    pipeline.registerStage(makeStage("b", async (ctx) => ctx));
    const stages = pipeline.getStages();
    expect(stages).toHaveLength(2);
    expect(stages.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("returns duration in result", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(makeStage("s1", async (ctx) => ctx));
    const result = await pipeline.execute(makeContext());
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("includes resourceId and version in result", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(makeStage("s1", async (ctx) => ctx));
    const result = await pipeline.execute(
      makeContext({ resourceId: "my-pkg", version: "2.0.0" }),
    );
    expect(result.resourceId).toBe("my-pkg");
    expect(result.version).toBe("2.0.0");
  });

  it("collects warnings from context", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("warn", async (ctx) => ({
        ...ctx,
        warnings: [...ctx.warnings, "something odd"],
      })),
    );
    const result = await pipeline.execute(makeContext());
    expect(result.warnings).toContain("something odd");
  });

  it("collects errors from context", async () => {
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("err", async (ctx) => ({
        ...ctx,
        errors: [
          ...ctx.errors,
          { stage: "err", message: "bad", recoverable: false },
        ],
      })),
    );
    const result = await pipeline.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toBe("bad");
  });

  it("skips write stage in dryRun mode", async () => {
    const ran: string[] = [];
    const pipeline = new InstallPipeline(events, logger);
    pipeline.registerStage(
      makeStage("pre", async (ctx) => {
        ran.push("pre");
        return ctx;
      }),
    );
    pipeline.registerStage(
      makeStage("write", async (ctx) => {
        ran.push("write");
        return ctx;
      }),
    );
    const result = await pipeline.execute(
      makeContext({ options: { ...defaultOptions(), dryRun: true } }),
    );
    expect(ran).toContain("pre");
    expect(ran).not.toContain("write");
    expect(result.stagesCompleted).toContain("write");
  });
});

describe("createInstallPipeline", () => {
  it("creates a pipeline with default stages", () => {
    const events = new EventBus(logger);
    const pipeline = createInstallPipeline(events, logger);
    expect(pipeline).toBeInstanceOf(InstallPipeline);
    const stages = pipeline.getStages();
    expect(stages.length).toBeGreaterThan(0);
  });
});
