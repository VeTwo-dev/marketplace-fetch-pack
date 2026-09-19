import { useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

export function ErrorScreen(): ReactNode {
  const { data, navigate } = useWizardContext();

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (_input, key) => {
    if (key.escape) {
      if (navigateRef.current.canGoBack()) {
        navigateRef.current.pop();
      } else {
        navigateRef.current.home();
      }
    }
  };

  useEffect(() => {
    registerHandlerRef("error", inputRef, "Esc Back  │  Ctrl+C Quit");
    return () => unregisterHandlerRef("error");
  }, []);

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Text bold color={COLORS.error}>
        ✖ Error
      </Text>
      <Box marginTop={1}>
        <Text color={COLORS.textSecondary}>
          {data.registryStatus === "error"
            ? "Failed to connect to the marketplace registry."
            : "An unexpected error occurred."}
        </Text>
        <Box marginTop={1}>
          <Text color={COLORS.textMuted} dimColor>
            Check your internet connection and try again.
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
