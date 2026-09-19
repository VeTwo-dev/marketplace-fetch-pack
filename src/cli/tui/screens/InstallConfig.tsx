import { useEffect, useState, useRef } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { FormWizard, WizardQuestion } from "../../../ui/FormWizard.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

const WIZARD_STEPS = [
  { key: "overwrite" as const, label: "Overwrite existing files" },
  { key: "optionalDeps" as const, label: "Install optional dependencies" },
  { key: "dryRun" as const, label: "Run as dry run" },
  { key: "confirm" as const, label: "Confirm" },
];

export function InstallConfigScreen(): ReactNode {
  const { data, dispatch, navigate } = useWizardContext();
  const [step, setStep] = useState(0);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const dataRef = useRef(data);
  dataRef.current = data;

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    const currentStep = WIZARD_STEPS[step];
    if (currentStep === undefined) return;

    if (key.upArrow || key.downArrow || input === "k" || input === "j") {
      // Toggle current boolean setting
      if (currentStep.key !== "confirm") {
        const currentValue = dataRef.current.installConfig[currentStep.key] as boolean;
        dispatchRef.current({ type: "SET_INSTALL_CONFIG", config: { [currentStep.key]: !currentValue } });
      }
    } else if (key.return) {
      if (step < WIZARD_STEPS.length - 1) {
        setStep((s) => s + 1);
      } else {
        navigateRef.current.push("dependencyPreview");
      }
    } else if (key.escape) {
      if (step > 0) {
        setStep((s) => s - 1);
      } else {
        navigateRef.current.pop();
      }
    }
  };

  useEffect(() => {
    registerHandlerRef("installConfig", inputRef, "↑↓ Toggle  │  Enter Next  │  Esc Back");
    return () => unregisterHandlerRef("installConfig");
  }, [step]);

  const resourceName = data.selectedResource?.displayName ?? data.selectedResource?.name ?? "Resource";

  const currentStep = WIZARD_STEPS[step];
  const currentValue = currentStep !== undefined && currentStep.key !== "confirm"
    ? (data.installConfig as unknown as Record<string, unknown>)[currentStep.key]
    : undefined;
  const isConfirm = currentStep?.key === "confirm";

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Install Configuration
        </Text>
        <Text color={COLORS.textMuted} dimColor>
          {resourceName}
        </Text>
      </Box>

      <FormWizard steps={WIZARD_STEPS} currentStep={step}>
        {currentStep !== undefined && (
          <WizardQuestion
            question={
              isConfirm
                ? "Ready to install?"
                : currentStep.label
            }
            hint={
              isConfirm
                ? "Review your choices below"
                : "Press ↑↓ to toggle, Enter to continue"
            }
          >
            {isConfirm ? (
              <Box flexDirection="column" gap={1} marginTop={1}>
                <Text color={COLORS.textSecondary}>
                  Overwrite existing: {data.installConfig.overwrite ? "Yes" : "No"}
                </Text>
                <Text color={COLORS.textSecondary}>
                  Optional deps: {data.installConfig.optionalDeps ? "Yes" : "No"}
                </Text>
                <Text color={COLORS.textSecondary}>
                  Dry run: {data.installConfig.dryRun ? "Yes" : "No"}
                </Text>
                <Box marginTop={1}>
                  <Text color={COLORS.textMuted} dimColor>
                    Press Enter to continue
                  </Text>
                </Box>
              </Box>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color={COLORS.accent}>
                  {currentValue === true ? "Yes" : "No"}
                </Text>
              </Box>
            )}
          </WizardQuestion>
        )}
      </FormWizard>
    </Box>
  );
}
