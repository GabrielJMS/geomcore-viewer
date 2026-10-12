import { describe, expect, it } from "vitest";
import { segmentDistance } from "../src/geom/sample";
import { arrowPolylines, curvePieces, tessellateSurface } from "../src/geom/tessellate";
import { evalCurve } from "../src/geom/curves";
import { halfSize, sameBox, sceneBounds, viewBox } from "../src/geom/bounds";
import { inPlaneZ0 } from "../src/geom/planar";
import type { Geom } from "../src/geom/types";
import { Frame } from "../src/geom/vec";

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const tilted: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };

describe("curvePieces", () => {
  it("draws a closed circle once round, from t = 0 to 2π, within the tolerance", () => {
    const g = { type: "circle", frame: world, r: 2 } as const;
    const [piece, ...rest] = curvePieces(g, viewBox([]));
    expect(rest).toEqual([]);
    expect(piece.ts[0]).toBe(0);
    expect(piece.ts[piece.ts.length - 1]).toBeCloseTo(2 * Math.PI, 12);
    const tol = 5e-4 * 5; // WORLD_TOL × the half-size of the ±5 box
    for (let i = 0; i + 1 < piece.pts.length; i++) {
      const p = evalCurve(g, (piece.ts[i] + piece.ts[i + 1]) / 2);
      expect(segmentDistance(p, piece.pts[i], piece.pts[i + 1])).toBeLessThanOrEqual(tol + 1e-12);
    }
  });

  it("runs an infinite line from face to face of the view box", () => {
    const [piece] = curvePieces({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }, viewBox([]));
    expect(piece.pts[0][0]).toBeCloseTo(-5, 9);
    expect(piece.pts[piece.pts.length - 1][0]).toBeCloseTo(5, 9);
  });

  it("gives nothing for a line outside the box", () => {
    expect(curvePieces({ type: "line", o: [0, 0, 9], d: [1, 0, 0] }, viewBox([]))).toEqual([]);
  });
});

describe("tessellateSurface", () => {
  it("builds an (nu+1)×(nv+1) grid of triangles", () => {
    const mesh = tessellateSurface({ type: "sphere", frame: world, r: 1 }, 5, 4, 2);
    expect(mesh.positions).toHaveLength(5 * 3 * 3);
    expect(mesh.indices).toHaveLength(4 * 2 * 6);
    expect(mesh.assumed).toBe(false);
    expect(tessellateSurface({ type: "plane", frame: world }, 5, 2, 2).assumed).toBe(true);
  });
});

describe("arrowPolylines", () => {
  it("draws a shaft from at to at+vec plus two head strokes", () => {
    const lines = arrowPolylines([0, 0, 0], [0, 0, 2]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual([[0, 0, 0], [0, 0, 2]]);
    for (const head of lines.slice(1)) expect(head[0]).toEqual([0, 0, 2]);
  });
});

describe("bounds", () => {
  it("covers finite geometry and only the origin of infinite curves", () => {
    const geoms: Geom[] = [
      { type: "circle", frame: { ...world, o: [1, 0, 0] }, r: 2 },
      { type: "point", p: [0, 4, 0] },
      { type: "line", o: [0, 0, -1], d: [1, 0, 0] },
      { type: "note", text: "hi" },
    ];
    expect(sceneBounds(geoms)).toEqual({ min: [-1, -2, -2], max: [3, 4, 2] });
    expect(sceneBounds([{ type: "note", text: "x" }])).toBeNull();
  });

  it("includes the drawn extent of explicitly ranged infinite curves", () => {
    expect(sceneBounds([{ type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [0, 100] }])).toEqual({
      min: [0, 0, 0],
      max: [100, 0, 0],
    });
    const parabola: Geom = { type: "parabola", frame: world, f: 0.25, range: [-2, 2] };
    expect(sceneBounds([parabola])).toEqual({ min: [0, -2, 0], max: [4, 2, 0] });
    expect(sceneBounds([{ type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [50, 100] }])).toEqual({
      min: [50, 0, 0],
      max: [100, 0, 0],
    });
    const away: Geom = { type: "parabola", frame: world, f: 0.25, range: [1, 2] };
    expect(sceneBounds([away])).toEqual({ min: [1, 1, 0], max: [4, 2, 0] });
  });

  it("grows the scene box ×1.5 into a cube, or falls back to ±5", () => {
    expect(viewBox([])).toEqual({ min: [-5, -5, -5], max: [5, 5, 5] });
    const box = viewBox([{ type: "point", p: [0, 0, 0] }, { type: "point", p: [2, 0, 0] }]);
    expect(box).toEqual({ min: [-0.5, -1.5, -1.5], max: [2.5, 1.5, 1.5] });
    expect(halfSize(box)).toBe(1.5);
    expect(sameBox(box, viewBox([{ type: "point", p: [2, 0, 0] }, { type: "point", p: [0, 0, 0] }]))).toBe(true);
  });
});

describe("inPlaneZ0", () => {
  it.each<[Geom, boolean]>([
    [{ type: "circle", frame: world, r: 1 }, true],
    [{ type: "circle", frame: tilted, r: 1 }, false],
    [{ type: "line", o: [0, 0, 0], d: [1, 1, 0] }, true],
    [{ type: "line", o: [0, 0, 0], d: [0, 0, 1] }, false],
    [{ type: "point", p: [1, 2, 0] }, true],
    [{ type: "polyline", points: [[0, 0, 0], [1, 0, 1e-3]] }, false],
    [{ type: "plane", frame: world }, false],
  ])("%j → %s", (g, want) => {
    expect(inPlaneZ0(g)).toBe(want);
  });
});
