import { describe, it, expect } from "vitest";
import { COLORS, KEYBINDINGS, TUI_THEME } from "../../src/cli/tui/theme.js";

describe("TUI theme constants", () => {
  describe("COLORS", () => {
    it("has accent color", () => {
      expect(COLORS.accent).toBe("green");
    });

    it("has success color", () => {
      expect(COLORS.success).toBe("green");
    });

    it("has warning color", () => {
      expect(COLORS.warning).toBe("yellow");
    });

    it("has error color", () => {
      expect(COLORS.error).toBe("red");
    });

    it("has info color", () => {
      expect(COLORS.info).toBe("cyan");
    });

    it("has textMuted color", () => {
      expect(COLORS.textMuted).toBe("gray");
    });

    it("has border color", () => {
      expect(COLORS.border).toBe("#3f3f46");
    });
  });

  describe("KEYBINDINGS", () => {
    it("has arrow keys", () => {
      expect(KEYBINDINGS.up).toBe("↑");
      expect(KEYBINDINGS.down).toBe("↓");
    });

    it("has action keys", () => {
      expect(KEYBINDINGS.enter).toBe("Enter");
      expect(KEYBINDINGS.escape).toBe("Escape");
      expect(KEYBINDINGS.space).toBe("Space");
    });

    it("has modifier keys", () => {
      expect(KEYBINDINGS.ctrlC).toBe("Ctrl+C");
      expect(KEYBINDINGS.ctrlR).toBe("Ctrl+R");
    });
  });

  describe("TUI_THEME", () => {
    it("has components property", () => {
      expect(TUI_THEME.components).toBeDefined();
    });

    it("is a valid Theme object", () => {
      expect(typeof TUI_THEME.components).toBe("object");
    });
  });
});
