import { useEffect, useState, useRef } from "react";
import { Box, Text } from "ink";
import { SeparatorLine } from "../components/common/Card.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

const MENU_ITEMS = [
  { label: "Install Another", value: "another" },
  { label: "Return Home", value: "home" },
  { label: "Quit", value: "quit" },
];

export function SuccessScreen(): ReactNode {
  const { data, dispatch, navigate } = useWizardContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const result = data.installResult;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => (i - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => (i + 1) % MENU_ITEMS.length);
    } else if (key.return) {
      const item = MENU_ITEMS[selectedIndex];
      if (item === undefined) return;
      switch (item.value) {
        case "another":
          dispatchRef.current({ type: "RESET_INSTALL" });
          navigateRef.current.goto("categorySelection");
          break;
        case "home":
          dispatchRef.current({ type: "RESET_INSTALL" });
          navigateRef.current.home();
          break;
        case "quit":
          process.exit(0);
          break;
      }
    }
  };

  useEffect(() => {
    registerHandlerRef("success", inputRef, "↑↓ Navigate  │  Enter Select  │  Ctrl+C Exit");
    return () => unregisterHandlerRef("success");
  }, []);

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      {result?.success === true ? (
        <Text bold color={COLORS.success}>
          ✔ Installed Successfully
        </Text>
      ) : (
        <Text bold color={COLORS.error}>
          ✖ Installation Failed
        </Text>
      )}

      {result !== null && (
        <Box marginTop={1}>
          <Text color={COLORS.textMuted} dimColor>
            Files installed: <Text color={COLORS.textSecondary}>{result.filesInstalled}</Text>
          </Text>
          <Text color={COLORS.textMuted} dimColor>
            Dependencies: <Text color={COLORS.textSecondary}>{result.dependenciesInstalled}</Text>
          </Text>
          <Text color={COLORS.textMuted} dimColor>
            Time: <Text color={COLORS.textSecondary}>{(result.duration / 1000).toFixed(1)}s</Text>
          </Text>
          {!result.success && (
            <Box marginTop={1}>
              <Text color={COLORS.error}>{result.message}</Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <SeparatorLine />
      </Box>

      {MENU_ITEMS.map((item, i) => (
        <Box key={item.value} flexDirection="row" marginTop={0}>
          <Box width={3} minWidth={3}>
            {i === selectedIndex ? (
              <Text bold color={COLORS.accent}>❯ </Text>
            ) : (
              <Text color={COLORS.textMuted}>  </Text>
            )}
          </Box>
          <Text
            color={i === selectedIndex ? COLORS.accent : COLORS.text}
            bold={i === selectedIndex}
          >
            {item.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
