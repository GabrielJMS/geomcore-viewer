import { describe, expect, it } from "vitest";
import curves from "./fixtures/curves_analytic.json";
import surfaces from "./fixtures/surfaces_analytic.json";
import { curveRange, evalCurve } from "../src/geom/curves";
import { evalSurface, surfaceWindow } from "../src/geom/surfaces";
import type { CurveGeom, SurfaceGeom } from "../src/geom/types";
import { Box, Frame, Vec3, norm, sub } from "../src/geom/vec";

type FxFrame = { origin: Vec3; x_dir: Vec3; y_dir: Vec3; z_dir: Vec3 };
type CurveSample = { u: number; point: Vec3 };
type SurfaceSample = { u: number; v: number; point: Vec3 };
const frame = (f: FxFrame): Frame => ({ o: f.origin, x: f.x_dir, y: f.y_dir, z: f.z_dir });

function expectClose(got: Vec3, want: Vec3): void {
  expect(norm(sub(got, want))).toBeLessThanOrEqual(1e-9 * Math.max(1, norm(want)));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const curveCases: [string, CurveGeom, CurveSample[]][] = [
  ...curves.lines.map((c: any): [string, CurveGeom, CurveSample[]] => ["line", { type: "line", o: c.origin, d: c.direction }, c.samples]),
  ...curves.circles.map((c: any): [string, CurveGeom, CurveSample[]] => ["circle", { type: "circle", frame: frame(c.frame), r: c.radius }, c.samples]),
  ...curves.ellipses.map((c: any): [string, CurveGeom, CurveSample[]] => ["ellipse", { type: "ellipse", frame: frame(c.frame), a: c.major_radius, b: c.minor_radius }, c.samples]),
  ...curves.parabolas.map((c: any): [string, CurveGeom, CurveSample[]] => ["parabola", { type: "parabola", frame: frame(c.frame), f: c.focal }, c.samples]),
  ...curves.hyperbolas.map((c: any): [string, CurveGeom, CurveSample[]] => ["hyperbola", { type: "hyperbola", frame: frame(c.frame), a: c.major_radius, b: c.minor_radius }, c.samples]),
];

const surfaceCases: [string, SurfaceGeom, SurfaceSample[]][] = [
  ...surfaces.planes.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["plane", { type: "plane", frame: frame(c.frame) }, c.samples]),
  ...surfaces.cylinders.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["cylinder", { type: "cylinder", frame: frame(c.frame), r: c.radius }, c.samples]),
  ...surfaces.cones.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["cone", { type: "cone", frame: frame(c.frame), semi_angle: c.semi_angle, ref_radius: c.ref_radius }, c.samples]),
  ...surfaces.spheres.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["sphere", { type: "sphere", frame: frame(c.frame), r: c.radius }, c.samples]),
  ...surfaces.tori.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["torus", { type: "torus", frame: frame(c.frame), R: c.major_radius, r: c.minor_radius }, c.samples]),
];
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("evalCurve matches geomcore goldens", () => {
  it.each(curveCases)("%s", (_name, g, samples) => {
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expectClose(evalCurve(g, s.u), s.point);
  });
});

describe("evalSurface matches geomcore goldens", () => {
  it.each(surfaceCases)("%s", (_name, g, samples) => {
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expectClose(evalSurface(g, s.u, s.v), s.point);
  });
});

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const unitBox: Box = { min: [-1, -1, -1], max: [1, 1, 1] };
const inBox = (p: Vec3, b: Box) => p.every((c, i) => c >= b.min[i] && c <= b.max[i]);

describe("curveRange", () => {
  it("covers a box far from a line's origin", () => {
    const [t0, t1] = curveRange({ type: "line", o: [100, 0, 0], d: [1, 0, 0] }, unitBox);
    expect(t0).toBeLessThanOrEqual(-101);
    expect(t1).toBeGreaterThanOrEqual(-99);
  });

  it.each<CurveGeom>([
    { type: "parabola", frame: world, f: 0.25 },
    { type: "hyperbola", frame: { ...world, o: [-1.5, 0, 0] }, a: 1, b: 0.5 },
  ])("leaves the box just outside its range (%#)", (g) => {
    const [t0, t1] = curveRange(g, unitBox);
    expect(inBox(evalCurve(g, t1 * 1.01 + 1e-6), unitBox)).toBe(false);
    expect(inBox(evalCurve(g, t0 * 1.01 - 1e-6), unitBox)).toBe(false);
  });

  it("uses full periods and explicit ranges", () => {
    expect(curveRange({ type: "circle", frame: world, r: 1 }, unitBox)).toEqual([0, 2 * Math.PI]);
    expect(curveRange({ type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [2, 3] }, unitBox)).toEqual([2, 3]);
  });
});

describe("surfaceWindow", () => {
  it("fills full periods and flags assumed infinite directions", () => {
    expect(surfaceWindow({ type: "sphere", frame: world, r: 1 }, 5)).toEqual({ u: [0, 2 * Math.PI], v: [-Math.PI / 2, Math.PI / 2], assumed: false });
    expect(surfaceWindow({ type: "plane", frame: world }, 5)).toEqual({ u: [-5, 5], v: [-5, 5], assumed: true });
    expect(surfaceWindow({ type: "cylinder", frame: world, r: 1, window: { v: [0, 2] } }, 5)).toEqual({ u: [0, 2 * Math.PI], v: [0, 2], assumed: false });
  });
});
