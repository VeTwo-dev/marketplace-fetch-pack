import { Box, Text } from "ink";
import { COLORS } from "./theme/tokens.js";
import { EMOJI_ICONS } from "./theme/icons.js";
import type { ReactNode } from "react";

interface FormStep {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
}

interface FormWizardProps {
  readonly steps: ReadonlyArray<FormStep>;
  readonly currentStep: number;
  readonly children: ReactNode;
}

export function FormWizard({ steps, currentStep, children }: FormWizardProps): ReactNode {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1} gap={0}>
        {steps.map((step, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;
          const color = isDone ? COLORS.success : isCurrent ? COLORS.accent : COLORS.textMuted;
          const icon = isDone ? EMOJI_ICONS.check : isCurrent ? EMOJI_ICONS.current : String(i + 1);
          return (
            <Box key={step.key} gap={1}>
              <Box width={3} minWidth={3}>
                <Text color={color} bold={isCurrent || isDone}>
                  {icon}
                </Text>
              </Box>
              <Text color={color} dimColor={!isCurrent && !isDone} bold={isCurrent}>
                {step.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  );
}

interface WizardQuestionProps {
  readonly question: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

export function WizardQuestion({ question, hint, children }: WizardQuestionProps): ReactNode {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold color={COLORS.text}>
          {question}
        </Text>
        {hint !== undefined && (
          <Text color={COLORS.textMuted} dimColor>
            {hint}
          </Text>
        )}
      </Box>
      {children}
    </Box>
  );
}
