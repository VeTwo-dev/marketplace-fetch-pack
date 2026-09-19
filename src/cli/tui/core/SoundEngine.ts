export type SoundEvent =
  | "navigate"
  | "select"
  | "success"
  | "warning"
  | "error"
  | "install"
  | "back"
  | "search"
  | "focus"
  | "complete";

interface SoundConfig {
  enabled: boolean;
  volume: number;
}

let config: SoundConfig = {
  enabled: false,
  volume: 0.5,
};

export function configureSound(cfg: Partial<SoundConfig>): void {
  config = { ...config, ...cfg };
}

export function isSoundEnabled(): boolean {
  return config.enabled;
}

async function tryPlay(_event: SoundEvent): Promise<void> {
  if (!config.enabled) return;
  try {
    const mod = (await import("@vetwo/cli-sound")) as {
      play: (event: string, volume: number) => void;
    };
    mod.play(_event, config.volume);
  } catch {
    // Sound not available
  }
}

export function playSound(event: SoundEvent): void {
  void tryPlay(event);
}

export function initSound(enabled: boolean = false): void {
  config.enabled = enabled;
}
