import { describe, expect, it } from "vitest";
import type { Box } from "../src/geom/vec";
import { ground } from "../src/view3d/scene";

describe("ground", () => {
  const box: Box = { min: [-7.5, -7.5, -7.5], max: [7.5, 7.5, 7.5] };

  it("rules z = 0 across the view box with a 1-2-5 major step, about ten cells", () => {
    const g = ground(box);
    expect(g.majorStep).toBe(2); // niceStep(7.5 / 5)
    const xs = g.major.filter((l) => l[0][0] === l[1][0]).map((l) => l[0][0]);
    expect(xs).toEqual([-6, -4, -2, 0, 2, 4, 6]);
    for (const l of g.major) {
      expect(l.every((p) => p[2] === 0)).toBe(true);
    }
    expect(g.major.find((l) => l[0][1] === l[1][1])).toEqual([[-7.5, -6, 0], [7.5, -6, 0]]);
  });

  it("puts minor lines between the major ones only (a 2 step splits in 4)", () => {
    const xs = ground(box).minor.filter((l) => l[0][0] === l[1][0]).map((l) => l[0][0]);
    expect(xs).toContain(-0.5);
    expect(xs).not.toContain(0);
    expect(xs).not.toContain(2);
    expect(xs).toHaveLength(31 - 7); // the 31 multiples of 0.5 in [-7.5, 7.5], less the 7 majors
  });

  it("draws the axis triad two major steps long, x red, y green, z blue", () => {
    const { axes } = ground(box);
    expect(axes.map((a) => [a.name, a.to])).toEqual([["x", [4, 0, 0]], ["y", [0, 4, 0]], ["z", [0, 0, 4]]]);
    expect(new Set(axes.map((a) => a.color)).size).toBe(3);
  });

  it("follows the scene's scale", () => {
    expect(ground({ min: [0, 0, 0], max: [0.03, 0.03, 0.03] }).majorStep).toBe(0.005);
  });
});
