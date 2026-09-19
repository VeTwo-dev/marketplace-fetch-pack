import { useEffect, useState, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import { MenuList } from "../components/common/MenuList.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

export function RecommendedScreen(): ReactNode {
  const { data, dispatch, navigate } = useWizardContext();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const recommended = useMemo(() => {
    const frameworks = data.detectedProject?.frameworks.map((f) => f.type) ?? [];
    if (frameworks.length === 0) return data.resources;
    return data.resources.filter((r) => {
      if (r.compatibility?.frameworks === undefined) return true;
      return r.compatibility.frameworks.some((f) => frameworks.includes(f as never));
    });
  }, [data.resources, data.detectedProject]);

  const items = useMemo(
    () =>
      recommended.map((r) => ({
        label: r.displayName || r.name,
        value: r.id,
        description: `v${r.version}`,
        icon: "star" as const,
      })),
    [recommended],
  );

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => (i - 1 + items.length) % items.length);
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => (i + 1) % items.length);
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item === undefined) return;
      const resource = recommended.find((r) => r.id === item.value) ?? null;
      dispatchRef.current({ type: "SELECT_RESOURCE", resource });
      navigateRef.current.push("resourcePreview");
    } else if (key.escape) {
      navigateRef.current.pop();
    }
  };

  useEffect(() => {
    registerHandlerRef("recommended", inputRef, "↑↓ Navigate  │  Enter Preview  │  Esc Back");
    return () => unregisterHandlerRef("recommended");
  }, []);

  const frameworkLabel = data.detectedProject?.frameworks
    .map((f) => f.type)
    .join(", ") ?? "none detected";

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Recommended
        </Text>
        <Text color={COLORS.textMuted} dimColor>
          Based on your project ({frameworkLabel})
        </Text>
      </Box>
      <MenuList items={items} selectedIndex={selectedIndex} emptyLabel="No recommendations found" />
    </Box>
  );
}
