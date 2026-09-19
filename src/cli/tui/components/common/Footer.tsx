import { Box, Text } from "ink";
import { COLORS, SEPARATOR } from "../../theme.js";
import type { ReactNode } from "react";

interface FooterProps {
  readonly hints: string;
}

export function Footer({ hints }: FooterProps): ReactNode {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={3}>
      <Text color={COLORS.textDim}>{SEPARATOR}</Text>
      <Box marginTop={0}>
        {hints !== "" ? (
          <Text color={COLORS.textMuted} dimColor>
            {hints}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
