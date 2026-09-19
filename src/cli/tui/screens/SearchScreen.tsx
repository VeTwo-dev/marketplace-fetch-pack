import { useState, useEffect, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import { TextInput } from "@inkjs/ui";
import { COLORS } from "../theme.js";
import { useWizardContext } from "../context.js";
import { filterByQuery, filterByCategory } from "../state.js";
import { registerHandlerRef, unregisterHandlerRef } from "../core/KeyboardRouter.js";
import type { RegisteredHandler } from "../core/KeyboardRouter.js";
import type { ReactNode } from "react";

export function SearchScreen(): ReactNode {
  const { data, dispatch, navigate } = useWizardContext();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const results = useMemo(() => {
    let pool = data.resources;
    if (data.selectedCategory !== null) {
      pool = filterByCategory(pool, data.selectedCategory.id);
    }
    return filterByQuery(pool, query);
  }, [data.resources, data.selectedCategory, query]);

  const inputRef = useRef<RegisteredHandler>(() => {});
  inputRef.current = (input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (key.return && results.length > 0) {
      const resource = results[selectedIndex] ?? null;
      dispatchRef.current({ type: "SELECT_RESOURCE", resource });
      navigateRef.current.push("resourcePreview");
    } else if (key.escape) {
      navigateRef.current.pop();
    }
  };

  useEffect(() => {
    registerHandlerRef("search", inputRef, "↑↓ Navigate  │  Enter Preview  │  Esc Back");
    return () => unregisterHandlerRef("search");
  }, []);

  const categoryLabel = data.selectedCategory !== null
    ? ` in ${data.selectedCategory.name}`
    : "";

  return (
    <Box flexDirection="column" paddingX={3} paddingY={1} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={COLORS.text}>
          Search{categoryLabel}
        </Text>
      </Box>
      <Box marginTop={1} marginBottom={1}>
        <TextInput
          placeholder="Type to search..."
          onChange={(value: string) => {
            setQuery(value);
            setSelectedIndex(0);
          }}
        />
      </Box>

      {query !== "" && (
        <Text color={COLORS.textMuted} dimColor>
          {results.length} result{results.length !== 1 ? "s" : ""} found
        </Text>
      )}

      <Box flexDirection="column" gap={0}>
        {results.slice(0, 15).map((r, i) => (
          <Box key={r.id} marginBottom={0}>
            <Box width={3} minWidth={3}>
              {i === selectedIndex ? (
                <Text bold color={COLORS.accent}>❯ </Text>
              ) : (
                <Text color={COLORS.textMuted}>  </Text>
              )}
            </Box>
            <Text
              color={i === selectedIndex ? COLORS.accent : COLORS.text}
              bold={i === selectedIndex}
            >
              {r.displayName || r.name}
            </Text>
            <Text color={COLORS.textMuted} dimColor>
              {" "}v{r.version}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
