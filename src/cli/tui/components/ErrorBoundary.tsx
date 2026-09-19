import { Component } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.js";
import type { ReactNode, ErrorInfo } from "react";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
  readonly errorInfo: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, errorInfo: null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ errorInfo: info.componentStack ?? null });
    process.stderr.write(`[TUI Error] ${error.message}\n${info.componentStack ?? ""}\n`);
  }

  private handleRestart = (): void => {
    this.setState({ error: null, errorInfo: null });
  };

  private handleQuit = (): void => {
    process.exit(1);
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <Box
          width="100%"
          flexDirection="column"
          paddingX={3}
          paddingY={1}
        >
          <Box flexDirection="column">
            <Text bold color={COLORS.error}>
              ✖ Application Error
            </Text>
            <Text color={COLORS.text}>
              {this.state.error.message}
            </Text>
            {this.state.errorInfo !== null && (
              <Box marginTop={1} flexDirection="column">
                <Text bold color={COLORS.textMuted}>
                  Stack:
                </Text>
                <Text color={COLORS.textMuted} dimColor wrap="wrap">
                  {this.state.errorInfo}
                </Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text color={COLORS.textDim}>{"─".repeat(36)}</Text>
            </Box>
            <Box gap={2}>
              <Text color={COLORS.accent}>
                r Restart
              </Text>
              <Text color={COLORS.error}>
                q Quit
              </Text>
            </Box>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}
