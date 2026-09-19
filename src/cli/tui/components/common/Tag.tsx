import { Box, Text } from "ink";
import { COLORS } from "../../theme.js";
import type { ReactNode } from "react";

interface TagProps {
  readonly label: string;
  readonly color?: string;
}

export function Tag({ label, color }: TagProps): ReactNode {
  return (
    <Text color={color ?? COLORS.accent} dimColor>
      {label}
    </Text>
  );
}

interface TagListProps {
  readonly tags: ReadonlyArray<string>;
  readonly color?: string;
}

export function TagList({ tags, color }: TagListProps): ReactNode {
  if (tags.length === 0) return null;
  return (
    <Box gap={1} marginTop={1} flexWrap="wrap">
      {tags.map((tag) => (
        <Tag key={tag} label={tag} color={color} />
      ))}
    </Box>
  );
}
