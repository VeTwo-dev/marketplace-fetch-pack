import { useEffect, useState, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import { Tag } from "../components/common/Tag.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import { configureSound, isSoundEnabled, playSound } from "../core/SoundEngine.js";
import { loadTheme, getTheme } from "../core/ThemeEngine.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

interface SettingItem {
  readonly label: string;
  readonly key: string;
  readonly description: string;
  readonly type: "toggle" | "select" | "info";
  readonly value: string;
  readonly options?: ReadonlyArray<string>;
}

export function SettingsScreen(): ReactNode {
  const { navigate } = useWizardContext();
  const [settingIndex, setSettingIndex] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(isSoundEnabled());
  const [themeName, setThemeName] = useState(getTheme().name);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const SETTINGS = useMemo<ReadonlyArray<SettingItem>>(() => [
    { label: "Sound", key: "sound", description: "Enable sound effects", type: "toggle", value: soundEnabled ? "On" : "Off" },
    { label: "Theme", key: "theme", description: "Current color theme", type: "select", value: themeName, options: ["Default Green"] },
    { label: "Animation", key: "animation", description: "Animation speed", type: "select", value: "Normal", options: ["Off", "Subtle", "Normal", "Smooth"] },
    { label: "Log Level", key: "loglevel", description: "Verbosity of logs", type: "select", value: "info", options: ["debug", "info", "warn", "error"] },
    { label: "Default Destination", key: "dest", description: "Install path", type: "info", value: "./node_modules" },
    { label: "GitHub Token", key: "token", description: "Authentication", type: "info", value: "(not set)" },
  ], [soundEnabled, themeName]);

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    if (key.upArrow || input === "k") {
      playSound("navigate");
      setSettingIndex((i) => (i - 1 + SETTINGS.length) % SETTINGS.length);
    } else if (key.downArrow || input === "j") {
      playSound("navigate");
      setSettingIndex((i) => (i + 1) % SETTINGS.length);
    } else if (key.return || key.rightArrow) {
      playSound("select");
      const item = SETTINGS[settingIndex];
      if (item === undefined) return;
      if (item.key === "sound") {
        const next = !soundEnabled;
        setSoundEnabled(next);
        configureSound({ enabled: next });
        playSound(next ? "select" : "complete");
      } else if (item.key === "theme") {
        const themes = ["Default Green", "Dark", "Light"];
        const currentIdx = themes.indexOf(themeName);
        const nextIdx = (currentIdx + 1) % themes.length;
        const next = themes[nextIdx]!;
        setThemeName(next);
        loadTheme("default");
      }
    } else if (key.escape) {
      playSound("back");
      navigateRef.current.pop();
    }
  };

  useEffect(() => {
    registerHandlerRef("settings", inputRef, "↑↓ Navigate  │  Enter Toggle  │  Esc Back");
    return () => unregisterHandlerRef("settings");
  }, []);

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="row" gap={1} marginBottom={0}>
        <Text bold color={COLORS.text}>Settings</Text>
        <Tag label={`${SETTINGS.length} options`} color={COLORS.info} />
      </Box>
      <Text color={COLORS.textMuted} dimColor>
        Press Enter to toggle settings, Escape to go back
      </Text>

      <Box marginTop={1}>
        <Box flexDirection="column">
          {SETTINGS.map((s, i) => (
            <Box key={s.key} marginBottom={0}>
              <Box width={3} minWidth={3}>
                {i === settingIndex ? (
                  <Text bold color={COLORS.accent}>❯ </Text>
                ) : (
                  <Text color={COLORS.textMuted}>  </Text>
                )}
              </Box>
              <Text
                color={i === settingIndex ? COLORS.accent : COLORS.text}
                bold={i === settingIndex}
              >
                {s.label}
              </Text>
              <Text color={COLORS.textSecondary}>
                {" "}{s.value}
              </Text>
              {i === settingIndex && s.type === "toggle" && (
                <Text color={COLORS.info}>  (toggle)</Text>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
