import { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { StepIndicator } from "../components/common/Spinner.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

type Phase = "downloading" | "installing" | "validating" | "complete";

const PHASES: ReadonlyArray<{ key: Phase; label: string }> = [
  { key: "downloading", label: "Downloading" },
  { key: "installing", label: "Installing" },
  { key: "validating", label: "Validating" },
  { key: "complete", label: "Complete" },
];

export function InstallProgressScreen(): ReactNode {
  const { hook, data, dispatch, navigate } = useWizardContext();
  const [phase, setPhase] = useState<Phase>("downloading");
  const [progress, setProgress] = useState(0);
  const resource = data.selectedResource;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const hookRef = useRef(hook);
  hookRef.current = hook;
  const resourceRef = useRef(resource);
  resourceRef.current = resource;

  const inputRef = useRef<RegisteredHandler>(() => {});

  useEffect(() => {
    registerHandlerRef("installProgress", inputRef);

    const abortController = new AbortController();
    let cancelled = false;

    async function install() {
      if (resourceRef.current === null) return;

      const startTime = Date.now();

      try {
        setPhase("downloading");
        for (let p = 0; p <= 100; p += 10) {
          if (cancelled) return;
          setProgress(p);
          await new Promise((r) => setTimeout(r, 50));
        }

        setPhase("installing");
        setProgress(0);
        for (let p = 0; p <= 100; p += 5) {
          if (cancelled) return;
          setProgress(p);
          await new Promise((r) => setTimeout(r, 40));
        }

        setPhase("validating");
        setProgress(0);
        for (let p = 0; p <= 100; p += 20) {
          if (cancelled) return;
          setProgress(p);
          await new Promise((r) => setTimeout(r, 30));
        }

        const result = await hookRef.current.install(resourceRef.current.id);
        const duration = Date.now() - startTime;

        if (!cancelled) {
          dispatchRef.current({
            type: "SET_INSTALL_RESULT",
            result: {
              success: result.success,
              message: result.message,
              filesInstalled: 0,
              dependenciesInstalled: 0,
              duration,
            },
          });
          setPhase("complete");
          setTimeout(() => {
            if (!cancelled) navigateRef.current.goto("success");
          }, 500);
        }
      } catch (error) {
        if (!cancelled) {
          dispatchRef.current({
            type: "SET_INSTALL_RESULT",
            result: {
              success: false,
              message: error instanceof Error ? error.message : String(error),
              filesInstalled: 0,
              dependenciesInstalled: 0,
              duration: Date.now() - startTime,
            },
          });
          navigateRef.current.goto("success");
        }
      }
    }

    install();
    return () => {
      cancelled = true;
      abortController.abort();
      unregisterHandlerRef("installProgress");
    };
  }, []);

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Installing {resource?.displayName ?? resource?.name ?? "resource"}...
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column" gap={1}>
        {PHASES.map((p) => {
          const phaseIdx = PHASES.findIndex((x) => x.key === p.key);
          const currentIdx = PHASES.findIndex((x) => x.key === phase);
          const status: "pending" | "current" | "complete" =
            phaseIdx < currentIdx ? "complete" : phaseIdx === currentIdx ? "current" : "pending";
          return (
            <StepIndicator
              key={p.key}
              label={p.label}
              phase={status}
              progress={status === "current" ? progress : undefined}
            />
          );
        })}
      </Box>
    </Box>
  );
}
