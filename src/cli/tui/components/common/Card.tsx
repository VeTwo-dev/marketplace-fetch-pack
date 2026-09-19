import { Box, Text } from "ink";
import { COLORS, SEPARATOR } from "../../theme.js";
import type { ReactNode } from "react";

interface CardProps {
  readonly title?: string;
  readonly children: ReactNode;
  readonly paddingX?: number;
  readonly paddingY?: number;
  readonly flexDirection?: "column" | "row";
}

function Card({
  title,
  children,
  paddingX,
  paddingY,
  flexDirection = "column",
}: CardProps): ReactNode {
  return (
    <Box flexDirection={flexDirection}>
      {title !== undefined && (
        <Text bold color={COLORS.text}>
          {title}
        </Text>
      )}
      <Box flexDirection="column" paddingX={paddingX} paddingY={paddingY}>
        {children}
      </Box>
    </Box>
  );
}

interface DetailRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

function DetailRow({ label, children }: DetailRowProps): ReactNode {
  return (
    <Box>
      <Text color={COLORS.textMuted}>
        {label}
      </Text>
      <Box marginLeft={2}>
        <Text color={COLORS.textSecondary}>
          {children}
        </Text>
      </Box>
    </Box>
  );
}

interface SectionProps {
  readonly title?: string;
  readonly children: ReactNode;
}

function Section({ title, children }: SectionProps): ReactNode {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {title !== undefined && (
        <Text bold color={COLORS.text}>
          {title}
        </Text>
      )}
      {children}
    </Box>
  );
}

export function SeparatorLine(): ReactNode {
  return (
    <Box marginY={1}>
      <Text color={COLORS.textDim}>{SEPARATOR}</Text>
    </Box>
  );
}
