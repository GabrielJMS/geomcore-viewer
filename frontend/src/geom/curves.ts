import type { CurveGeom, Range } from "./types";
import { Box, Vec3, add, dot, inFrame, norm, scale, sub } from "./vec";

const TAU = 2 * Math.PI;

/** Point at parameter `t` — formulas identical to geomcore (protocol/SCENE.md). */
export function evalCurve(g: CurveGeom, t: number): Vec3 {
  switch (g.type) {
    case "line":
      return add(g.o, scale(g.d, t));
    case "circle":
      return inFrame(g.frame, g.r * Math.cos(t), g.r * Math.sin(t));
    case "ellipse":
      return inFrame(g.frame, g.a * Math.cos(t), g.b * Math.sin(t));
    case "parabola":
      return inFrame(g.frame, (t * t) / (4 * g.f), t);
    case "hyperbola":
      return inFrame(g.frame, g.a * Math.cosh(t), g.b * Math.sinh(t));
  }
}

/**
 * Parameter interval to draw: the explicit `range`, one full period for
 * closed curves, or — for infinite curves — an interval guaranteed to
 * contain every parameter whose point lies in `box` (the box sits inside a
 * ball of radius `reach` around the curve origin, and each bound below
 * inverts a lower bound on |P(t) − o|).
 */
export function curveRange(g: CurveGeom, box: Box): Range {
  if (g.range) return g.range;
  if (g.type === "circle" || g.type === "ellipse") return [0, TAU];
  const center = scale(add(box.min, box.max), 0.5);
  const radius = norm(sub(box.max, box.min)) / 2;
  if (g.type === "line") {
    const speed = norm(g.d);
    const tc = dot(sub(center, g.o), g.d) / (speed * speed);
    return [tc - radius / speed, tc + radius / speed];
  }
  const reach = norm(sub(center, g.frame.o)) + radius;
  if (g.type === "parabola") return [-reach, reach]; // |P − o| ≥ |t|
  const t = Math.asinh(reach / Math.max(g.a, g.b)); // |P − o| ≥ max(a, b)·sinh|t|
  return [-t, t];
}
