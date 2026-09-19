import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = resolve(CURRENT_DIR, "../../../../assets/themes");

interface ThemeColorSet {
  accent: string;
  accentDim: string;
  accentBg: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  border: string;
  borderAccent: string;
  surface: string;
  surfaceAlt: string;
  selection: string;
  highlight: string;
  selectionBg: string;
  danger: string;
  dangerBg: string;
}

interface TypographyStyle {
  bold?: boolean;
  color?: string;
  dimColor?: boolean;
}

export interface ThemeDefinition {
  name: string;
  description: string;
  version: string;
  colors: ThemeColorSet;
  typography: Record<string, TypographyStyle>;
  animation: {
    spinnerFrames: ReadonlyArray<string>;
    pulseColors: ReadonlyArray<string>;
    pulseSpeed: number;
    glowIntensity: number;
  };
  separator: string;
}

const DEFAULT_THEME: ThemeDefinition = {
  name: "Default Green",
  description: "VeTwo Marketplace default green theme",
  version: "1.0.0",
  colors: {
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
  },
  typography: {
    h1: { bold: true, color: "white" },
    h2: { bold: true, color: "green" },
    h3: { bold: true, color: "white" },
    body: { color: "white" },
    metadata: { color: "gray", dimColor: true },
    description: { color: "white" },
    tag: { color: "green" },
    muted: { color: "gray" },
  },
  animation: {
    spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    pulseColors: ["#166534", "#22c55e", "#4ade80", "#22c55e", "#166534"],
    pulseSpeed: 80,
    glowIntensity: 0.3,
  },
  separator: "─",
};

let activeTheme: ThemeDefinition = DEFAULT_THEME;

export function loadTheme(name: string = "default"): ThemeDefinition {
  const filepath = resolve(THEMES_DIR, `${name}.json`);
  try {
    const content = readFileSync(filepath, "utf-8");
    const parsed = JSON.parse(content) as Partial<ThemeDefinition>;
    activeTheme = {
      ...DEFAULT_THEME,
      ...parsed,
      colors: { ...DEFAULT_THEME.colors, ...parsed.colors },
      typography: { ...DEFAULT_THEME.typography, ...parsed.typography },
      animation: { ...DEFAULT_THEME.animation, ...parsed.animation },
    };
  } catch {
    activeTheme = DEFAULT_THEME;
  }
  return activeTheme;
}

export function getTheme(): ThemeDefinition {
  return activeTheme;
}

function getColor(key: keyof ThemeColorSet): string {
  return activeTheme.colors[key];
}

function getTypography(key: string): TypographyStyle {
  return activeTheme.typography[key] ?? { color: "white" };
}

function getSpinnerFrames(): ReadonlyArray<string> {
  return activeTheme.animation.spinnerFrames;
}

export function getPulseColors(): ReadonlyArray<string> {
  return activeTheme.animation.pulseColors;
}
