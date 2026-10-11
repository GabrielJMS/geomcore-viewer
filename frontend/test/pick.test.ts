import { describe, expect, it } from "vitest";
import { Pickable, pickNearest } from "../src/view2d/pick";

const curve: Pickable = { id: "C", polylines: [{ pts: [[0, 100], [200, 100]], ts: [0, 2] }], dots: [] };
const point: Pickable = { id: "P", polylines: [], dots: [{ at: [100, 103], index: 0 }] };

describe("pickNearest", () => {
  it("finds a curve within 8 px and interpolates its parameter", () => {
    const hit = pickNearest([curve], 50, 106);
    expect(hit).toMatchObject({ id: "C", dist: 6, at: [50, 100], index: null });
    expect(hit!.t).toBeCloseTo(0.5, 12);
  });

  it("misses beyond the radius", () => {
    expect(pickNearest([curve], 50, 109)).toBeNull();
  });

  it("prefers a point over a curve passing under it", () => {
    expect(pickNearest([curve, point], 100, 101)?.id).toBe("P");
    expect(pickNearest([point, curve], 100, 101)?.id).toBe("P");
  });

  it("keeps the curve when the pointer is right on it and the point is farther", () => {
    const below: Pickable = { id: "P", polylines: [], dots: [{ at: [100, 107], index: 0 }] };
    expect(pickNearest([curve, below], 100, 100)?.id).toBe("C");
  });

  it("reports which dot of a points object was hit", () => {
    const cloud: Pickable = { id: "S", polylines: [], dots: [{ at: [0, 0], index: 0 }, { at: [20, 0], index: 1 }] };
    expect(pickNearest([cloud], 18, 2)).toMatchObject({ id: "S", index: 1, t: null, at: [20, 0] });
  });
});
