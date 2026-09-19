import { useEffect, useState, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import { MenuList } from "../components/common/MenuList.js";
import { filterByCategory } from "../state.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

export function ResourceListScreen(): ReactNode {
  const { data, dispatch, navigate } = useWizardContext();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const categoryName = data.selectedCategory?.name ?? "All Resources";

  const resources = useMemo(
    () =>
      data.selectedCategory !== null
        ? filterByCategory(data.resources, data.selectedCategory.id)
        : data.resources,
    [data.resources, data.selectedCategory],
  );

  const items = useMemo(
    () =>
      resources.map((r) => ({
        label: r.displayName || r.name,
        value: r.id,
        description: `v${r.version}`,
        icon: "package" as const,
      })),
    [resources],
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
      const resource = resources.find((r) => r.id === item.value) ?? null;
      dispatchRef.current({ type: "SELECT_RESOURCE", resource });
      navigateRef.current.push("resourcePreview");
    } else if (key.escape) {
      navigateRef.current.pop();
    }
  };

  useEffect(() => {
    registerHandlerRef("resourceList", inputRef, "↑↓ Navigate  │  Enter Preview  │  Esc Back");
    return () => unregisterHandlerRef("resourceList");
  }, []);

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          {categoryName}
        </Text>
        <Text color={COLORS.textMuted} dimColor>
          {resources.length} resources
        </Text>
      </Box>
      <MenuList items={items} selectedIndex={selectedIndex} emptyLabel="No resources in this category" />
    </Box>
  );
}
