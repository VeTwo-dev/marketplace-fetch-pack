import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(CURRENT_DIR, "../../../../assets/ascii");

const LOGO_SIZES = ["small", "medium", "large"] as const;
export type LogoSize = (typeof LOGO_SIZES)[number];

export const PULSE_COLORS = [
  "#166534",
  "#22c55e",
  "#4ade80",
  "#22c55e",
  "#166534",
] as const;

export const BREAKPOINTS = {
  small: 50,
  medium: 80,
} as const;

const CACHE = new Map<LogoSize, string>();

export function loadLogo(size: LogoSize): string {
  const cached = CACHE.get(size);
  if (cached !== undefined) return cached;

  const filename = `logo-${size}.txt`;
  const filepath = resolve(ASSETS_DIR, filename);

  try {
    const content = readFileSync(filepath, "utf-8");
    CACHE.set(size, content);
    return content;
  } catch {
    return "VeTwo Marketplace";
  }
}

export function getLogoSize(columns: number): LogoSize {
  if (columns < BREAKPOINTS.small) return "small";
  if (columns < BREAKPOINTS.medium) return "medium";
  return "large";
}

export function getPulseColor(frame: number, speed: number = 80): string {
  const index = Math.floor(frame / speed) % PULSE_COLORS.length;
  return PULSE_COLORS[index]!;
}
