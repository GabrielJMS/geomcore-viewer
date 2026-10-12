import type { Vec2 } from "./vec";

export interface Sampled {
  pts: Vec2[];
  /** The parameter of every point (for tooltips: hover → t). */
  ts: number[];
}

const SEED_SEGMENTS = 16;
const MAX_DEPTH = 20;

/** Distance from `p` to the segment [a, b]. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy);
}

/**
 * Screen-space polyline of `f` over [t0, t1]: 16 even segments, each halved until the
 * curve's midpoint is within `tol` pixels of the chord, with at most `maxPoints` points in
 * all (spec §5.2: chord error ≤ 0.25 px, segments capped). Conics have no inflection, so
 * the midpoint test bounds the whole arc.
 */
export function sampleAdaptive(f: (t: number) => Vec2, t0: number, t1: number, tol = 0.25, maxPoints = 4096): Sampled {
  const pts: Vec2[] = [f(t0)];
  const ts: number[] = [t0];
  let budget = maxPoints - SEED_SEGMENTS - 1;
  const refine = (a: number, pa: Vec2, b: number, pb: Vec2, depth: number): void => {
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
