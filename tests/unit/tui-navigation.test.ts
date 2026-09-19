import { describe, it, expect } from "vitest";
import {
  createNavigationController,
  type ScreenId,
} from "../../src/cli/tui/core/NavigationController.js";

describe("NavigationController", () => {
  it("starts with initial screen", () => {
    const nav = createNavigationController("splash");
    expect(nav.current().screen).toBe("splash");
  });

  it("defaults to splash if no argument", () => {
    const nav = createNavigationController();
    expect(nav.current().screen).toBe("splash");
  });

  describe("push", () => {
    it("adds a new screen", () => {
      const nav = createNavigationController("splash");
      nav.push("mainMenu");
      expect(nav.current().screen).toBe("mainMenu");
    });

    it("preserves previous screen", () => {
      const nav = createNavigationController("splash");
      nav.push("mainMenu");
      expect(nav.getStack()).toHaveLength(2);
      expect(nav.getStack()[0]?.screen).toBe("splash");
    });

    it("pushes with data", () => {
      const nav = createNavigationController("mainMenu");
      nav.push("resourceList", { categoryId: "plugins" });
      expect(nav.current().screen).toBe("resourceList");
      expect(nav.current().data).toEqual({ categoryId: "plugins" });
    });
  });

  describe("pop", () => {
    it("returns to previous screen", () => {
      const nav = createNavigationController("splash");
      nav.push("mainMenu");
      nav.pop();
      expect(nav.current().screen).toBe("splash");
    });

    it("does nothing when only one screen", () => {
      const nav = createNavigationController("splash");
      nav.pop();
      expect(nav.current().screen).toBe("splash");
      expect(nav.getStack()).toHaveLength(1);
    });

    it("pops multiple times", () => {
      const nav = createNavigationController("splash");
      nav.push("mainMenu");
      nav.push("categorySelection");
      nav.push("resourceList");
      nav.pop();
      expect(nav.current().screen).toBe("categorySelection");
      nav.pop();
      expect(nav.current().screen).toBe("mainMenu");
      nav.pop();
      expect(nav.current().screen).toBe("splash");
    });
  });

  describe("goto", () => {
    it("replaces current screen without adding to stack", () => {
      const nav = createNavigationController("splash");
      nav.goto("mainMenu");
      expect(nav.current().screen).toBe("mainMenu");
      expect(nav.getStack()).toHaveLength(1);
    });

    it("replaces with data", () => {
      const nav = createNavigationController("mainMenu");
      nav.goto("resourcePreview", { resourceId: "react-router" });
      expect(nav.current().screen).toBe("resourcePreview");
      expect(nav.current().data).toEqual({ resourceId: "react-router" });
    });
  });

  describe("home", () => {
    it("clears stack and goes to mainMenu", () => {
      const nav = createNavigationController("splash");
      nav.push("mainMenu");
      nav.push("categorySelection");
      nav.push("resourceList");
      nav.home();
      expect(nav.current().screen).toBe("mainMenu");
      expect(nav.getStack()).toHaveLength(1);
    });
  });

  describe("canGoBack", () => {
    it("returns false when only one screen", () => {
      const nav = createNavigationController("splash");
      expect(nav.canGoBack()).toBe(false);
    });

    it("returns true when multiple screens", () => {
      const nav = createNavigationController("splash");
      nav.push("mainMenu");
      expect(nav.canGoBack()).toBe(true);
    });
  });

  describe("getStack", () => {
    it("returns a copy of the stack", () => {
      const nav = createNavigationController("splash");
      nav.push("mainMenu");
      const stack = nav.getStack();
      expect(stack).toHaveLength(2);
      stack.push({ screen: "error" });
      expect(nav.getStack()).toHaveLength(2);
    });
  });

  describe("complex flows", () => {
    it("splash → mainMenu → categorySelection → resourceList → resourcePreview → pop → pop", () => {
      const nav = createNavigationController("splash");
      nav.goto("mainMenu");
      nav.push("categorySelection");
      nav.push("resourceList");
      nav.push("resourcePreview");
      expect(nav.current().screen).toBe("resourcePreview");
      nav.pop();
      expect(nav.current().screen).toBe("resourceList");
      nav.pop();
      expect(nav.current().screen).toBe("categorySelection");
    });

    it("goto replaces current, preserving rest of stack", () => {
      const nav = createNavigationController("splash");
      nav.push("mainMenu");
      nav.push("categorySelection");
      nav.goto("search");
      expect(nav.current().screen).toBe("search");
      expect(nav.getStack()).toHaveLength(3);
      expect(nav.getStack()[1]?.screen).toBe("mainMenu");
    });

    it("full wizard flow: splash → projectDetection → marketplaceConnection → mainMenu → browse → resourceList → preview → installConfig → dependencyPreview → installProgress → success", () => {
      const nav = createNavigationController("splash");
      nav.goto("projectDetection");
      nav.goto("marketplaceConnection");
      nav.goto("mainMenu");
      nav.push("categorySelection");
      nav.push("resourceList");
      nav.push("resourcePreview");
      nav.push("installConfig");
      nav.push("dependencyPreview");
      nav.push("installProgress");
      nav.goto("success");
      expect(nav.current().screen).toBe("success");
      expect(nav.canGoBack()).toBe(true);
    });
  });
});
