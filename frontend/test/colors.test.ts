import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneObject } from "../src/protocol";

// The canvas context is cached per module instance, so each test gets a fresh one.
async function load() {
  vi.resetModules();
  return import("../src/ui/colors");
}

describe("cssToHex without a DOM", () => {
  it("normalises #rgb, #rrggbb and #rrggbbaa", async () => {
    const { cssToHex } = await load();
    expect(cssToHex("#f00")).toBe("#ff0000");
    expect(cssToHex("#30638e")).toBe("#30638e");
    expect(cssToHex("#30638e80")).toBe("#30638e");
    expect(cssToHex("#f008")).toBe("#ff0000");
  });

  it("is case-insensitive and tolerates surrounding space", async () => {
    const { cssToHex } = await load();
    expect(cssToHex("#ABCDEF")).toBe("#abcdef");
    expect(cssToHex("  #F0A ")).toBe("#ff00aa");
  });

  it("falls back to the default for anything it cannot read", async () => {
    const { cssToHex, DEFAULT_COLOR } = await load();
    for (const bad of ["red", "#ggg", "#12345", "", "nonsense", 42, null, undefined, {}, ["#fff"]]) {
      expect(cssToHex(bad)).toBe(DEFAULT_COLOR);
    }
  });

  it("colorOf reads the object's style colour, normalised", async () => {
    const { colorOf, DEFAULT_COLOR } = await load();
    const obj = (style?: object) => ({ id: "a", geom: { type: "point", p: [0, 0, 0] }, style }) as SceneObject;
    expect(colorOf(obj({ color: "#0f0" }))).toBe("#00ff00");
    expect(colorOf(obj({ color: 7 }))).toBe(DEFAULT_COLOR);
    expect(colorOf(obj())).toBe(DEFAULT_COLOR);
  });
});

describe("cssToHex with a canvas", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A canvas context that, like a browser, ignores fillStyle values it cannot parse. */
  function stubCanvas(table: Record<string, string>) {
    const created = vi.fn();
    const ctx = {
      _style: "#000000",
      get fillStyle() {
        return this._style;
      },
      set fillStyle(value: string) {
        if (value in table) this._style = table[value];
        else if (/^#[0-9a-f]{6}$/.test(value)) this._style = value;
      },
    };
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        created(tag);
        return { getContext: () => ctx };
      },
    });
    return created;
  }

  it("normalises named colours through the context", async () => {
    const created = stubCanvas({ red: "#ff0000", rebeccapurple: "#663399", "rgba(0, 0, 255, 0.5)": "rgba(0, 0, 255, 0.5)" });
    const { cssToHex, DEFAULT_COLOR } = await load();
    expect(cssToHex("red")).toBe("#ff0000");
    expect(cssToHex("rebeccapurple")).toBe("#663399");
    expect(cssToHex("rgba(0, 0, 255, 0.5)")).toBe("#0000ff");
    expect(cssToHex("not a colour")).toBe(DEFAULT_COLOR);
    expect(created).toHaveBeenCalledTimes(1); // the canvas is made once and cached
  });

  it("does not take a colour equal to the probe value for an invalid one", async () => {
    stubCanvas({ "rgb(1, 2, 3)": "#010203" });
    const { cssToHex } = await load();
    expect(cssToHex("rgb(1, 2, 3)")).toBe("#010203");
  });

  it("does not touch the canvas for hex input or non-strings", async () => {
    const created = stubCanvas({});
    const { cssToHex } = await load();
    cssToHex("#fff");
    cssToHex(5);
    expect(created).not.toHaveBeenCalled();
  });

  it("falls back to the default when the canvas has no 2D context", async () => {
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    const { cssToHex, DEFAULT_COLOR } = await load();
    expect(cssToHex("red")).toBe(DEFAULT_COLOR);
  });
});
