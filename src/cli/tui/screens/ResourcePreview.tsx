import { useEffect, useState, useRef } from "react";
import { Box, Text } from "ink";
import { TagList } from "../components/common/Tag.js";
import { ResourceIcon } from "../components/common/Icon.js";
import { SeparatorLine } from "../components/common/Card.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

const ACTIONS = [
  { label: "Install", value: "install" },
  { label: "Dependencies", value: "deps" },
  { label: "Back", value: "back" },
];

export function ResourcePreview(): ReactNode {
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
      if (action.value === "install") {
        navigateRef.current.push("installConfig");
      } else if (action.value === "deps") {
        navigateRef.current.push("dependencyPreview");
      } else if (action.value === "back") {
        navigateRef.current.pop();
      }
    } else if (key.escape) {
      navigateRef.current.pop();
    }
  };

  useEffect(() => {
    registerHandlerRef("resourcePreview", inputRef, "↑↓ Navigate  │  Enter Select  │  Esc Back");
    return () => unregisterHandlerRef("resourcePreview");
  }, []);

  if (resource === null) {
    return (
      <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
        <Text color={COLORS.error}>No resource selected</Text>
      </Box>
    );
  }

  const authorName = typeof resource.author === "string" ? resource.author : resource.author.name;

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box gap={1} marginBottom={1}>
        <Box marginTop={1}>
          <ResourceIcon category={resource.category} />
        </Box>
        <Box flexDirection="column">
          <Text bold color={COLORS.text}>
            {resource.displayName || resource.name}
          </Text>
          <Text color={COLORS.textMuted} dimColor>
            v{resource.version}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" gap={0}>
        <Text color={COLORS.textMuted}>
          Author  {authorName}
        </Text>
        <Text color={COLORS.textMuted}>
          License  {resource.license ?? "N/A"}
        </Text>
        <Text color={COLORS.textMuted}>
          Category  {resource.category}
        </Text>
      </Box>

      {resource.description !== "" && (
        <Box marginTop={1}>
          <Text bold color={COLORS.text}>Description</Text>
          <Text color={COLORS.textSecondary}>
            {resource.description}
          </Text>
        </Box>
      )}

      {resource.tags.length > 0 && (
        <Box marginTop={1}>
          <TagList tags={resource.tags} />
        </Box>
      )}

      {resource.dependencies.length > 0 && (
        <Box marginTop={1}>
          <Text bold color={COLORS.text}>Dependencies</Text>
          {resource.dependencies.map((dep) => (
            <Text key={dep.id} color={COLORS.textSecondary}>
              {dep.id}{dep.version !== undefined ? ` ${dep.version}` : ""}
              {dep.optional ? " (optional)" : ""}
            </Text>
          ))}
        </Box>
      )}

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
