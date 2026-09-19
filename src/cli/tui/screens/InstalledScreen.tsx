import { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { Spinner } from "../components/common/Spinner.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

type Phase = "loading" | "loaded" | "error";

const LOAD_TIMEOUT = 30000;

export function InstalledScreen(): ReactNode {
  const { hook, navigate } = useWizardContext();
  const [phase, setPhase] = useState<Phase>("loading");
  const [installed, setInstalled] = useState<ReadonlyArray<string>>([]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (_input, key) => {
    if (key.escape) navigateRef.current.pop();
  };

  useEffect(() => {
    registerHandlerRef("installed", inputRef, "Esc Back");

    const abortController = new AbortController();
    let cancelled = false;

    const timeout = setTimeout(() => {
      if (!cancelled) {
        abortController.abort();
        setPhase("error");
      }
    }, LOAD_TIMEOUT);

    async function load() {
      try {
        const list = await hook.getResources();
        if (cancelled) return;
        clearTimeout(timeout);
        setInstalled(list.map((r) => r.id));
        setPhase("loaded");
      } catch {
        if (cancelled) return;
        clearTimeout(timeout);
        setInstalled([]);
        setPhase("loaded");
      }
    }
    load();

    return () => {
      cancelled = true;
      abortController.abort();
      clearTimeout(timeout);
      unregisterHandlerRef("installed");
    };
  }, []);

  if (phase === "loading") {
    return (
      <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
        <Text bold color={COLORS.text}>Installed Resources</Text>
        <Box marginTop={1}>
          <Spinner label="Loading installed resources..." />
        </Box>
      </Box>
    );
  }

  if (phase === "error") {
    return (
      <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
        <Text bold color={COLORS.text}>Installed Resources</Text>
        <Box marginTop={1}>
          <Text color={COLORS.textMuted} dimColor>Failed to load resources</Text>
          <Text color={COLORS.textMuted} dimColor>Press Escape to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Installed Resources
        </Text>
        <Text color={COLORS.textMuted} dimColor>
          {installed.length} installed
        </Text>
      </Box>

      {installed.length === 0 ? (
        <Box marginTop={1}>
          <Text color={COLORS.textMuted} dimColor>No resources installed yet</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column" gap={0}>
          {installed.map((id) => (
            <Text key={id} color={COLORS.textSecondary}>
              {id}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
