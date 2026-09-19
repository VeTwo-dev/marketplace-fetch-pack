import { useState, useEffect, useRef } from "react";
import { Box, Text, useStdout } from "ink";
import { useWizardContext } from "../context.js";
import { COLORS } from "../theme.js";
import {
  registerHandlerRef,
  unregisterHandlerRef,
} from "../core/KeyboardRouter.js";
import { getLogoSize, loadLogo } from "../core/LogoEngine.js";
import { usePulse } from "../core/AnimationEngine.js";
import { runStartup, formatStartupSummary } from "../core/StartupEngine.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { StartupEvent } from "../core/StartupEngine.js";
import type { ReactNode } from "react";

const STAGE_LABELS: Record<string, string> = {
  config: "Loading Configuration",
  cache: "Initializing Cache",
  github: "Loading Registry",
  registry: "Loading Registry",
  search: "Building Search Index",
  project: "Detecting Project",
  ready: "Marketplace Ready",
};

const STAGE_ORDER: ReadonlyArray<string> = [
  "config",
  "cache",
  "github",
  "registry",
  "search",
  "project",
  "ready",
];

interface StageState {
  readonly status: string;
  readonly duration: number;
  readonly error?: string;
}

export function Splash(): ReactNode {
  const { hook, dispatch, navigate } = useWizardContext();
  const { stdout } = useStdout();

  const startTime = useRef(Date.now());
  const [stageStates, setStageStates] = useState<Record<string, StageState>>(
    {},
  );
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [cachedAvailable, setCachedAvailable] = useState(false);
  const [aborted, setAborted] = useState(false);

  const logoSize = getLogoSize(stdout.columns);
  const logoContent = loadLogo(logoSize);

  const pulseColor = usePulse(120);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const abortRef = useRef<AbortController | null>(null);

  const debugMode = process.env.MARKETPLACE_DEBUG !== undefined;

  useEffect(() => {
    if (ready) return;
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime.current);
    }, 100);
    return () => clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    registerHandlerRef("splash", inputRef);

    const abortController = new AbortController();
    abortRef.current = abortController;

    let cancelled = false;

    function handleEvent(event: StartupEvent) {
      if (cancelled) return;
      setStageStates((prev) => ({
        ...prev,
        [event.stage]: {
          status: event.status,
          duration: event.duration,
          error: event.error,
        },
      }));
    }

    async function boot() {
      const result = await runStartup({
        hook,
        dispatch,
        onEvent: handleEvent,
        signal: abortController.signal,
        debug: debugMode,
      });

      if (cancelled) return;

      if (debugMode) {
        const summary = formatStartupSummary(
          result.stages,
          result.totalDuration,
          true,
        );
        for (const line of summary.split("\n")) {
          process.stderr.write(line + "\n");
        }
      }

      if (result.success) {
        const total = Date.now() - startTime.current;
        setElapsed(total);
        setReady(true);

        const remaining = Math.max(0, 500 - total);
        await new Promise((r) => setTimeout(r, remaining));
        if (!cancelled) navigateRef.current.goto("mainMenu");
      } else {
        setErrorMsg(result.error ?? "Startup failed");
        setOfflineAvailable(result.offlineAvailable);
        setCachedAvailable(result.cachedAvailable);
      }
    }

    boot();

    return () => {
      cancelled = true;
      abortController.abort();
      unregisterHandlerRef("splash");
    };
  }, []);

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (_input, key) => {
    if (key.ctrl && _input === "c") {
      abortRef.current?.abort();
      setAborted(true);
      setErrorMsg("Startup cancelled");
    }
    if (key.escape && (errorMsg !== null || aborted)) {
      process.exit(0);
    }
  };

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      paddingX={3}
    >
      <Box flexDirection="column" alignItems="center" gap={1}>
        <Text bold color={pulseColor}>
          {logoContent}
        </Text>
        <Text color={COLORS.textMuted} dimColor>
          Resource Manager
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1} gap={1}>
        {STAGE_ORDER.map((stageId) => {
          const state = stageStates[stageId];
          if (state === undefined) {
            return (
              <Box key={stageId} gap={1}>
                <Text color={COLORS.textMuted}>○</Text>
                <Text color={COLORS.textMuted} dimColor>
                  {STAGE_LABELS[stageId] ?? stageId}
                </Text>
              </Box>
            );
          }
          const done = state.status === "success";
          const active = state.status === "running";
          const failed =
            state.status === "failed" || state.status === "timeout";
          const color = done
            ? COLORS.success
            : active
              ? COLORS.accent
              : failed
                ? COLORS.error
                : COLORS.textMuted;
          const prefix = done ? "✔" : active ? "▶" : failed ? "✖" : "○";
          return (
            <Box key={stageId} gap={1}>
              <Text color={color} bold={active || done || failed}>
                {prefix}
              </Text>
              <Text color={color} dimColor={!active && !done && !failed}>
                {STAGE_LABELS[stageId] ?? stageId}
              </Text>
              {state.duration > 0 && done && (
                <Text color={COLORS.textMuted} dimColor>
                  {" "}
                  ({(state.duration / 1000).toFixed(1)}s)
                </Text>
              )}
              {state.error !== undefined && (
                <Text color={COLORS.error} dimColor>
                  {" "}
                  {state.error}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        {ready ? (
          <Text bold color={COLORS.success}>
            Ready in {(elapsed / 1000).toFixed(1)}s
          </Text>
        ) : errorMsg !== null ? (
          <Box flexDirection="column" alignItems="center" gap={1}>
            <Text color={COLORS.error}>{errorMsg}</Text>
            {(offlineAvailable || cachedAvailable) && (
              <Text color={COLORS.textSecondary}>
                Press R to retry, O for offline mode
              </Text>
            )}
          </Box>
        ) : (
          <Text color={COLORS.textMuted} dimColor>
            {(elapsed / 1000).toFixed(1)}s
          </Text>
        )}
      </Box>
    </Box>
  );
}
