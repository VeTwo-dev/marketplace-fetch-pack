import type {
  PipelineStage,
  PipelineContext,
  PipelineResult,
  PipelineError,
} from "../types/pipeline.js";
import type { EventBus } from "../events/index.js";
import { createLogger, type Logger } from "../logger/index.js";
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
} from "./stages/index.js";

function deepCloneContext(context: PipelineContext): PipelineContext {
  return {
    ...context,
    files: context.files.map((f) => ({ ...f })),
    errors: context.errors.map((e) => ({ ...e })),
    warnings: [...context.warnings],
    metadata: { ...context.metadata },
    variables: { ...context.variables },
  };
}

export class InstallPipeline {
  private readonly _stages: Array<PipelineStage> = [];
  private readonly _events: EventBus;
  private readonly _logger: Logger;

  constructor(events: EventBus, logger?: Logger) {
    this._events = events;
    this._logger = logger ?? createLogger({ prefix: "pipeline" });
  }

  registerStage(stage: PipelineStage): void {
    const existing = this._stages.findIndex((s) => s.name === stage.name);
    if (existing >= 0) {
      this._stages[existing] = stage;
    } else {
      this._stages.push(stage);
    }
  }

  unregisterStage(name: string): boolean {
    const index = this._stages.findIndex((s) => s.name === name);
    if (index < 0) return false;
    this._stages.splice(index, 1);
    return true;
  }

  getStages(): ReadonlyArray<PipelineStage> {
    return this._stages;
  }

  async execute(context: PipelineContext): Promise<PipelineResult> {
    const startTime = Date.now();
    const stagesCompleted: Array<string> = [];
    let currentContext = deepCloneContext(context);
    let failed = false;

    for (const stage of this._stages) {
      if (currentContext.options.dryRun && stage.name === "write") {
        stagesCompleted.push(stage.name);
        continue;
      }

      this._logger.debug(`Executing pipeline stage: ${stage.name}`);

      await this._events.emit("beforePipelineStage", {
        stage: stage.name,
        resourceId: currentContext.resourceId,
      });

      const stageStart = Date.now();

      try {
        currentContext = await stage.execute(currentContext);
        stagesCompleted.push(stage.name);

        currentContext = {
          ...currentContext,
          metadata: {
            ...currentContext.metadata,
            stagesCompleted: [...stagesCompleted],
          },
        };

        await this._events.emit("afterPipelineStage", {
          stage: stage.name,
          resourceId: currentContext.resourceId,
          duration: Date.now() - stageStart,
          success: true,
        });
      } catch (error) {
        const pipelineError: PipelineError = {
          stage: stage.name,
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        };
        currentContext.errors.push(pipelineError);

        await this._events.emit("afterPipelineStage", {
          stage: stage.name,
          resourceId: currentContext.resourceId,
          duration: Date.now() - stageStart,
          success: false,
        });

        this._logger.error(`Pipeline stage failed: ${stage.name}`, {
          error: pipelineError.message,
        });

        failed = true;
        break;
      }
    }

    if (failed && !currentContext.options.dryRun) {
      this._logger.info("Pipeline failed, rolling back", {
        resourceId: currentContext.resourceId,
      });
      await this.rollback(currentContext);
    }

    const filesWritten = currentContext.files
      .filter(
        (f) =>
          f.action === "create" ||
          f.action === "overwrite" ||
          f.action === "merge",
      )
      .map((f) => f.targetPath ?? f.relativePath);

    return {
      success: currentContext.errors.length === 0,
      resourceId: currentContext.resourceId,
      version: currentContext.version,
      destination: currentContext.destination,
      filesWritten,
      stagesCompleted,
      duration: Date.now() - startTime,
      errors: currentContext.errors,
      warnings: currentContext.warnings,
      snapshotId: currentContext.snapshot?.id ?? null,
    };
  }

  async rollback(context: PipelineContext): Promise<void> {
    for (let i = this._stages.length - 1; i >= 0; i--) {
      const stage = this._stages[i]!;
      if (stage.rollback !== undefined) {
        this._logger.debug(`Rolling back stage: ${stage.name}`);
        try {
          await this._events.emit("beforeRollback", {
            snapshotId: context.snapshot?.id ?? "",
            reason: "Pipeline failure",
          });
          context = await stage.rollback(context);
          await this._events.emit("afterRollback", {
            snapshotId: context.snapshot?.id ?? "",
            filesRestored: 0,
            success: true,
          });
        } catch (rollbackError) {
          this._logger.error(`Rollback failed for stage: ${stage.name}`, {
            error:
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
          });
        }
      }
    }
  }
}

export interface InstallPipelineOptions {
  /** Shared transform registry — enables per-resource-type transforms */
  readonly transformRegistry?: import("../types/transform.js").TransformRegistry;
  /** Resource type registry — resolves per-type transforms/merge strategies */
  readonly typeRegistry?: import("../resource-types/index.js").ResourceTypeRegistry;
}

export function createInstallPipeline(
  events: EventBus,
  logger?: Logger,
  options?: InstallPipelineOptions,
): InstallPipeline {
  const pipeline = new InstallPipeline(events, logger);

  const childLogger = logger?.child?.("pipeline");

  pipeline.registerStage(createResolveStage(childLogger));
  pipeline.registerStage(createCompatibilityStage(childLogger));
  pipeline.registerStage(createDependencyStage(childLogger));
  pipeline.registerStage(createDownloadStage(childLogger));
  pipeline.registerStage(createIntegrityStage(childLogger));
  pipeline.registerStage(createVariablesStage(childLogger));
  pipeline.registerStage(
    createTransformStage(childLogger, {
      transformRegistry: options?.transformRegistry,
      typeRegistry: options?.typeRegistry,
    }),
  );
  pipeline.registerStage(
    createMergeStage(childLogger, { typeRegistry: options?.typeRegistry }),
  );
  pipeline.registerStage(createWriteStage(childLogger));
  pipeline.registerStage(createPostInstallStage(childLogger));
  pipeline.registerStage(createReportStage(childLogger));

  return pipeline;
}
