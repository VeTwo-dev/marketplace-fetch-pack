import { Box, Text } from "ink";
import { COLORS } from "../../theme.js";
import { Icon, type IconName } from "./Icon.js";
import type { ReactNode } from "react";

interface MenuItem {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly icon?: IconName;
}

interface MenuListProps {
  readonly items: ReadonlyArray<MenuItem>;
  readonly selectedIndex: number;
  readonly emptyLabel?: string;
}

export function MenuList({ items, selectedIndex, emptyLabel }: MenuListProps): ReactNode {
  if (items.length === 0) {
    return (
      <Box marginTop={1}>
        <Text color={COLORS.textMuted} dimColor>
          {emptyLabel ?? "No items available"}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {items.map((item, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={item.value} marginBottom={0}>
            <Box width={3} minWidth={3}>
              {isSelected ? (
                <Text bold color={COLORS.accent}>
                  ❯{" "}
                </Text>
              ) : (
                <Text color={COLORS.textMuted}>
                  {"  "}
                </Text>
              )}
            </Box>
            {item.icon !== undefined && (
              <Box width={3} marginRight={0}>
                <Icon name={item.icon} color={isSelected ? COLORS.accent : COLORS.textMuted} />
              </Box>
            )}
            <Box flexDirection="column" flexGrow={1}>
              <Text
                color={isSelected ? COLORS.text : COLORS.textSecondary}
                bold={isSelected}
              >
                {item.label}
              </Text>
              {item.description !== undefined && item.description !== "" && (
                <Text color={COLORS.textMuted} dimColor>
                  {item.description}
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
