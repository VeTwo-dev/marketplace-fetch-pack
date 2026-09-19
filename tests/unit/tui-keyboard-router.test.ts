import { describe, it, expect, beforeEach } from "vitest";
import {
  registerHandlerRef,
  unregisterHandlerRef,
  getActiveHandler,
  getKeybindings,
} from "../../src/cli/tui/core/KeyboardRouter.js";

describe("KeyboardRouter", () => {
  beforeEach(() => {
    unregisterHandlerRef("mainMenu" as any);
    unregisterHandlerRef("resourcePreview" as any);
    unregisterHandlerRef("search" as any);
  });

  it("registers and retrieves a handler ref", () => {
    const ref = { current: () => {} };
    registerHandlerRef("mainMenu", ref);
    expect(getActiveHandler("mainMenu")).toBe(ref.current);
  });

  it("reads current value from ref", () => {
    const ref = { current: () => "first" };
    registerHandlerRef("mainMenu", ref);
    ref.current = () => "second";
    expect(getActiveHandler("mainMenu")).toBe(ref.current);
  });

  it("unregisters a handler", () => {
    const ref = { current: () => {} };
    registerHandlerRef("mainMenu", ref);
    unregisterHandlerRef("mainMenu");
    expect(getActiveHandler("mainMenu")).toBeUndefined();
  });

  it("replaces an existing handler ref", () => {
    const ref1 = { current: () => {} };
    const ref2 = { current: () => {} };
    registerHandlerRef("mainMenu", ref1);
    registerHandlerRef("mainMenu", ref2);
    expect(getActiveHandler("mainMenu")).toBe(ref2.current);
  });

  it("registers keybindings hints", () => {
    const ref = { current: () => {} };
    registerHandlerRef("mainMenu", ref, "↑↓ Navigate  │  Enter Select");
    expect(getKeybindings("mainMenu")).toBe("↑↓ Navigate  │  Enter Select");
  });

  it("removes keybindings on unregister", () => {
    const ref = { current: () => {} };
    registerHandlerRef("mainMenu", ref, "↑↓ Navigate");
    unregisterHandlerRef("mainMenu");
    expect(getKeybindings("mainMenu")).toBeUndefined();
  });

  it("supports multiple screens independently", () => {
    const ref1 = { current: () => {} };
    const ref2 = { current: () => {} };
    const ref3 = { current: () => {} };
    registerHandlerRef("mainMenu", ref1);
    registerHandlerRef("resourcePreview", ref2);
    registerHandlerRef("search", ref3);
    expect(getActiveHandler("mainMenu")).toBe(ref1.current);
    expect(getActiveHandler("resourcePreview")).toBe(ref2.current);
    expect(getActiveHandler("search")).toBe(ref3.current);
  });

  it("returns undefined for unregistered screen", () => {
    expect(getActiveHandler("error" as any)).toBeUndefined();
  });

  it("returns undefined for keybindings without hints", () => {
    const ref = { current: () => {} };
    registerHandlerRef("mainMenu", ref);
    expect(getKeybindings("mainMenu")).toBeUndefined();
  });
});
