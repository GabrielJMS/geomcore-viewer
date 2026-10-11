import { evalCurve } from "./curves";
import type { CurveGeom, Range } from "./types";
import type { Vec3 } from "./vec";

const TAU = 2 * Math.PI;

/** Axis-aligned rectangle in the z = 0 plane, in world units. */
export interface Rect {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/** `r` grown by `frac` of its size on every side (negative shrinks it). */
export function expandRect(r: Rect, frac: number): Rect {
  const dx = (r.xmax - r.xmin) * frac;
  const dy = (r.ymax - r.ymin) * frac;
  return { xmin: r.xmin - dx, xmax: r.xmax + dx, ymin: r.ymin - dy, ymax: r.ymax + dy };
}

/** Real roots of a·x² + b·x + c without cancellation; `a === 0` is the linear case. */
export function quadraticRoots(a: number, b: number, c: number): number[] {
  if (a === 0) return b === 0 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(disc));
  if (q === 0) return [0]; // b = c = 0: a double root at 0
  return [q / a, c / q];
}

/** Solutions of A·cos t + B·sin t = m (that is R·cos(t − φ) = m) in [lo, hi]. */
function trigRoots(A: number, B: number, m: number, lo: number, hi: number): number[] {
  const R = Math.hypot(A, B);
  if (R === 0 || Math.abs(m) > R) return [];
  const phi = Math.atan2(B, A);
  const delta = Math.acos(m / R);
  const out: number[] = [];
  for (const base of [phi + delta, phi - delta]) {
    for (let t = base + TAU * Math.ceil((lo - base) / TAU); t <= hi; t += TAU) out.push(t);
  }
  return out;
}

/** Parameters where coordinate k (0 = x, 1 = y) of the curve equals c. */
function crossings(g: CurveGeom, k: 0 | 1, c: number, lo: number, hi: number): number[] {
  switch (g.type) {
    case "line":
      return g.d[k] === 0 ? [] : [(c - g.o[k]) / g.d[k]];
    case "circle":
      return trigRoots(g.r * g.frame.x[k], g.r * g.frame.y[k], c - g.frame.o[k], lo, hi);
    case "ellipse":
      return trigRoots(g.a * g.frame.x[k], g.b * g.frame.y[k], c - g.frame.o[k], lo, hi);
    case "parabola":
      return quadraticRoots(g.frame.x[k] / (4 * g.f), g.frame.y[k], g.frame.o[k] - c);
    case "hyperbola": {
      const A = g.a * g.frame.x[k];
      const B = g.b * g.frame.y[k];
      return quadraticRoots(A + B, 2 * (g.frame.o[k] - c), A - B)
        .filter((e) => e > 0)
        .map(Math.log);
    }
  }
}

/** Parameter domain drawn: the range (capped at one turn for closed curves), one full turn, or all of ℝ. */
function domain(g: CurveGeom): Range {
  const closed = g.type === "circle" || g.type === "ellipse";
  if (g.range) {
    const [a, b] = g.range[0] <= g.range[1] ? g.range : [g.range[1], g.range[0]];
    return closed && b - a > TAU ? [a, a + TAU] : [a, b];
  }
  return closed ? [0, TAU] : [-Infinity, Infinity];
}

const inside = (r: Rect, p: Vec3): boolean => p[0] >= r.xmin && p[0] <= r.xmax && p[1] >= r.ymin && p[1] <= r.ymax;

/**
 * Parameter intervals of `g` whose points lie inside `rect`, increasing and disjoint.
 * The curve can only enter or leave the rectangle where it crosses one of its four edge
 * lines, so between consecutive crossings it is entirely in or out and a midpoint test
 * decides. The unbounded pieces of an infinite curve, before the first crossing and after
 * the last one, are outside.
 */
export function clipCurve2D(g: CurveGeom, rect: Rect): Range[] {
  const [lo, hi] = domain(g);
  const cuts = new Set<number>();
  for (const k of [0, 1] as const) {
    for (const c of k === 0 ? [rect.xmin, rect.xmax] : [rect.ymin, rect.ymax]) {
      for (const t of crossings(g, k, c, lo, hi)) if (Number.isFinite(t) && t > lo && t < hi) cuts.add(t);
    }
  }
  const bounds = [lo, ...[...cuts].sort((a, b) => a - b), hi];
  const out: Range[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    if (!inside(rect, evalCurve(g, (a + b) / 2))) continue;
    const last = out[out.length - 1];
    if (last && last[1] === a) last[1] = b;
    else out.push([a, b]);
  }
  return out;
}
