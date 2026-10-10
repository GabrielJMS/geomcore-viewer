import { curveRange, evalCurve } from "./curves";
import { evalSurface, surfaceWindow } from "./surfaces";
import type { CurveGeom, SurfaceGeom } from "./types";
import { Box, Vec3, add, cross, norm, scale, sub } from "./vec";

export interface TriMesh {
  positions: number[];
  indices: number[];
  /** True when an infinite direction had no window and fell back to ±fallbackHalf. */
  assumed: boolean;
}

/** Polyline through the curve, uniform in t over `curveRange(g, box)`. */
export function tessellateCurve(g: CurveGeom, box: Box, segments = 256): Vec3[] {
  const [t0, t1] = curveRange(g, box);
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) points.push(evalCurve(g, t0 + ((t1 - t0) * i) / segments));
  return points;
}

/** Grid triangulation of the surface over its window (same layout as the Python sampler). */
export function tessellateSurface(g: SurfaceGeom, fallbackHalf: number, nu = 64, nv = 32): TriMesh {
  const { u, v, assumed } = surfaceWindow(g, fallbackHalf);
  const positions: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const vj = v[0] + ((v[1] - v[0]) * j) / nv;
    for (let i = 0; i <= nu; i++) positions.push(...evalSurface(g, u[0] + ((u[1] - u[0]) * i) / nu, vj));
  }
  const indices: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const c = a + nu + 1;
      indices.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  return { positions, indices, assumed };
}

/** Shaft plus two head strokes (15 % of the length), in a plane containing the arrow. */
export function arrowPolylines(at: Vec3, vec: Vec3): Vec3[][] {
  const tip = add(at, vec);
  const length = norm(vec);
  if (length === 0) return [[at, tip]];
  const dir = scale(vec, 1 / length);
  const helper: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const side = cross(dir, helper);
  const sideUnit = scale(side, (0.08 * length) / norm(side));
  const back = sub(tip, scale(dir, 0.15 * length));
  return [[at, tip], [tip, add(back, sideUnit)], [tip, sub(back, sideUnit)]];
}
