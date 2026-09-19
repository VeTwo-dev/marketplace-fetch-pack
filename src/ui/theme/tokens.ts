export const COLORS = {
  accent: "green",
  accentDim: "#16a34a",
  accentBg: "#052e16",
  text: "white",
  textSecondary: "#a1a1aa",
  textMuted: "gray",
  textDim: "#52525b",
  success: "green",
  warning: "yellow",
  error: "red",
  info: "cyan",
  border: "#3f3f46",
  borderAccent: "green",
  surface: "#18181b",
  surfaceAlt: "#27272a",
  selection: "green",
  highlight: "green",
  selectionBg: "#052e16",
  danger: "#dc2626",
  dangerBg: "#450a0a",
} as const;

export const MONOCHROME_COLORS = {
  accent: "white",
  accentDim: "white",
  accentBg: "gray",
  text: "white",
  textSecondary: "white",
  textMuted: "gray",
  textDim: "gray",
  success: "white",
  warning: "white",
  error: "white",
  info: "white",
  border: "gray",
  borderAccent: "white",
  surface: "black",
  surfaceAlt: "gray",
  selection: "white",
  highlight: "white",
  selectionBg: "gray",
  danger: "white",
  dangerBg: "gray",
} as const satisfies Record<keyof typeof COLORS, string>;

export const TYPOGRAPHY = {
  title: { bold: true, color: "white" as const },
  heading: { bold: true, color: "green" as const },
  section: { bold: true, color: "white" as const },
  body: { color: "white" as const },
  description: { color: "white" as const },
  metadata: { color: "gray" as const, dimColor: true },
  muted: { color: "gray" as const },
} as const;

export const KEYBINDINGS = {
  up: "↑",
  down: "↓",
  enter: "Enter",
  escape: "Escape",
  space: "Space",
  ctrlC: "Ctrl+C",
  ctrlR: "Ctrl+R",
  tab: "Tab",
  slash: "/",
  q: "q",
  h: "h",
  j: "j",
  k: "k",
} as const;

function getSpacing() {
  try {
    const compact =
      process.env.COMPACT === "1" || process.env.COMPACT === "true";
    if (compact) {
      return {
        screenPaddingX: 1,
        screenPaddingY: 0,
        sectionGap: 0,
        itemGap: 0,
      } as const;
    }
  } catch {
    /* ignore */
  }
  return {
    screenPaddingX: 3,
    screenPaddingY: 1,
    sectionGap: 1,
    itemGap: 0,
  } as const;
}

export const SPACING = getSpacing();
