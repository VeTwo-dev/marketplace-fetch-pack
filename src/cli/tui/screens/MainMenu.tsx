import { useEffect, useState, useRef } from "react";
import { Box, Text } from "ink";
import { MenuList } from "../components/common/MenuList.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import { playSound } from "../core/SoundEngine.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

const MENU_ITEMS = [
  { label: "Browse Marketplace", value: "browse", description: "Explore plugins, themes and templates.", icon: "category" as const },
  { label: "Search Resources", value: "search", description: "Search across every available resource.", icon: "search" as const },
  { label: "Installed", value: "installed", description: "Manage installed resources.", icon: "installed" as const },
  { label: "Recommended", value: "recommended", description: "Based on your project.", icon: "star" as const },
  { label: "Doctor", value: "doctor", description: "Diagnose your environment.", icon: "doctor" as const },
  { label: "Settings", value: "settings", description: "Configure Marketplace.", icon: "settings" as const },
  { label: "Quit", value: "quit", icon: "error" as const },
];

export function MainMenu(): ReactNode {
  const { navigate } = useWizardContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    if (key.upArrow || input === "k") {
      playSound("navigate");
      setSelectedIndex((i) => (i - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
    } else if (key.downArrow || input === "j") {
      playSound("navigate");
      setSelectedIndex((i) => (i + 1) % MENU_ITEMS.length);
    } else if (key.return) {
      playSound("select");
      const item = MENU_ITEMS[selectedIndex];
      if (item === undefined) return;
      switch (item.value) {
        case "browse":
          navigateRef.current.push("categorySelection");
          break;
        case "search":
          navigateRef.current.push("search");
          break;
        case "installed":
          navigateRef.current.push("installed");
          break;
        case "recommended":
          navigateRef.current.push("recommended");
          break;
        case "doctor":
          navigateRef.current.push("doctor");
          break;
        case "settings":
          navigateRef.current.push("settings");
          break;
        case "quit":
          process.exit(0);
          break;
      }
    }
  };

  useEffect(() => {
    registerHandlerRef("mainMenu", inputRef, "↑↓ Navigate  │  Enter Select  │  Ctrl+C Exit");
    return () => unregisterHandlerRef("mainMenu");
  }, []);

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          What would you like to do?
        </Text>
      </Box>
      <MenuList items={MENU_ITEMS} selectedIndex={selectedIndex} />
    </Box>
  );
}
