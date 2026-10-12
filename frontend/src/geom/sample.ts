import type { Vec2 } from "./vec";

/** A sampled curve, in screen pixels (Vec2, the default) or world units (Vec3). */
export interface Sampled<P extends number[] = Vec2> {
  pts: P[];
  /** The parameter of every point (for tooltips: hover → t). */
  ts: number[];
}

const SEED_SEGMENTS = 16;
const MAX_DEPTH = 20;

/** Distance from `p` to the segment [a, b], in 2D or 3D. */
export function segmentDistance(p: number[], a: number[], b: number[]): number {
  let len2 = 0;
  let along = 0;
  for (let i = 0; i < p.length; i++) {
    const d = b[i] - a[i];
    len2 += d * d;
    along += (p[i] - a[i]) * d;
  }
  const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, along / len2));
  let dist2 = 0;
  for (let i = 0; i < p.length; i++) {
    const e = p[i] - a[i] - s * (b[i] - a[i]);
    dist2 += e * e;
  }
  return Math.sqrt(dist2);
}

/**
 * Polyline of `f` over [t0, t1]: 16 even segments, each halved until the curve's midpoint
 * is within `tol` of the chord, with at most `maxPoints` points in all. The plane view
 * samples in screen pixels (spec §5.2: chord error ≤ 0.25 px, segments capped), the 3D view
 * in world units. Conics have no inflection, so the midpoint test bounds the whole arc.
 */
export function sampleAdaptive<P extends number[] = Vec2>(
  f: (t: number) => P,
  t0: number,
  t1: number,
  tol = 0.25,
  maxPoints = 4096,
): Sampled<P> {
  const pts: P[] = [f(t0)];
  const ts: number[] = [t0];
  let budget = maxPoints - SEED_SEGMENTS - 1;
  const refine = (a: number, pa: P, b: number, pb: P, depth: number): void => {
    const m = (a + b) / 2;
    const pm = f(m);
    if (depth < MAX_DEPTH && budget > 0 && segmentDistance(pm, pa, pb) > tol) {
      budget--;
      refine(a, pa, m, pm, depth + 1);
      refine(m, pm, b, pb, depth + 1);
    } else {
      pts.push(pb);
      ts.push(b);
    }
  };
  for (let i = 0; i < SEED_SEGMENTS; i++) {
    const a = ts[ts.length - 1];
    const b = i + 1 === SEED_SEGMENTS ? t1 : t0 + ((t1 - t0) * (i + 1)) / SEED_SEGMENTS;
    refine(a, pts[pts.length - 1], b, f(b), 0);
  }
  return { pts, ts };
}

/**
 * Dashes along a polyline: `dash` pixels drawn, `gap` skipped, repeating across corners.
 * Returns the line solid when it would take more than `maxDashes` dashes.
 */
export function dashPolyline(pts: Vec2[], dash: number, gap: number, maxDashes = 5000): Vec2[][] {
  if (pts.length < 2) return [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (!(dash > 0 && gap > 0) || total / (dash + gap) > maxDashes) return [pts];
  const out: Vec2[][] = [];
  let on = true;
  let left = dash; // pixels left in the current dash or gap
  let current: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (seg > left) {
      const s = left / seg;
      const cut: Vec2 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
      if (on) {
        current.push(cut);
        out.push(current);
      } else {
        current = [cut];
      }
      on = !on;
      seg -= left;
      a = cut;
      left = on ? dash : gap;
    }
    left -= seg;
    if (on) current.push(b);
  }
  if (on && current.length >= 2) out.push(current);
  return out;
}
