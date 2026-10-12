import { halfSize } from "./bounds";
import { Rect, clipCurve2D } from "./clip";
import { evalCurve } from "./curves";
import { Sampled, sampleAdaptive } from "./sample";
import { evalSurface, periods, surfaceWindow } from "./surfaces";
import { WORLD_TOL } from "./tessellate";
import { Geom, PcurveGeom, Range, SurfaceGeom, UvCurve, isSurface } from "./types";
import type { Box, Vec2, Vec3 } from "./vec";

/**
 * The surface a pcurve lies on, or null when its id names no object or one that is not a
 * surface. Such a pcurve is kept (its surface may arrive later) but not drawn; the panel
 * flags it.
 */
export function pcurveSurface(g: PcurveGeom, lookup: (id: string) => Geom | undefined): SurfaceGeom | null {
  const s = lookup(g.surface);
  return s && isSurface(s) ? s : null;
}

/**
 * Parameter intervals of a (u, v) line or circle to lift. The curve is clipped to the
 * surface's window in the directions that do not wrap around, so a helix winds past the
 * seam until it leaves the window in v; a curve those leave unbounded (the line v = 3 that
 * `Circle3D.parametrize_on(cylinder)` gives) is clipped to the whole window, one turn.
 * On a doubly-wrapping surface (a torus) a line is run from where it enters the window
 * until u and v have each advanced by a whole number of periods, so it closes.
 */
function uvRanges(g: PcurveGeom["curve"] & { type: "line" | "circle" }, s: SurfaceGeom, u: Range, v: Range): Range[] {
  const period = periods(s);
  if (g.type === "line" && period.u && period.v) return closedLineRange(g, u, v, period.u, period.v);
  const open: Rect = {
    xmin: period.u ? -Infinity : u[0],
    xmax: period.u ? Infinity : u[1],
    ymin: period.v ? -Infinity : v[0],
    ymax: period.v ? Infinity : v[1],
  };
  const ranges = clipCurve2D(g, open);
  return ranges.length ? ranges : clipCurve2D(g, { xmin: u[0], xmax: u[1], ymin: v[0], ymax: v[1] });
}

/** Seed segments per full turn of a wrapping direction: no seed may span a whole turn. */
const SEEDS_PER_TURN = 8;
/** Most turns a doubly-wrapped line is followed when its slope never closes (an irrational torus winding). */
const MAX_TURNS = 32;

/**
 * The range of a (u, v) line on a surface where both directions wrap: from where it
 * enters the window until u and v have each advanced by a whole number of periods, so
 * the lifted curve closes (a torus knot). Slopes that never close are capped at
 * MAX_TURNS in the faster direction. An explicit `range` narrows the result.
 */
function closedLineRange(
  c: Extract<PcurveGeom["curve"], { type: "line" }>,
  u: Range,
  v: Range,
  pu: number,
  pv: number,
): Range[] {
  const entry = clipCurve2D(c, { xmin: u[0], xmax: u[1], ymin: v[0], ymax: v[1] })[0];
  if (!entry) return [];
  const ru = Math.abs(c.d[0]) / pu;
  const rv = Math.abs(c.d[1]) / pv;
  let advance: number;
  if (ru > 0 && rv > 0) {
    const whole = (w: number) => Math.abs(w - Math.round(w)) < 1e-6;
    let best = Infinity;
    for (let k = 1; k <= MAX_TURNS; k++) {
      const t = (k * pu) / Math.abs(c.d[0]);
      if (whole(rv * t)) {
        best = t;
        break;
      }
    }
    for (let k = 1; k <= MAX_TURNS; k++) {
      const t = (k * pv) / Math.abs(c.d[1]);
      if (whole(ru * t)) {
        best = Math.min(best, t);
        break;
      }
    }
    advance = best === Infinity ? MAX_TURNS / Math.max(ru, rv) : best;
  } else {
    advance = ru > 0 ? pu / Math.abs(c.d[0]) : pv / Math.abs(c.d[1]);
  }
  let hi = entry[0] + advance;
  if (c.range) {
    const [r0, r1] = c.range[0] <= c.range[1] ? c.range : [c.range[1], c.range[0]];
    hi = Math.min(hi, r1);
  }
  return hi > entry[0] ? [[entry[0], hi]] : [];
}

