import { describe, expect, it } from "vitest";
import { dashPolyline, sampleAdaptive, segmentDistance } from "../src/geom/sample";
import type { Vec2 } from "../src/geom/vec";

const TAU = 2 * Math.PI;
const circle = (r: number) => (t: number): Vec2 => [r * Math.cos(t), r * Math.sin(t)];

describe("segmentDistance", () => {
  it("measures to the segment, not the infinite line", () => {
    expect(segmentDistance([5, 3], [0, 0], [10, 0])).toBe(3);
    expect(segmentDistance([13, 4], [0, 0], [10, 0])).toBe(5);
    expect(segmentDistance([1, 1], [0, 0], [0, 0])).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe("sampleAdaptive", () => {
  it("keeps a straight map at the 16 seed segments, ends exact", () => {
    const { pts, ts } = sampleAdaptive((t) => [t, 2 * t], 0, 1);
    expect(pts.length).toBe(17);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[16]).toEqual([1, 2]);
    expect(ts[0]).toBe(0);
    expect(ts[16]).toBe(1);
  });

  it("stays within a quarter pixel of a 100 px circle", () => {
    const f = circle(100);
    const { pts, ts } = sampleAdaptive(f, 0, TAU);
    expect(ts.length).toBe(pts.length);
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const s of [0.25, 0.5, 0.75]) {
        const p = f(ts[i] + s * (ts[i + 1] - ts[i]));
        expect(segmentDistance(p, pts[i], pts[i + 1])).toBeLessThanOrEqual(0.25 + 1e-9);
      }
    }
  });

  it("caps the points at extreme zoom and still ends at t1", () => {
    const { pts, ts } = sampleAdaptive(circle(1e9), 0, TAU);
    expect(pts.length).toBeLessThanOrEqual(4096);
    expect(ts[ts.length - 1]).toBe(TAU);
  });

  it("does not refine a curve smaller than a pixel, nor one that evaluates to NaN", () => {
    expect(sampleAdaptive(circle(1e-6), 0, TAU).pts.length).toBe(17);
    expect(sampleAdaptive(() => [NaN, NaN], 0, 1).pts.length).toBe(17);
  });
});

describe("dashPolyline", () => {
  it("cuts a straight line into dashes of the given length", () => {
    const dashes = dashPolyline([[0, 0], [100, 0]], 6, 4);
    expect(dashes.length).toBe(10);
    expect(dashes[0]).toEqual([[0, 0], [6, 0]]);
    expect(dashes[1]).toEqual([[10, 0], [16, 0]]);
    expect(dashes[9]).toEqual([[90, 0], [96, 0]]);
  });

  it("carries a dash around a corner", () => {
    const dashes = dashPolyline([[0, 0], [5, 0], [5, 5]], 6, 4);
    expect(dashes).toEqual([[[0, 0], [5, 0], [5, 1]]]);
  });

  it("falls back to a solid line rather than produce too many dashes", () => {
    const line: Vec2[] = [[0, 0], [1e6, 0]];
    expect(dashPolyline(line, 1, 1)).toEqual([line]);
  });

  it("gives nothing for a single point", () => {
    expect(dashPolyline([[1, 1]], 6, 4)).toEqual([]);
  });
});
