import { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { Spinner, Check } from "../components/common/Spinner.js";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

type Phase = "idle" | "running" | "done";

interface CheckResult {
  readonly name: string;
  readonly status: "pass" | "warn" | "fail" | "skip";
  readonly message: string;
}

export function DoctorScreen(): ReactNode {
  const { hook, navigate } = useWizardContext();
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<ReadonlyArray<CheckResult>>([]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const hookRef = useRef(hook);
  hookRef.current = hook;

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    if (key.return && phase === "idle") {
      runDiagnostics();
    } else if (key.escape) {
      navigateRef.current.pop();
    }
  };

  useEffect(() => {
    registerHandlerRef("doctor", inputRef, phase === "idle" ? "Enter Run  │  Esc Back" : "Esc Back");
    return () => unregisterHandlerRef("doctor");
  }, [phase]);

  async function runDiagnostics() {
    setPhase("running");
    try {
      const report = await hookRef.current.getCategories();
      const checks: CheckResult[] = [
        { name: "Registry", status: "pass", message: `${report.length} categories loaded` },
        { name: "Node", status: "pass", message: process.version },
        { name: "Platform", status: "pass", message: process.platform },
      ];
      setResults(checks);
    } catch {
      setResults([{ name: "Registry", status: "fail", message: "Failed to connect" }]);
    }
    setPhase("done");
  }

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Doctor
        </Text>
        <Text color={COLORS.textMuted} dimColor>
          System diagnostics
        </Text>
      </Box>

      {phase === "idle" && (
        <Box marginTop={1}>
          <Text color={COLORS.textSecondary}>
            Press Enter to run diagnostics
          </Text>
        </Box>
      )}

      {phase === "running" && (
        <Box marginTop={1}>
          <Spinner label="Running diagnostics..." />
        </Box>
      )}

      {phase === "done" && (
        <Box marginTop={1} flexDirection="column" gap={0}>
          {results.map((r) => (
            <Box key={r.name} gap={1}>
              <Check label={`${r.name}: ${r.message}`} success={r.status === "pass"} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