/**
 * Seed segments for sampling a pcurve over [a, b]: at least SEEDS_PER_TURN per turn the
 * (u, v) curve travels in a wrapping direction. Without this, one seed can span a whole
 * number of turns, its midpoint lands on the chord, and sampleAdaptive never refines it —
 * a many-turn helix comes out as a straight line. Line and circle travel is exact (a
 * derivative bound for the circle); polyline travel is summed over its vertices.
 */
export function pcurveSeeds(c: UvCurve, s: SurfaceGeom, a: number, b: number): number {
  const period = periods(s);
  const span = b - a;
  let tu = 0;
  let tv = 0;
  if (c.type === "line") {
    if (period.u) tu = (Math.abs(c.d[0]) * span) / period.u;
    if (period.v) tv = (Math.abs(c.d[1]) * span) / period.v;
  } else if (c.type === "circle") {
    const { x, y } = c.frame;
    if (period.u) tu = (c.r * (Math.abs(x[0]) + Math.abs(y[0])) * span) / period.u;
    if (period.v) tv = (c.r * (Math.abs(x[1]) + Math.abs(y[1])) * span) / period.v;
  } else {
    for (let i = Math.max(0, Math.floor(a)); i + 1 < c.points.length && i < b; i++) {
      const [p, q] = [c.points[i], c.points[i + 1]];
      if (period.u) tu += Math.abs(q[0] - p[0]) / period.u;
      if (period.v) tv += Math.abs(q[1] - p[1]) / period.v;
    }
  }
  return Math.max(16, Math.ceil(Math.max(tu, tv) * SEEDS_PER_TURN));
}

/** The parameter intervals of a pcurve that are drawn: see `uvRanges`; a polyline's whole length, [0, n − 1]. */
export function pcurveRanges(g: PcurveGeom, s: SurfaceGeom, box: Box): Range[] {
  const c = g.curve;
  if (c.type === "polyline") return c.points.length >= 2 ? [[0, c.points.length - 1]] : [];
  const { u, v } = surfaceWindow(s, halfSize(box));
  return uvRanges(c, s, u, v);
}

/** A (u, v) curve's point at t: the line or circle evaluated, the polyline at i + s along segment i. */
export function uvAt(c: UvCurve, t: number): Vec2 {
  if (c.type !== "polyline") {
    const q = evalCurve(c, t);
    return [q[0], q[1]];
  }
  const i = Math.max(0, Math.min(Math.floor(t), c.points.length - 2));
  const [a, b] = [c.points[i], c.points[i + 1]];
  const s = t - i;
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
}

/**
 * The pcurve in 3D, S(q(t)) (spec §4.2), sampled to `tol` in world units. Each piece carries
 * the pcurve's parameter: t for a (u, v) line or circle, i + s along the polyline's
 * segment i.
 */
export function liftPcurve(g: PcurveGeom, s: SurfaceGeom, box: Box, tol = WORLD_TOL * halfSize(box)): Sampled<Vec3>[] {
  const c = g.curve;
  if (c.type === "polyline") {
    const pts: Vec3[] = [];
    const ts: number[] = [];
    for (let i = 0; i + 1 < c.points.length; i++) {
      const [a, b] = [c.points[i], c.points[i + 1]];
      const piece = sampleAdaptive((t) => evalSurface(s, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), 0, 1, tol, 4096, pcurveSeeds(c, s, i, i + 1));
      const from = i === 0 ? 0 : 1; // segment i starts where segment i − 1 ended
      pts.push(...piece.pts.slice(from));
      ts.push(...piece.ts.slice(from).map((t) => i + t));
    }
    return [{ pts, ts }];
  }
  const lift = (t: number): Vec3 => {
    const q = evalCurve(c, t);
    return evalSurface(s, q[0], q[1]);
  };
  return pcurveRanges(g, s, box).map(([a, b]) => sampleAdaptive(lift, a, b, tol, 4096, pcurveSeeds(c, s, a, b)));
}
