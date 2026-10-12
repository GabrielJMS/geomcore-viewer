import { segmentDistance } from "../geom/sample";
import type { Vec2 } from "../geom/vec";

/** What the pointer can hit: an object's screen polylines (with their parameters, for curves) and dots. */
export interface Pickable {
  id: string;
  polylines: { pts: Vec2[]; ts: number[] | null }[];
  dots: { at: Vec2; index: number }[];
}

export interface Hit {
  id: string;
  /** Pixels from the pointer. */
  dist: number;
  /** The hit point on the polyline, or the dot's center. */
  at: Vec2;
  /** The curve parameter at `at` (interpolated), when the polyline carries parameters. */
  t: number | null;
  /** Which dot of a `points` object was hit. */
  index: number | null;
  /** Which of the item's polylines was hit (the 3D view maps the hit back through it). */
  line?: number;
}

/** Points win a near-tie with a curve passing under them. */
const POINT_BIAS = 4;

/** The object nearest to screen (x, y) within `radius` pixels (spec §5.2: 8 px), or null. */
export function pickNearest(items: Pickable[], x: number, y: number, radius = 8): Hit | null {
  const p: Vec2 = [x, y];
  let best: Hit | null = null;
  let bestScore = Infinity;
  for (const item of items) {
    for (const dot of item.dots) {
      const d = Math.hypot(dot.at[0] - x, dot.at[1] - y);
      if (d <= radius && d - POINT_BIAS < bestScore) {
        bestScore = d - POINT_BIAS;
        best = { id: item.id, dist: d, at: dot.at, t: null, index: dot.index };
      }
    }
    item.polylines.forEach((line, li) => {
      const pts = line.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = segmentDistance(p, pts[i], pts[i + 1]);
        if (d > radius || d >= bestScore) continue;
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
        const ts = line.ts;
        bestScore = d;
        best = {
          id: item.id,
          dist: d,
          at: [a[0] + s * dx, a[1] + s * dy],
          t: ts ? ts[i] + s * (ts[i + 1] - ts[i]) : null,
          index: null,
          line: li,
        };
      }
    });
  }
  return best;
}
