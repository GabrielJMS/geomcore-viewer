import type { Rect } from "../geom/clip";
import type { Box, Vec2 } from "../geom/vec";

/** The plane view's camera: world point (cx, cy) at the pane's center, `scale` pixels per world unit, y up. */
export interface Camera2D {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}

export const MIN_SCALE = 1e-9;
export const MAX_SCALE = 1e12;

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function worldToScreen(c: Camera2D, x: number, y: number): Vec2 {
  return [(x - c.cx) * c.scale + c.width / 2, c.height / 2 - (y - c.cy) * c.scale];
}

export function screenToWorld(c: Camera2D, sx: number, sy: number): Vec2 {
  return [c.cx + (sx - c.width / 2) / c.scale, c.cy - (sy - c.height / 2) / c.scale];
}

/** The world rectangle the pane shows. */
export function visibleRect(c: Camera2D): Rect {
  const hw = c.width / 2 / c.scale;
  const hh = c.height / 2 / c.scale;
  return { xmin: c.cx - hw, xmax: c.cx + hw, ymin: c.cy - hh, ymax: c.cy + hh };
}

/**
 * Frame `box` (its x/y extent) with `pad` pixels on every side. A pane that is hidden
 * (0 × 0) still gets a finite camera; an empty scene shows ±5 around the origin; a single
 * point gets a 2 × 2 window around it.
 */
export function fitCamera(box: Box | null, width: number, height: number, pad = 40): Camera2D {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const availW = Math.max(w - 2 * pad, w / 2);
  const availH = Math.max(h - 2 * pad, h / 2);
  if (!box) return { cx: 0, cy: 0, scale: clampScale(Math.min(availW, availH) / 10), width, height };
  let bw = box.max[0] - box.min[0];
  let bh = box.max[1] - box.min[1];
  if (!(bw > 0) && !(bh > 0)) bw = bh = 2;
  const fits = [bw > 0 ? availW / bw : Infinity, bh > 0 ? availH / bh : Infinity];
  return {
    cx: (box.min[0] + box.max[0]) / 2,
    cy: (box.min[1] + box.max[1]) / 2,
    scale: clampScale(Math.min(...fits)),
    width,
    height,
  };
}

/** Zoom by `factor` keeping the world point under screen (sx, sy) in place. */
export function zoomAt(c: Camera2D, sx: number, sy: number, factor: number): Camera2D {
  const [wx, wy] = screenToWorld(c, sx, sy);
  const scale = clampScale(c.scale * factor);
  return {
    ...c,
    scale,
    cx: wx - (sx - c.width / 2) / scale,
    cy: wy + (sy - c.height / 2) / scale,
  };
}

/** Move the view by a screen drag of (dx, dy) pixels. */
export function panBy(c: Camera2D, dx: number, dy: number): Camera2D {
  return { ...c, cx: c.cx - dx / c.scale, cy: c.cy + dy / c.scale };
}

/** The pane changed size: keep the center and the zoom. */
export function resizeCamera(c: Camera2D, width: number, height: number): Camera2D {
  return { ...c, width, height };
}
