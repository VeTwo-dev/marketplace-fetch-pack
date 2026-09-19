import { withTimeout, TimeoutError } from "./TimeoutController.js";
import type { MarketplaceHook } from "../hooks/useMarketplace.js";
import type { Dispatch } from "react";
import type { WizardAction } from "../state.js";

export type StageId =
  "config" | "cache" | "github" | "registry" | "search" | "project" | "ready";

type StageStatus =
  "pending" | "running" | "success" | "failed" | "timeout" | "skipped";

export interface StageResult {
  readonly id: StageId;
  readonly status: StageStatus;
  readonly duration: number;
  readonly error?: string;
  readonly retries?: number;
}

export interface StartupEvent {
  readonly stage: StageId;
  readonly status: StageStatus;
  readonly duration: number;
  readonly label: string;
  readonly error?: string;
}

type StartupEventCallback = (event: StartupEvent) => void;

interface StageDefinition {
  readonly id: StageId;
  readonly label: string;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly retryDelay: number;
  readonly dependsOn?: ReadonlyArray<StageId>;
}

const STAGES: ReadonlyArray<StageDefinition> = [
  {
    id: "config",
    label: "Loading Configuration",
    timeout: 5000,
    maxRetries: 0,
    retryDelay: 0,
  },
  {
    id: "cache",
    label: "Initializing Cache",
    timeout: 5000,
    maxRetries: 0,
    retryDelay: 0,
  },
  {
    id: "github",
    label: "Loading Registry",
    timeout: 15000,
    maxRetries: 2,
    retryDelay: 1000,
  },
  {
    id: "registry",
    label: "Loading Registry",
    timeout: 10000,
    maxRetries: 0,
    retryDelay: 0,
  },
  {
    id: "search",
    label: "Building Search Index",
    timeout: 3000,
    maxRetries: 0,
    retryDelay: 0,
  },
  {
    id: "project",
    label: "Detecting Project",
    timeout: 3000,
    maxRetries: 1,
    retryDelay: 500,
  },
  {
    id: "ready",
    label: "Marketplace Ready",
    timeout: 500,
    maxRetries: 0,
    retryDelay: 0,
  },
];

export interface StartupOptions {
  readonly hook: MarketplaceHook;
  readonly dispatch: Dispatch<WizardAction>;
  readonly onEvent: StartupEventCallback;
  readonly signal?: AbortSignal;
  readonly debug?: boolean;
}

export interface StartupResult {
  readonly success: boolean;
  readonly stages: ReadonlyArray<StageResult>;
  readonly totalDuration: number;
  readonly error?: string;
  readonly offlineAvailable: boolean;
  readonly cachedAvailable: boolean;
}

function debugLog(msg: string): void {
  if (process.env.MARKETPLACE_DEBUG !== undefined) {
    process.stderr.write(`[STARTUP] ${msg}\n`);
  }
}

