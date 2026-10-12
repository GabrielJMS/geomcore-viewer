import { halfSize } from "./bounds";
import { clipCurveBox } from "./clip";
import { evalCurve } from "./curves";
import { Sampled, sampleAdaptive } from "./sample";
import { evalSurface, surfaceWindow } from "./surfaces";
import type { CurveGeom, SurfaceGeom } from "./types";
import { Box, Vec3, add, cross, norm, scale, sub } from "./vec";

/** Chord tolerance of the 3D view, as a fraction of the view box's half-size (≈ 0.4 px when the scene fills the pane). */
export const WORLD_TOL = 5e-4;

export interface TriMesh {
  positions: number[];
  indices: number[];
  /** True when an infinite direction had no window and fell back to ±fallbackHalf. */
  assumed: boolean;
}

/** The curve's pieces inside `box` (spec §5.3: the view box is the scene's ×1.5), clipped in closed form and sampled to `tol`. */
export function curvePieces(g: CurveGeom, box: Box, tol = WORLD_TOL * halfSize(box)): Sampled<Vec3>[] {
  return clipCurveBox(g, box).map(([a, b]) => sampleAdaptive((t) => evalCurve(g, t), a, b, tol));
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
