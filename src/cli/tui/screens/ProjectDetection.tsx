import { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { useWizardContext } from "../context.js";
import { Spinner, Check } from "../components/common/Spinner.js";
import { COLORS } from "../theme.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

type Phase = "detecting" | "showing" | "advancing" | "error";

const DETECT_TIMEOUT = 10000;

export function ProjectDetection(): ReactNode {
  const { hook, data, dispatch, navigate } = useWizardContext();
  const [phase, setPhase] = useState<Phase>("detecting");
  const [errorText, setErrorText] = useState<string | null>(null);

  const inputRef = useRef<RegisteredHandler>(() => {});

  useEffect(() => {
    registerHandlerRef("projectDetection", inputRef);

    const abortController = new AbortController();
    let cancelled = false;

    const timeout = setTimeout(() => {
      if (!cancelled) {
        abortController.abort();
        setPhase("error");
        setErrorText("Project detection timed out");
      }
    }, DETECT_TIMEOUT);

    async function detect() {
      try {
        const project = await hook.detectProject();
        if (cancelled) return;

        clearTimeout(timeout);
        dispatch({ type: "SET_PROJECT", project });
        setPhase("showing");

        setTimeout(() => {
          if (!cancelled) {
            setPhase("advancing");
            navigate.goto("mainMenu");
          }
        }, 1200);
      } catch {
        if (cancelled) return;
        clearTimeout(timeout);
        dispatch({ type: "SET_PROJECT", project: null });
        setPhase("showing");

        setTimeout(() => {
          if (!cancelled) navigate.goto("mainMenu");
        }, 600);
      }
    }

    detect();

    return () => {
      cancelled = true;
      abortController.abort();
      clearTimeout(timeout);
      unregisterHandlerRef("projectDetection");
    };
  }, []);

  inputRef.current = (_input, key) => {
    if (key.escape || (key.ctrl && _input === "c")) {
      navigate.goto("mainMenu");
    }
  };

  const project = data.detectedProject;

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Project Detection
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column" gap={0}>
        {phase === "detecting" && (
          <Spinner label="Scanning project files..." />
        )}
        {phase === "error" && (
          <Box flexDirection="column" gap={0}>
            <Text color={COLORS.error}>{errorText}</Text>
            <Text color={COLORS.textMuted} dimColor>Press Escape to continue</Text>
          </Box>
        )}
        {phase !== "detecting" && phase !== "error" && project !== null && (
          <>
            {project.frameworks.map((f) => (
              <Check key={f.type} label={String(f.type)} success />
            ))}
            {project.typescript && <Check label="TypeScript" success />}
            {project.bundler !== "unknown" && <Check label={project.bundler} success />}
            {project.styling !== "unknown" && <Check label={project.styling} success />}
            {project.testing !== "unknown" && <Check label={project.testing} success />}
          </>
        )}
        {phase !== "detecting" && phase !== "error" && project === null && (
          <Text color={COLORS.textMuted} dimColor>No project detected</Text>
        )}
      </Box>
    </Box>
  );
}