async function runStage(
  stage: StageDefinition,
  hook: MarketplaceHook,
  dispatch: Dispatch<WizardAction>,
  signal: AbortSignal | undefined,
  onEvent: StartupEventCallback,
): Promise<StageResult> {
  const startTime = performance.now();
  let lastError: string | undefined;
  const retries = 0;
  let status: StageStatus = "pending";

  function emit(s: StageStatus, error?: string) {
    onEvent({
      stage: stage.id,
      status: s,
      duration: performance.now() - startTime,
      label: stage.label,
      error,
    });
  }

  for (let attempt = 0; attempt <= stage.maxRetries; attempt++) {
    if (signal?.aborted) {
      emit("skipped", "Cancelled");
      return {
        id: stage.id,
        status: "skipped",
        duration: performance.now() - startTime,
      };
    }

    if (attempt > 0) {
      debugLog(
        `Retrying ${stage.id} (attempt ${attempt + 1}/${stage.maxRetries + 1})`,
      );
      await new Promise((r) => setTimeout(r, stage.retryDelay));
    }

    try {
      emit("running");
      status = "running";

      switch (stage.id) {
        case "config":
          // Config is loaded by App.tsx before mount — no-op here
          break;
        case "cache":
          // Cache is initialized inside marketplace.load() — no-op
          break;
        case "github": {
          // Full startup: load registry + retrieve categories/resources
          await withTimeout(hook.load(), stage.timeout, stage.id);
          const [categories, resources] = await withTimeout(
            Promise.all([hook.getCategories(), hook.getResources()]),
            stage.timeout,
            stage.id,
          );
          dispatch({
            type: "BATCH_SET_DATA",
            categories,
            resources,
            project: null,
          });
          dispatch({ type: "SET_REGISTRY_STATUS", status: "ready" });
          break;
        }
        case "registry":
          // Registry data already loaded in the github stage — no-op
          break;
        case "search":
          // Search index is built inside marketplace.load() — no-op
          break;
        case "project": {
          try {
            const project = await withTimeout(
              hook.detectProject(),
              stage.timeout,
              stage.id,
            );
            dispatch({ type: "SET_PROJECT", project });
          } catch {
            dispatch({ type: "SET_PROJECT", project: null });
          }
          break;
        }
        case "ready":
          break;
      }

      status = "success";
      emit("success");
      return {
        id: stage.id,
        status: "success",
        duration: performance.now() - startTime,
        retries: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      if (error instanceof TimeoutError) {
        status = "timeout";
        debugLog(`${stage.id} timed out after ${stage.timeout}ms`);
      } else {
        status = "failed";
        debugLog(`${stage.id} failed: ${lastError}`);
      }

      if (attempt < stage.maxRetries) {
        emit("running");
        debugLog(`Waiting ${stage.retryDelay}ms before retry`);
        continue;
      }

      emit(status, lastError);
      return {
        id: stage.id,
        status,
        duration: performance.now() - startTime,
        error: lastError,
        retries: attempt,
      };
    }
  }

  emit(status, lastError);
  return {
    id: stage.id,
    status,
    duration: performance.now() - startTime,
    error: lastError,
    retries,
  };
}

export async function runStartup(
  options: StartupOptions,
): Promise<StartupResult> {
  const startTime = performance.now();
  const stageResults: StageResult[] = [];

  if (options.debug) {
    process.env.MARKETPLACE_DEBUG = "1";
  }

  debugLog("Startup pipeline started");

  for (const stage of STAGES) {
    if (options.signal?.aborted) {
      stageResults.push({
        id: stage.id,
        status: "skipped",
        duration: 0,
        error: "Startup aborted",
      });
      continue;
    }

    const result = await runStage(
      stage,
      options.hook,
      options.dispatch,
      options.signal,
      options.onEvent,
    );
    stageResults.push(result);

    if (result.status === "timeout" || result.status === "failed") {
      debugLog(`${stage.id} ended with ${result.status}, stopping pipeline`);

      if (stage.id === "github" || stage.id === "registry") {
        return {
          success: false,
          stages: stageResults,
          totalDuration: performance.now() - startTime,
          error: result.error,
          offlineAvailable: stage.id === "registry",
          cachedAvailable: stage.id === "registry",
        };
      }

      return {
        success: false,
        stages: stageResults,
        totalDuration: performance.now() - startTime,
        error: result.error,
        offlineAvailable: false,
        cachedAvailable: false,
      };
    }
  }

  const totalDuration = performance.now() - startTime;
  const anySuccess = stageResults.some((s) => s.status === "success");
  const allSkipped = stageResults.every((s) => s.status === "skipped");

  debugLog(`Startup complete in ${totalDuration}ms`);

  return {
    success: anySuccess && !allSkipped,
    stages: stageResults,
    totalDuration,
    offlineAvailable: false,
    cachedAvailable: true,
  };
}

export function getStageLabel(id: StageId): string {
  const stage = STAGES.find((s) => s.id === id);
  return stage?.label ?? id;
}

export function formatStartupSummary(
  results: ReadonlyArray<StageResult>,
  totalDuration: number,
  debug: boolean,
): string {
  const lines: string[] = [];

  if (debug) {
    lines.push("");
    lines.push("─".repeat(36));
    lines.push("STARTUP PROFILE");
    lines.push("─".repeat(36));
    for (const r of results) {
      const icon =
        r.status === "success"
          ? "✔"
          : r.status === "failed"
            ? "✖"
            : r.status === "timeout"
              ? "⚠"
              : "○";
      const note =
        r.retries !== undefined && r.retries > 0
          ? ` (${r.retries} retries)`
          : "";
      lines.push(
        `  ${icon} ${r.id.padEnd(12)} ${r.duration.toString().padStart(5)}ms${note}`,
      );
      if (r.error) {
        lines.push(`      ${r.error}`);
      }
    }
    lines.push(`  ${"─".repeat(24)}`);
    lines.push(
      `  TOTAL${" ".repeat(9)} ${totalDuration.toString().padStart(5)}ms`,
    );
    lines.push("");
  }

  return lines.join("\n");
}
