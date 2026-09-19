import { describe, it, expect } from "vitest";
import {
  loadLogo,
  getLogoSize,
  getPulseColor,
  PULSE_COLORS,
  BREAKPOINTS,
} from "../../src/cli/tui/core/LogoEngine.js";

describe("LogoEngine", () => {
  describe("loadLogo", () => {
    it("loads small logo", () => {
      const logo = loadLogo("small");
      expect(logo).toBeTruthy();
      expect(typeof logo).toBe("string");
    });

    it("loads medium logo", () => {
      const logo = loadLogo("medium");
      expect(logo).toBeTruthy();
      expect(typeof logo).toBe("string");
    });

    it("loads large logo", () => {
      const logo = loadLogo("large");
      expect(logo).toBeTruthy();
      expect(typeof logo).toBe("string");
    });

    it("caches loaded logos", () => {
      const logo1 = loadLogo("small");
      const logo2 = loadLogo("small");
      expect(logo1).toBe(logo2);
    });
  });

  describe("getLogoSize", () => {
    it("returns small for narrow terminals", () => {
      expect(getLogoSize(BREAKPOINTS.small - 1)).toBe("small");
    });

    it("returns medium for medium terminals", () => {
      expect(getLogoSize(BREAKPOINTS.small)).toBe("medium");
      expect(getLogoSize(BREAKPOINTS.medium - 1)).toBe("medium");
    });

    it("returns large for wide terminals", () => {
      expect(getLogoSize(BREAKPOINTS.medium)).toBe("large");
      expect(getLogoSize(120)).toBe("large");
    });
  });

  describe("getPulseColor", () => {
    it("returns a color from PULSE_COLORS", () => {
      const color = getPulseColor(0);
      expect(PULSE_COLORS).toContain(color);
    });

    it("cycles through colors", () => {
      const color0 = getPulseColor(0);
      const color1 = getPulseColor(80);
      const color2 = getPulseColor(160);
      expect(color0).not.toBe(color1);
      expect(color1).not.toBe(color2);
    });

    it("wraps around after full cycle", () => {
      const fullCycle = PULSE_COLORS.length * 80;
      const color0 = getPulseColor(0);
      const colorWrapped = getPulseColor(fullCycle);
      expect(color0).toBe(colorWrapped);
    });
  });
});
