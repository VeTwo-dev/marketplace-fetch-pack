import { Box, Text } from "ink";
import { useState, useEffect } from "react";
import { COLORS } from "../../theme.js";
import type { ReactNode } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SpinnerProps {
  readonly label?: string;
}

export function Spinner({ label }: SpinnerProps): ReactNode {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box gap={1}>
      <Text color={COLORS.accent}>{FRAMES[frame]}</Text>
      {label !== undefined && label !== "" && (
        <Text color={COLORS.textSecondary}>{label}</Text>
      )}
    </Box>
  );
}

interface CheckProps {
  readonly label: string;
  readonly success?: boolean;
}

export function Check({ label, success = true }: CheckProps): ReactNode {
  return (
    <Box gap={1}>
      <Text color={success ? COLORS.success : COLORS.error} bold>
        {success ? "✔" : "✘"}
      </Text>
      <Text color={success ? COLORS.text : COLORS.textMuted}>
        {label}
      </Text>
    </Box>
  );
}

interface ProgressBarProps {
  readonly percent: number;
  readonly width?: number;
  readonly label?: string;
  readonly color?: string;
}

function ProgressBar({ percent, width = 30, label, color }: ProgressBarProps): ReactNode {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = "━".repeat(filled) + "─".repeat(empty);

  return (
    <Box flexDirection="column" gap={0}>
      {label !== undefined && (
        <Text color={COLORS.textMuted} dimColor>{label}</Text>
      )}
      <Box gap={1}>
        <Text color={color ?? COLORS.accent}>{bar}</Text>
        <Text color={COLORS.textMuted}>{percent}%</Text>
      </Box>
    </Box>
  );
}

interface StepIndicatorProps {
  readonly label: string;
  readonly phase: "pending" | "current" | "complete";
  readonly progress?: number;
}

export function StepIndicator({ label, phase, progress }: StepIndicatorProps): ReactNode {
  const indicator = phase === "complete" ? "✔" : phase === "current" ? "▶" : "○";
  const color = phase === "complete" ? COLORS.success : phase === "current" ? COLORS.accent : COLORS.textMuted;
  const isBold = phase !== "pending";

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box gap={1}>
        <Text color={color} bold={isBold}>
          {indicator} {label}
        </Text>
      </Box>
      {phase === "current" && progress !== undefined && (
        <Box marginLeft={3}>
          <ProgressBar percent={progress} />
        </Box>
      )}
    </Box>
  );
}
