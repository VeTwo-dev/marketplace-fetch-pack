import { useEffect, useState, useRef } from "react";
import { Box, Text } from "ink";
import { MenuList } from "../components/common/MenuList.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

export function CategorySelection(): ReactNode {
  const { data, dispatch, navigate } = useWizardContext();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const dataRef = useRef(data);
  dataRef.current = data;

  const items = data.categories.map((cat) => ({
    label: cat.name,
    value: cat.id,
    description: `${cat.resourceCount} resources`,
    icon: "category" as const,
  }));

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => (i - 1 + items.length) % items.length);
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => (i + 1) % items.length);
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item === undefined) return;
      const category = dataRef.current.categories.find((c) => c.id === item.value) ?? null;
      dispatchRef.current({ type: "SELECT_CATEGORY", category });
      navigateRef.current.push("resourceList");
    } else if (key.escape) {
      navigateRef.current.pop();
    }
  };

  useEffect(() => {
    registerHandlerRef("categorySelection", inputRef, "↑↓ Navigate  │  Enter Select  │  Esc Back");
    return () => unregisterHandlerRef("categorySelection");
  }, []);

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Browse by Category
        </Text>
        <Text color={COLORS.textMuted} dimColor>
          {data.categories.length} categories available
        </Text>
      </Box>
      <MenuList items={items} selectedIndex={selectedIndex} emptyLabel="No categories found" />
    </Box>
  );
}
