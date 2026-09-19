import type { Key } from "ink";
import type { ScreenId } from "./NavigationController.js";

export interface RegisteredHandler {
  (input: string, key: Key): void;
}

interface HandlerRef {
  current: RegisteredHandler;
}

const handlerRefs = new Map<ScreenId, HandlerRef>();
const keybindingsMap = new Map<ScreenId, string>();

export function registerHandlerRef(
  screen: ScreenId,
  ref: HandlerRef,
  hints?: string,
): void {
  handlerRefs.set(screen, ref);
  if (hints !== undefined) {
    keybindingsMap.set(screen, hints);
  }
}

export function unregisterHandlerRef(screen: ScreenId): void {
  handlerRefs.delete(screen);
  keybindingsMap.delete(screen);
}

export function getActiveHandler(
  screen: ScreenId,
): RegisteredHandler | undefined {
  return handlerRefs.get(screen)?.current;
}

export function getKeybindings(screen: ScreenId): string | undefined {
  return keybindingsMap.get(screen);
}
