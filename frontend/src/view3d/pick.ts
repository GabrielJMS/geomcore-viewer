import { evalCurve } from "../geom/curves";
import { pcurveSurface, uvAt } from "../geom/pcurve";
import { evalSurface } from "../geom/surfaces";
import type { SurfaceGrid } from "../geom/tessellate";
import { Geom, isCurve, isPcurve, isSurface } from "../geom/types";
import type { Vec2, Vec3 } from "../geom/vec";
import type { SceneObject } from "../protocol";
import { fmtNum, fmtParams, fmtPoint } from "../ui/format";
import { Pickable, pickNearest } from "../view2d/pick";
import type { Pickable3D } from "./render";

/** World → screen pixels, or null for a point behind the camera. */
export type Project = (p: Vec3) => Vec2 | null;

export interface Hit3D {
  id: string;
  /** Pixels from the pointer (0 on a surface). */
  dist: number;
  /** The hit point in world space. */
  at: Vec3;
  /** The curve or pcurve parameter at `at`. */
  t: number | null;
  /** Which dot of a `points` object. */
  index: number | null;
  /** On a surface: its (u, v) at `at`. */
  uv: Vec2 | null;
}

const lerp = (a: number, b: number, s: number): number => a + (b - a) * s;
const lerp3 = (a: Vec3, b: Vec3, s: number): Vec3 => [lerp(a[0], b[0], s), lerp(a[1], b[1], s), lerp(a[2], b[2], s)];

/**
 * The curve, polyline or point nearest to screen (x, y) within `radius` pixels: every
 * pickable is projected (split where it passes behind the camera) and handed to the plane
 * view's picker, then the hit is mapped back to world space and to the curve's parameter.
 */
export function pickProjected(items: Pickable3D[], project: Project, x: number, y: number, radius = 8): Hit3D | null {
  /** Per item, the world runs behind its screen polylines (hits carry a run-local index as their `t`). */
  const runs = new Map<string, { pts: Vec3[]; ts: number[] | null }[]>();
  const screen: Pickable[] = items.map((item) => {
    const p: Pickable = { id: item.id, polylines: [], dots: [] };
    const worldRuns: { pts: Vec3[]; ts: number[] | null }[] = [];
    for (const line of item.polylines) {
      let run: { s: Vec2[]; pts: Vec3[]; ts: number[] } | null = null;
      line.pts.forEach((w, i) => {
        const s = project(w);
        if (!s) {
          run = null;
          return;
        }
        if (!run) {
          run = { s: [], pts: [], ts: [] };
          p.polylines.push({ pts: run.s, ts: null });
          worldRuns.push({ pts: run.pts, ts: line.ts ? run.ts : null });
        }
        run.s.push(s);
        run.pts.push(w);
        if (line.ts) run.ts.push(line.ts[i]);
      });
    }
    for (const line of p.polylines) line.ts = line.pts.map((_, i) => i);
    item.dots.forEach((d, index) => {
      const s = project(d);
      if (s) p.dots.push({ at: s, index });
    });
    runs.set(item.id, worldRuns);
    return p;
  });
  const hit = pickNearest(screen, x, y, radius);
  if (!hit) return null;
  if (hit.index !== null) {
    const item = items.find((i) => i.id === hit.id)!;
    return { id: hit.id, dist: hit.dist, at: item.dots[hit.index], t: null, index: hit.index, uv: null };
  }
  const run = runs.get(hit.id)![hit.line!];
  const i = Math.min(Math.floor(hit.t!), run.pts.length - 2);
  const s = hit.t! - i;
  const at = lerp3(run.pts[i], run.pts[i + 1], s);
  const t = run.ts ? lerp(run.ts[i], run.ts[i + 1], s) : null;
  return { id: hit.id, dist: hit.dist, at, t, index: null, uv: null };
}

/** A surface's (u, v) from the mesh's interpolated texture coordinates (normalized across the grid's window). */
export function surfaceUv(grid: SurfaceGrid, st: Vec2): Vec2 {
  return [lerp(grid.u[0], grid.u[1], st[0]), lerp(grid.v[0], grid.v[1], st[1])];
}

const uvText = (uv: Vec2): string => `u = ${fmtNum(uv[0], 4)} · v = ${fmtNum(uv[1], 4)}`;

/** Tooltip lines for a 3D hover hit: "label · type", t and/or (u, v), the point, `meta.params`. */
export function describeHit3D(o: SceneObject, hit: Hit3D, lookup: (id: string) => Geom | undefined): string[] {
  const g = o.geom;
  const lines = [`${o.label ?? o.id} · ${g.type}`];
  let at = hit.at;
  if (g.type === "point") {
    at = g.p;
  } else if (isCurve(g) && hit.t !== null) {
    lines.push(`t = ${fmtNum(hit.t, 4)}`);
    at = evalCurve(g, hit.t);
  } else if (isPcurve(g) && hit.t !== null) {
    const uv = uvAt(g.curve, hit.t);
    lines.push(`t = ${fmtNum(hit.t, 4)}`, uvText(uv));
    const s = pcurveSurface(g, lookup);
    if (s) at = evalSurface(s, uv[0], uv[1]);
  } else if (isSurface(g) && hit.uv) {
    lines.push(uvText(hit.uv));
    at = evalSurface(g, hit.uv[0], hit.uv[1]);
  }
  lines.push(fmtPoint(at));
  const params = fmtParams(o.meta?.params);
  if (params !== null) lines.push(`params ${params}`);
  return lines;
}
