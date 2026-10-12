export type Theme = "light" | "dark";

/** Canvas colours of one theme; style.css mirrors them in its custom properties. */
export interface Palette {
  bg: string;
  gridMinor: string;
  gridMajor: string;
  axis: string;
  text: string;
}

export const PALETTES: Record<Theme, Palette> = {
  light: { bg: "#f7f8fa", gridMinor: "#e6e8ec", gridMajor: "#cfd3da", axis: "#6b7280", text: "#374151" },
  dark: { bg: "#16181d", gridMinor: "#23262d", gridMajor: "#343842", axis: "#9aa3b2", text: "#d6dae1" },
};

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** `a` moved a fraction `t` of the way towards `b` (both `#rrggbb`). */
export function mixHex(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca.map((c, i) => Math.round(c + (cb[i] - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 … 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Switch the page's CSS custom properties (style.css `:root[data-theme="dark"]`). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
