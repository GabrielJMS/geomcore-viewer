import { halfSize } from "../geom/bounds";
import type { Box, Vec3 } from "../geom/vec";
import { gridSpacing, ticks } from "../view2d/plane";

/** The axis triad's colours: x red, y green, z blue. */
export const AXIS_COLORS = { x: "#d64545", y: "#3c9a4a", z: "#3b6fd4" } as const;

export interface Ground {
  /** Grid lines on z = 0 across the view box, major every `major`, minor between them. */
  major: Vec3[][];
  minor: Vec3[][];
  majorStep: number;
  /** The axis triad from the origin, two major steps long, each with its letter at the tip. */
  axes: { name: "x" | "y" | "z"; to: Vec3; color: string }[];
}

/** Spec §5.3: a ground grid on z = 0 under the scene, about ten major cells across the view box, and the axis triad. */
export function ground(box: Box): Ground {
  const { major, minor } = gridSpacing(1, halfSize(box) / 5);
  const [x0, x1] = [box.min[0], box.max[0]];
  const [y0, y1] = [box.min[1], box.max[1]];
  const lines = (step: number, skip: number | null): Vec3[][] => {
    const keep = (v: number) => skip === null || Math.abs(v / skip - Math.round(v / skip)) > 1e-9;
    return [
      ...ticks(x0, x1, step).filter(keep).map((x): Vec3[] => [[x, y0, 0], [x, y1, 0]]),
      ...ticks(y0, y1, step).filter(keep).map((y): Vec3[] => [[x0, y, 0], [x1, y, 0]]),
    ];
  };
  const len = 2 * major;
  return {
    major: lines(major, null),
    minor: lines(minor, major),
    majorStep: major,
    axes: [
      { name: "x", to: [len, 0, 0], color: AXIS_COLORS.x },
      { name: "y", to: [0, len, 0], color: AXIS_COLORS.y },
      { name: "z", to: [0, 0, len], color: AXIS_COLORS.z },
    ],
  };
}
