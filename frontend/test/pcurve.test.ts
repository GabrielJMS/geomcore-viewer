import { describe, expect, it } from "vitest";
import { liftPcurve, pcurveSurface } from "../src/geom/pcurve";
import { evalSurface } from "../src/geom/surfaces";
import type { Geom, PcurveGeom, SurfaceGeom } from "../src/geom/types";
import { Box, Frame } from "../src/geom/vec";

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const box: Box = { min: [-5, -5, -5], max: [5, 5, 5] };
const cylinder: SurfaceGeom = { type: "cylinder", frame: world, r: 2, window: { v: [-3.5, 3.5] } };
const on = (curve: PcurveGeom["curve"]): PcurveGeom => ({ type: "pcurve", surface: "Y", curve });

describe("pcurveSurface", () => {
  it("finds the surface by id, and nothing for a missing id or a non-surface", () => {
    const objects = new Map<string, Geom>([["Y", cylinder], ["P", { type: "point", p: [0, 0, 0] }]]);
    const lookup = (id: string) => objects.get(id);
    expect(pcurveSurface(on({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }), lookup)).toBe(cylinder);
    expect(pcurveSurface({ ...on({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }), surface: "P" }, lookup)).toBeNull();
    expect(pcurveSurface({ ...on({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }), surface: "gone" }, lookup)).toBeNull();
  });
});

describe("liftPcurve", () => {
  it("lifts the (u, v) line v = 3 to one turn of the circle at height 3", () => {
    // What Circle3D.parametrize_on(Cylinder) gives: u = t, v = 3, an infinite line in (u, v).
    const [piece, ...rest] = liftPcurve(on({ type: "line", o: [0, 3, 0], d: [1, 0, 0] }), cylinder, box);
    expect(rest).toEqual([]);
    expect(piece.ts[0]).toBeCloseTo(0, 12);
    expect(piece.ts[piece.ts.length - 1]).toBeCloseTo(2 * Math.PI, 12);
    for (const p of piece.pts) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(2, 9);
      expect(p[2]).toBeCloseTo(3, 9);
    }
  });

  it("lets a helix wind past the seam until it leaves the window in v", () => {
    const [piece] = liftPcurve(on({ type: "line", o: [0, 0, 0], d: [1, 0.2, 0] }), cylinder, box);
    expect(piece.ts[0]).toBeCloseTo(-17.5, 9);
    expect(piece.ts[piece.ts.length - 1]).toBeCloseTo(17.5, 9);
  });

  it("draws a (u, v) circle whole even across the seam u = 0", () => {
    const [piece] = liftPcurve(on({ type: "circle", frame: world, r: 0.5 }), cylinder, box);
    expect(piece.ts[0]).toBe(0);
    expect(piece.ts[piece.ts.length - 1]).toBeCloseTo(2 * Math.PI, 12);
  });

  it("lifts a polyline segment by segment, its parameter running over the vertex indices", () => {
    const [piece] = liftPcurve(on({ type: "polyline", points: [[0, 0, 0], [Math.PI, 1, 0], [Math.PI, 2, 0]] }), cylinder, box);
    expect(piece.pts[0]).toEqual(evalSurface(cylinder, 0, 0));
    expect(piece.pts[piece.pts.length - 1]).toEqual(evalSurface(cylinder, Math.PI, 2));
    expect(piece.ts[0]).toBe(0);
    expect(piece.ts[piece.ts.length - 1]).toBe(2);
    expect(piece.ts).toContain(1);
  });

  it("draws nothing for a (u, v) line that misses the window", () => {
    expect(liftPcurve(on({ type: "line", o: [0, 9, 0], d: [1, 0, 0] }), cylinder, box)).toEqual([]);
  });
});
