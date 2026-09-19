import { Text } from "ink";
import { COLORS } from "../../theme.js";
import { EMOJI_ICONS, NERD_FONT_ICONS, NERD_SUPPORTED } from "../../../../ui/theme/icons.js";
import type { ReactNode } from "react";
import type { IconName as IconNameT } from "../../../../ui/theme/icons.js";

export type IconName = IconNameT;

const ICON_MAP = NERD_SUPPORTED ? NERD_FONT_ICONS : EMOJI_ICONS;

const ICON_DISPLAY: Record<string, string> = { ...ICON_MAP };

interface IconProps {
  readonly name: IconName;
  readonly color?: string;
}

export function Icon({ name, color }: IconProps): ReactNode {
  const char = ICON_MAP[name];
  if (char === undefined) return null;
  return (
    <Text color={color ?? COLORS.textSecondary}>{char}</Text>
  );
}

export function ResourceIcon({ category }: { category: string }): ReactNode {
  const iconMap: Record<string, IconName> = {
    plugins: "plugin",
    themes: "theme",
    templates: "template",
    modules: "module",
    generators: "generator",
    extensions: "extension",
  };
  return <Icon name={iconMap[category] ?? "package"} />;
}
