import { describe, expect, it } from "vitest";
import { cameraScale } from "../src/camera";

describe("cameraScale", () => {
  it("keeps Babylon's default feel at a radius of 10", () => {
    const s = cameraScale(10);
    expect(s.wheelPrecision).toBeCloseTo(3);
    expect(s.panningSensibility).toBeCloseTo(1000);
  });

  it("scales the clip planes and input feel with the scene", () => {
    const small = cameraScale(0.01);
    const large = cameraScale(1000);
    expect(small.minZ).toBeCloseTo(1e-5);
    expect(small.maxZ).toBeCloseTo(1);
    expect(large.maxZ).toBeCloseTo(1e5);
    expect(small.wheelPrecision).toBeGreaterThan(large.wheelPrecision);
    expect(small.panningSensibility).toBeGreaterThan(large.panningSensibility);
  });
});
