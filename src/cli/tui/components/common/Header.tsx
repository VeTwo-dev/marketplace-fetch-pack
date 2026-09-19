import { Box, Text } from "ink";
import { COLORS } from "../../theme.js";
import { SCREEN_LABELS, type ScreenId } from "../../../../ui/theme/screens.js";
import type { ReactNode } from "react";

interface HeaderProps {
  readonly screen: ScreenId;
  readonly categoryName: string | null;
}

export function Header({ screen, categoryName }: HeaderProps): ReactNode {
  if (screen === "splash") return null;

  const screenLabel = SCREEN_LABELS[screen];

  return (
    <Box paddingX={3} paddingY={0}>
      <Box flexDirection="row" width="100%">
        <Text bold color={COLORS.text}>
          VeTwo Marketplace
        </Text>
        {screenLabel !== "" && (
          <Text color={COLORS.textMuted}>
            {"  "}› {screenLabel}
          </Text>
        )}
        {categoryName !== null && (
          <Text color={COLORS.textSecondary}>
            {" / "}{categoryName}
          </Text>
        )}
      </Box>
    </Box>
  );
}
