export type IconName =
  | "package"
  | "plugin"
  | "theme"
  | "template"
  | "module"
  | "generator"
  | "extension"
  | "config"
  | "tool"
  | "docs"
  | "star"
  | "installed"
  | "download"
  | "search"
  | "fast"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "back"
  | "home"
  | "settings"
  | "doctor"
  | "category"
  | "tag"
  | "link"
  | "user"
  | "license"
  | "version"
  | "dependency"
  | "check"
  | "cross"
  | "arrowRight"
  | "arrowLeft"
  | "arrowUp"
  | "arrowDown"
  | "bullet"
  | "cursor"
  | "pending"
  | "current";

export type IconSet = Record<IconName, string>;

export const EMOJI_ICONS: IconSet = {
  package: "📦",
  plugin: "🔌",
  theme: "🎨",
  template: "📄",
  module: "📦",
  generator: "⚡",
  extension: "🔌",
  config: "⚙",
  tool: "🛠",
  docs: "📚",
  star: "⭐",
  installed: "✓",
  download: "⬇",
  search: "🔍",
  fast: "⚡",
  success: "✓",
  warning: "⚠",
  error: "✖",
  info: "ℹ",
  back: "←",
  home: "⌂",
  settings: "⚙",
  doctor: "♡",
  category: "📁",
  tag: "🔖",
  link: "🔗",
  user: "👤",
  license: "©",
  version: "📌",
  dependency: "🔗",
  check: "✓",
  cross: "✗",
  arrowRight: "→",
  arrowLeft: "←",
  arrowUp: "↑",
  arrowDown: "↓",
  bullet: "·",
  cursor: "❯",
  pending: "○",
  current: "▶",
};

export const NERD_FONT_ICONS: IconSet = {
  package: "",
  plugin: "",
  theme: "",
  template: "",
  module: "",
  generator: "",
  extension: "",
  config: "",
  tool: "",
  docs: "",
  star: "",
  installed: "",
  download: "",
  search: "",
  fast: "",
  success: "",
  warning: "",
  error: "",
  info: "",
  back: "",
  home: "",
  settings: "",
  doctor: "",
  category: "",
  tag: "",
  link: "",
  user: "",
  license: "©",
  version: "里",
  dependency: "",
  check: "",
  cross: "",
  arrowRight: "",
  arrowLeft: "",
  arrowUp: "",
  arrowDown: "",
  bullet: "·",
  cursor: "❯",
  pending: "○",
  current: "▶",
};

function getIconSet(nerdFont?: boolean): IconSet {
  return nerdFont ? NERD_FONT_ICONS : EMOJI_ICONS;
}

function icon(name: IconName, nerdFont?: boolean): string {
  const set = getIconSet(nerdFont);
  return set[name] ?? "?";
}

function hasNerdFontSupport(): boolean {
  try {
    const env = process.env.NERD_FONT;
    if (env === "0" || env === "false") return false;
    if (env === "1" || env === "true") return true;
  } catch {
    /* ignore */
  }
  try {
    return process.stdout.columns !== undefined && process.stdout.columns >= 60;
  } catch {
    return true;
  }
}

export const NERD_SUPPORTED = hasNerdFontSupport();
