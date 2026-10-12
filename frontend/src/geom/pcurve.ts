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
 */
function uvRanges(g: PcurveGeom["curve"] & { type: "line" | "circle" }, s: SurfaceGeom, u: Range, v: Range): Range[] {
  const period = periods(s);
  const open: Rect = {
    xmin: period.u ? -Infinity : u[0],
    xmax: period.u ? Infinity : u[1],
    ymin: period.v ? -Infinity : v[0],
    ymax: period.v ? Infinity : v[1],
  };
  const ranges = clipCurve2D(g, open);
  return ranges.length ? ranges : clipCurve2D(g, { xmin: u[0], xmax: u[1], ymin: v[0], ymax: v[1] });
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
      const piece = sampleAdaptive((t) => evalSurface(s, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), 0, 1, tol);
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
  return pcurveRanges(g, s, box).map(([a, b]) => sampleAdaptive(lift, a, b, tol));
}
