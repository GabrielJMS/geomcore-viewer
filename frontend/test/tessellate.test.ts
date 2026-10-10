import { describe, expect, it } from "vitest";
import { arrowPolylines, tessellateCurve, tessellateSurface } from "../src/geom/tessellate";
import { halfSize, sameBox, sceneBounds, viewBox } from "../src/geom/bounds";
import { inPlaneZ0 } from "../src/geom/planar";
import type { Geom } from "../src/geom/types";
import { Frame } from "../src/geom/vec";

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const tilted: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };

describe("tessellateCurve", () => {
  it("samples a closed circle from t=0 to 2π", () => {
    const pts = tessellateCurve({ type: "circle", frame: world, r: 2 }, viewBox([]), 8);
    expect(pts).toHaveLength(9);
    expect(pts[0][0]).toBeCloseTo(2);
    expect(pts[8][0]).toBeCloseTo(2);
  });

  it("extends a line across the whole view box", () => {
    const pts = tessellateCurve({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }, viewBox([]), 4);
    expect(pts[0][0]).toBeLessThanOrEqual(-5);
    expect(pts[4][0]).toBeGreaterThanOrEqual(5);
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
