import { describe, expect, it } from "vitest";
import { liftPcurve, pcurveRanges, pcurveSeeds, pcurveSurface } from "../src/geom/pcurve";
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

  it("samples a 32-turn helix finely instead of a straight line", () => {
    // One seed per 16-segment start would span two whole turns here, its midpoint landing
    // on the chord, so the midpoint test alone would never refine it.
    const s = 7 / (32 * 2 * Math.PI);
    const [piece, ...rest] = liftPcurve(on({ type: "line", o: [0, 0, 0], d: [1, s, 0] }), cylinder, box);
    expect(rest).toEqual([]);
    expect(piece.pts.length).toBeGreaterThan(500);
    let length = 0;
    for (let i = 1; i < piece.pts.length; i++) {
      length += Math.hypot(piece.pts[i][0] - piece.pts[i - 1][0], piece.pts[i][1] - piece.pts[i - 1][1], piece.pts[i][2] - piece.pts[i - 1][2]);
    }
    expect(length).toBeGreaterThan(300); // 32 turns at r = 2 run ~402; a straight chord would be < 12
  });

  it("closes a diagonal line where both directions wrap instead of leaving a gap", () => {
    const torus: SurfaceGeom = { type: "torus", frame: world, R: 3, r: 1 };
    const g = on({ type: "line", o: [1, 0, 0], d: [1, 1, 0] }); // u = v + 1
    const [range, ...rest] = pcurveRanges(g, torus, box);
    expect(rest).toEqual([]);
    expect(range[1] - range[0]).toBeCloseTo(2 * Math.PI, 9);
    const [piece] = liftPcurve(g, torus, box);
    const first = piece.pts[0];
    const last = piece.pts[piece.pts.length - 1];
    expect(Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2])).toBeLessThan(0.05);
  });

  it("caps the seeds of a tightly wound helix so sampling stays within its point budget", () => {
    const tight = on({ type: "line", o: [0, 0, 0], d: [1, 1e-6, 0] }); // millions of turns across the v window
    const [range] = pcurveRanges(tight, cylinder, box);
    expect(pcurveSeeds(tight.curve, cylinder, range[0], range[1])).toBe(2048);
    const pieces = liftPcurve(tight, cylinder, box);
    expect(pieces.reduce((n, p) => n + p.pts.length, 0)).toBeLessThanOrEqual(4096);
  });

  it("closes a slope-2 line on a torus after one turn in v", () => {
    const torus: SurfaceGeom = { type: "torus", frame: world, R: 3, r: 1 };
    const [range, ...rest] = pcurveRanges(on({ type: "line", o: [0, 0, 0], d: [2, 1, 0] }), torus, box); // u = 2v
    expect(rest).toEqual([]);
    expect(range[1] - range[0]).toBeCloseTo(2 * Math.PI, 9);
  });

  it("draws a torus line written outside the window, whole periods away", () => {
    const torus: SurfaceGeom = { type: "torus", frame: world, R: 3, r: 1 };
    const near = liftPcurve(on({ type: "line", o: [1, 0, 0], d: [1, 1, 0] }), torus, box)[0]; // u = v + 1
    const far = liftPcurve(on({ type: "line", o: [1 + 4 * Math.PI, -2 * Math.PI, 0], d: [1, 1, 0] }), torus, box)[0];
    expect(far).toBeDefined();
    expect(far.pts.length).toBeGreaterThan(16);
    for (const p of far.pts) {
      // every lifted point lies on the near copy's loop: same curve on the surface
      const closest = Math.min(...near.pts.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));
      expect(closest).toBeLessThan(0.05);
    }
  });
});
