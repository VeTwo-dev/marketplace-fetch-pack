import { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { useWizardContext } from "../context.js";
import { Spinner, Check } from "../components/common/Spinner.js";
import { COLORS } from "../theme.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";
import { MarketplaceClientError } from "../../../errors/index.js";

type Phase = "connecting" | "showing" | "advancing" | "error";

const CONNECT_TIMEOUT = 30000;

export function MarketplaceConnection(): ReactNode {
  const { hook, dispatch, navigate } = useWizardContext();
  const [phase, setPhase] = useState<Phase>("connecting");
  const [stats, setStats] = useState<{ categories: number; resources: number } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const inputRef = useRef<RegisteredHandler>(() => {});

  useEffect(() => {
    registerHandlerRef("marketplaceConnection", inputRef);

    const abortController = new AbortController();
    let cancelled = false;

    const timeout = setTimeout(() => {
      if (!cancelled) {
        abortController.abort();
        setPhase("error");
        setErrorText("Connection timed out");
      }
    }, CONNECT_TIMEOUT);

    async function connect() {
      try {
        const [categories, resources] = await Promise.all([
          hook.getCategories(),
          hook.getResources(),
        ]);
        if (cancelled) return;

        clearTimeout(timeout);

        dispatch({ type: "BATCH_SET_DATA", categories, resources, project: null });
        setStats({ categories: categories.length, resources: resources.length });
        setPhase("showing");

        setTimeout(() => {
          if (!cancelled) {
            setPhase("advancing");
            navigate.goto("mainMenu");
          }
        }, 1000);
      } catch (error) {
        if (cancelled) return;
        clearTimeout(timeout);

        const message =
          error instanceof MarketplaceClientError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Connection failed";

        setErrorText(message);
        setPhase("error");
      }
    }

    connect();

    return () => {
      cancelled = true;
      abortController.abort();
      clearTimeout(timeout);
      unregisterHandlerRef("marketplaceConnection");
    };
  }, []);

  inputRef.current = (_input, key) => {
    if (key.escape || (key.ctrl && _input === "c")) {
      navigate.goto("mainMenu");
    }
  };

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Connecting to Marketplace
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column" gap={0}>
        {phase === "connecting" && (
          <Spinner label="Connecting..." />
        )}
        {phase === "error" && (
          <Box flexDirection="column" gap={0}>
            <Text color={COLORS.error}>Failed: {errorText}</Text>
            <Text color={COLORS.textMuted} dimColor>Press Escape to continue</Text>
          </Box>
        )}
        {phase !== "connecting" && phase !== "error" && (
          <>
            <Check label="Connected" success />
            <Check label={`Resources: ${stats?.resources ?? 0}`} success />
            <Check label={`Categories: ${stats?.categories ?? 0}`} success />
          </>
        )}
      </Box>
    </Box>
  );
}
