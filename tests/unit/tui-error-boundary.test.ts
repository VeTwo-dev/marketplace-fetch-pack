import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";
import React from "react";
import { ErrorBoundary } from "../../src/cli/tui/components/ErrorBoundary.js";
import { Text } from "ink";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error in component");
  }
  return React.createElement(Text, null, "Working component");
}

function WorkingComponent() {
  return React.createElement(Text, null, "All good");
}

describe("ErrorBoundary", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    cleanup();
    stderrSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("renders children when no error", () => {
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(WorkingComponent)
      )
    );
    expect(lastFrame()).toContain("All good");
  });

  it("renders error message when child throws", () => {
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(ThrowingComponent, { shouldThrow: true })
      )
    );
    expect(lastFrame()).toContain("Application Error");
    expect(lastFrame()).toContain("Test error in component");
  });

  it("shows recovery options", () => {
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(ThrowingComponent, { shouldThrow: true })
      )
    );
    expect(lastFrame()).toContain("r Restart");
    expect(lastFrame()).toContain("q Quit");
  });

  it("writes error to stderr", () => {
    render(
      React.createElement(ErrorBoundary, null,
        React.createElement(ThrowingComponent, { shouldThrow: true })
      )
    );
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("[TUI Error]");
    expect(written).toContain("Test error in component");
  });

  it("does not crash when rendering error UI", () => {
    expect(() => {
      render(
        React.createElement(ErrorBoundary, null,
          React.createElement(ThrowingComponent, { shouldThrow: true })
        )
      );
    }).not.toThrow();
  });

  it("recovers after restart by remounting", () => {
    let shouldThrow = true;
    function ConditionalThrow() {
      if (shouldThrow) throw new Error("conditional");
      return React.createElement(Text, null, "Recovered!");
    }

    const { lastFrame } = render(
      React.createElement(ErrorBoundary, { key: "eb1" }, null,
        React.createElement(ConditionalThrow)
      )
    );
    expect(lastFrame()).toContain("Application Error");

    shouldThrow = false;
    const { lastFrame: frame2 } = render(
      React.createElement(ErrorBoundary, { key: "eb2" }, null,
        React.createElement(ConditionalThrow)
      )
    );
    expect(frame2()).toContain("Recovered!");
  });
});
