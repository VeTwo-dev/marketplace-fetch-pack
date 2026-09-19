import { useEffect, useState, useRef } from "react";
import { Box, Text } from "ink";
import { SeparatorLine } from "../components/common/Card.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

const ACTIONS = [
  { label: "Confirm Install", value: "confirm" },
  { label: "Back", value: "back" },
];

export function DependencyPreviewScreen(): ReactNode {
  const { data, navigate } = useWizardContext();
  const [actionIndex, setActionIndex] = useState(0);
  const resource = data.selectedResource;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    if (key.upArrow || input === "k") {
      setActionIndex((i) => (i - 1 + ACTIONS.length) % ACTIONS.length);
    } else if (key.downArrow || input === "j") {
      setActionIndex((i) => (i + 1) % ACTIONS.length);
    } else if (key.return) {
      const action = ACTIONS[actionIndex];
      if (action === undefined) return;
      if (action.value === "confirm") {
        navigateRef.current.push("installProgress");
      } else {
        navigateRef.current.pop();
      }
    } else if (key.escape) {
      navigateRef.current.pop();
    }
  };

  useEffect(() => {
    registerHandlerRef("dependencyPreview", inputRef, "↑↓ Navigate  │  Enter Select  │  Esc Back");
    return () => unregisterHandlerRef("dependencyPreview");
  }, []);

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Dependency Preview
        </Text>
        <Text color={COLORS.textMuted} dimColor>
          {resource?.displayName ?? resource?.name ?? "Resource"}
        </Text>
      </Box>

      {resource !== null && resource.dependencies.length > 0 && (
        <Box marginTop={1}>
          <Text bold color={COLORS.text}>Dependencies ({resource.dependencies.length})</Text>
          {resource.dependencies.map((dep) => (
            <Text key={dep.id} color={COLORS.textSecondary}>
              {dep.id}{dep.version !== undefined ? ` ${dep.version}` : ""}
              {dep.optional ? " (optional)" : ""}
            </Text>
          ))}
        </Box>
      )}

      {resource !== null && resource.dependencies.length === 0 && (
        <Box marginTop={1}>
          <Text color={COLORS.textMuted} dimColor>No dependencies</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={COLORS.textMuted} dimColor>
          Files to be added: <Text color={COLORS.textSecondary}>~50-200</Text>
          {", "}Estimated time: <Text color={COLORS.textSecondary}>~3s</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <SeparatorLine />
      </Box>

      <Box flexDirection="column">
        {ACTIONS.map((action, i) => (
          <Box key={action.value} marginBottom={0}>
            <Box width={3} minWidth={3}>
              {i === actionIndex ? (
                <Text bold color={COLORS.accent}>❯ </Text>
              ) : (
                <Text color={COLORS.textMuted}>  </Text>
              )}
            </Box>
            <Text
              color={i === actionIndex ? COLORS.accent : COLORS.text}
              bold={i === actionIndex}
            >
              {action.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
