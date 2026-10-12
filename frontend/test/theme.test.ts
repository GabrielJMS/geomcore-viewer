import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR } from "../src/ui/colors";
import { PALETTES, contrast, luminance, mixHex } from "../src/ui/theme";

describe("theme colours", () => {
  it("mixes two colours channel by channel", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#d1495b", "#f7f8fa", 0)).toBe("#d1495b");
    expect(mixHex("#d1495b", "#f7f8fa", 1)).toBe("#f7f8fa");
  });

  it("computes WCAG luminance and contrast", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
    expect(luminance("#000000")).toBe(0);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 6);
  });

  it("keeps the default object colour readable on both themes", () => {
    expect(contrast(DEFAULT_COLOR, PALETTES.light.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(DEFAULT_COLOR, PALETTES.dark.bg)).toBeGreaterThanOrEqual(3);
  });

  it("keeps text and axes readable on their own background", () => {
    for (const p of Object.values(PALETTES)) {
      expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.axis, p.bg)).toBeGreaterThanOrEqual(3);
    }
  });
});
