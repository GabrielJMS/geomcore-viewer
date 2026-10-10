import type { SceneObject } from "../protocol";

export const DEFAULT_COLOR = "#30638e";

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/;

function fromHex(css: string): string | null {
  const m = HEX.exec(css);
  if (!m) return null;
  const digits = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${digits.slice(0, 6)}`.toLowerCase(); // an alpha pair, if any, is dropped
}

let context: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  return context;
}

/** Let the browser parse names and functional notation; null when it does not know the colour. */
function viaCanvas(css: string): string | null {
  const ctx = canvasContext();
  if (!ctx) return null;
  // An unparseable fillStyle is ignored, leaving the previous value: two different probes tell
  // "invalid" (the result follows the probe) from a colour that merely equals one probe.
  const read = (probe: string): string => {
    ctx.fillStyle = probe;
    ctx.fillStyle = css;
    return String(ctx.fillStyle);
  };
  const first = read("#010203");
  if (first !== read("#030201")) return null;
  const rgb = FUNCTIONAL.exec(first);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  return fromHex(first);
}

/** Any CSS colour as `#rrggbb` (alpha dropped); the default colour for anything unreadable. */
export function cssToHex(color: unknown): string {
  if (typeof color !== "string") return DEFAULT_COLOR;
  const css = color.trim();
  return fromHex(css) ?? viaCanvas(css) ?? DEFAULT_COLOR;
}

export const colorOf = (o: SceneObject): string => cssToHex(o.style?.color);
