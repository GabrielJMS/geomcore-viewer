import { describe, expect, it } from "vitest";
import { Rect, clipCurve2D, expandRect, quadraticRoots } from "../src/geom/clip";
import { evalCurve } from "../src/geom/curves";
import type { CurveGeom, Range } from "../src/geom/types";
import type { Frame, Vec3 } from "../src/geom/vec";

const TAU = 2 * Math.PI;
const R = (xmin: number, xmax: number, ymin: number, ymax: number): Rect => ({ xmin, xmax, ymin, ymax });
const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
function turned(angle: number, o: Vec3 = [0.3, -0.2, 0]): Frame {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { o, x: [c, s, 0], y: [-s, c, 0], z: [0, 0, 1] };
}

function expectRanges(got: Range[], want: Range[]): void {
  expect(got.length).toBe(want.length);
  got.forEach((r, i) => {
    expect(r[0]).toBeCloseTo(want[i][0], 9);
    expect(r[1]).toBeCloseTo(want[i][1], 9);
  });
}

describe("quadraticRoots", () => {
  it("solves without cancellation and falls back to the linear case", () => {
    expect(quadraticRoots(1, -3, 2).sort()).toEqual([1, 2]);
    expect(quadraticRoots(0, 2, -4)).toEqual([2]);
    expect(quadraticRoots(1, 0, 1)).toEqual([]);
    expect(quadraticRoots(0, 0, 1)).toEqual([]);
    const [small] = quadraticRoots(1, -1e8, 1).sort((a, b) => a - b);
    expect(small).toBeCloseTo(1e-8, 20);
  });
});

describe("expandRect", () => {
  it("grows by a fraction of the size on every side", () => {
    expect(expandRect(R(0, 10, -2, 2), 0.1)).toEqual(R(-1, 11, -2.4, 2.4));
  });
});

describe("clipCurve2D", () => {
  it("clips an infinite line to the rectangle", () => {
    expectRanges(clipCurve2D({ type: "line", o: [0, 0, 0], d: [1, 1, 0] }, R(-1, 1, -1, 1)), [[-1, 1]]);
  });

  it("returns nothing for a line that misses", () => {
    expect(clipCurve2D({ type: "line", o: [0, 5, 0], d: [1, 0, 0] }, R(-1, 1, -1, 1))).toEqual([]);
  });

  it("keeps a ranged line's own ends", () => {
    expectRanges(clipCurve2D({ type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [0, 0.5] }, R(-1, 1, -1, 1)), [[0, 0.5]]);
  });

  it("keeps a circle that fits whole", () => {
    expectRanges(clipCurve2D({ type: "circle", frame: world, r: 1 }, R(-2, 2, -2, 2)), [[0, TAU]]);
  });

  it("splits a circle that the rectangle cuts at the seam", () => {
    expectRanges(clipCurve2D({ type: "circle", frame: world, r: 2 }, R(0, 3, -3, 3)), [
      [0, Math.PI / 2],
      [(3 * Math.PI) / 2, TAU],
    ]);
  });

  it("clips a parabola in closed form", () => {
    expectRanges(clipCurve2D({ type: "parabola", frame: world, f: 0.25 }, R(-1, 4, -1, 1)), [[-1, 1]]);
  });

  it("clips a hyperbola branch in closed form", () => {
    const t = Math.acosh(10);
    expectRanges(clipCurve2D({ type: "hyperbola", frame: world, a: 1, b: 1 }, R(-10, 10, -10, 10)), [[-t, t]]);
  });

  it("drops a hyperbola branch that lies outside", () => {
    expect(clipCurve2D({ type: "hyperbola", frame: world, a: 1, b: 1 }, R(-10, -1, -10, 10))).toEqual([]);
  });

  it("works at extreme zoom", () => {
    const line: CurveGeom = { type: "line", o: [0, 0, 0], d: [1, 1, 0] };
    const tiny = clipCurve2D(line, R(1 - 1e-7, 1 + 1e-7, 1 - 1e-7, 1 + 1e-7));
    expectRanges(tiny, [[1 - 1e-7, 1 + 1e-7]]);
    expectRanges(clipCurve2D(line, R(-1e9, 1e9, -1e9, 1e9)), [[-1e9, 1e9]]);
  });

  it("finds every visible piece of tilted conics (sampled check)", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const curves: { g: CurveGeom; span: Range }[] = [
      { g: { type: "line", o: [0.2, -0.1, 0], d: [0.6, -1.3, 0] }, span: [-12, 12] },
      { g: { type: "ellipse", frame: turned(0.7), a: 3, b: 1.2 }, span: [0, TAU] },
      { g: { type: "circle", frame: turned(-1.1), r: 2, range: [0.5, 4] }, span: [0.5, 4] },
      { g: { type: "parabola", frame: turned(2.2), f: -0.4 }, span: [-8, 8] },
      { g: { type: "hyperbola", frame: turned(-0.4), a: 1.1, b: 0.6 }, span: [-3.5, 3.5] },
    ];
    for (let trial = 0; trial < 40; trial++) {
      const x0 = random() * 8 - 4;
      const y0 = random() * 8 - 4;
      const rect = R(x0, x0 + 0.5 + random() * 4, y0, y0 + 0.5 + random() * 4);
      for (const { g, span } of curves) {
        const ranges = clipCurve2D(g, rect);
        for (const [a, b] of ranges) {
          const mid = evalCurve(g, (a + b) / 2);
          expect(mid[0]).toBeGreaterThanOrEqual(rect.xmin - 1e-9);
          expect(mid[0]).toBeLessThanOrEqual(rect.xmax + 1e-9);
          expect(mid[1]).toBeGreaterThanOrEqual(rect.ymin - 1e-9);
          expect(mid[1]).toBeLessThanOrEqual(rect.ymax + 1e-9);
        }
        const shrunk = expandRect(rect, -1e-6);
        for (let i = 0; i <= 2000; i++) {
          const t = span[0] + ((span[1] - span[0]) * i) / 2000;
          const p = evalCurve(g, t);
          const strictlyInside = p[0] > shrunk.xmin && p[0] < shrunk.xmax && p[1] > shrunk.ymin && p[1] < shrunk.ymax;
          if (!strictlyInside) continue;
          const covered = ranges.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);
          expect(covered, `${g.type} t=${t} inside but not drawn`).toBe(true);
        }
      }
    }
  });
});
