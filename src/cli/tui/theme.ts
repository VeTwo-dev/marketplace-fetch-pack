import { defaultTheme, type Theme } from "@inkjs/ui";
import {
  COLORS as BASE_COLORS,
  MONOCHROME_COLORS,
  TYPOGRAPHY,
  KEYBINDINGS,
  SPACING,
} from "../../ui/theme/index.js";

function detectMonochrome(): boolean {
  try {
    if (process.env.NO_COLOR !== undefined) return true;
    if (process.env.MONOCHROME === "1" || process.env.MONOCHROME === "true")
      return true;
  } catch {
    /* ignore */
  }
  return false;
}

export const COLORS = detectMonochrome()
  ? (MONOCHROME_COLORS as unknown as typeof BASE_COLORS)
  : { ...BASE_COLORS };

export { KEYBINDINGS };

export const SEPARATOR = "─".repeat(36);

export const TUI_THEME: Theme = {
  components: {
    ...defaultTheme.components,
  },
};
