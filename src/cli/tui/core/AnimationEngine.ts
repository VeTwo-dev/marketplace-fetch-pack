import { useState, useEffect, useRef } from "react";
import { getPulseColors } from "./ThemeEngine.js";

type AnimationType = "pulse" | "glow" | "fade" | "slide";

interface AnimationConfig {
  readonly type: AnimationType;
  readonly speed?: number;
  readonly active?: boolean;
}

interface SpinnerConfig {
  readonly frames?: ReadonlyArray<string>;
  readonly speed?: number;
}

const DEFAULT_FRAMES: ReadonlyArray<string> = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];

function getPulseColor(frame: number, speed: number = 80): string {
  const colors = getPulseColors();
  const index = Math.floor(frame / speed) % colors.length;
  return colors[index]!;
}

export function usePulse(speed: number = 80): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return getPulseColor(frame, speed);
}

function useSpinner(config?: SpinnerConfig): string {
  const frames = config?.frames ?? DEFAULT_FRAMES;
  const speed = config?.speed ?? 80;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, speed);
    return () => clearInterval(interval);
  }, [speed, frames.length]);

  return frames[index]!;
}

function useGlow(speed: number = 1200): number {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((p) => (p + 1) % 4);
    }, speed / 4);
    return () => clearInterval(interval);
  }, [speed]);

  return phase;
}

function useAnimationFrame(
  callback: (frame: number) => void,
  active: boolean = true,
): void {
  const frameRef = useRef(0);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      frameRef.current += 1;
      callbackRef.current(frameRef.current);
    }, 16);

    return () => {
      clearInterval(interval);
      frameRef.current = 0;
    };
  }, [active]);
}

function useCountdown(seconds: number, active: boolean = true): number {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 0.1));
    }, 100);

    return () => clearInterval(interval);
  }, [seconds, active]);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  return remaining;
}

interface ProgressAnimation {
  readonly value: number;
  readonly label: string;
  readonly isComplete: boolean;
}

function useProgress(
  steps: ReadonlyArray<string>,
  stepDuration: number = 300,
  active: boolean = true,
): ProgressAnimation {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      setStep((s) => Math.min(s + 1, steps.length));
    }, stepDuration);

    return () => clearInterval(interval);
  }, [steps.length, stepDuration, active]);

  useEffect(() => {
    setStep(0);
  }, [active]);

  return {
    value: steps.length > 0 ? step / steps.length : 1,
    label: step < steps.length ? steps[step]! : steps[steps.length - 1]!,
    isComplete: step >= steps.length,
  };
}

function lerpColor(a: string, b: string, t: number): string {
  const ah = parseInt(a.replace("#", ""), 16);
  const bh = parseInt(b.replace("#", ""), 16);
  const ar = (ah >> 16) & 0xff;
  const ag = (ah >> 8) & 0xff;
  const ab = ah & 0xff;
  const br = (bh >> 16) & 0xff;
  const bg = (bh >> 8) & 0xff;
  const bb = bh & 0xff;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (rr << 16) | (rg << 8) | rb).toString(16).slice(1)}`;
}
