import type { Range, SurfaceGeom } from "./types";
import { Vec3, inFrame } from "./vec";

const TAU = 2 * Math.PI;

/** Point at `(u, v)` — formulas identical to geomcore (protocol/SCENE.md). */
export function evalSurface(g: SurfaceGeom, u: number, v: number): Vec3 {
  switch (g.type) {
    case "plane":
      return inFrame(g.frame, u, v);
    case "cylinder":
      return inFrame(g.frame, g.r * Math.cos(u), g.r * Math.sin(u), v);
    case "cone": {
      const radius = g.ref_radius + v * Math.sin(g.semi_angle);
      return inFrame(g.frame, radius * Math.cos(u), radius * Math.sin(u), v * Math.cos(g.semi_angle));
    }
    case "sphere": {
      const rc = g.r * Math.cos(v);
      return inFrame(g.frame, rc * Math.cos(u), rc * Math.sin(u), g.r * Math.sin(v));
    }
    case "torus": {
      const rho = g.R + g.r * Math.cos(v);
      return inFrame(g.frame, rho * Math.cos(u), rho * Math.sin(u), g.r * Math.sin(v));
    }
  }
}

/** Full periods of closed parameter directions; null where the surface is infinite. */
export function naturalWindow(g: SurfaceGeom): { u: Range | null; v: Range | null } {
  switch (g.type) {
    case "plane":
      return { u: null, v: null };
    case "cylinder":
    case "cone":
      return { u: [0, TAU], v: null };
    case "sphere":
      return { u: [0, TAU], v: [-Math.PI / 2, Math.PI / 2] };
    case "torus":
      return { u: [0, TAU], v: [0, TAU] };
  }
}

/** Window to tessellate: explicit, else natural, else ±fallbackHalf (`assumed` = a fallback was used). */
export function surfaceWindow(g: SurfaceGeom, fallbackHalf: number): { u: Range; v: Range; assumed: boolean } {
  const natural = naturalWindow(g);
  const fallback: Range = [-fallbackHalf, fallbackHalf];
  const u = g.window?.u ?? natural.u;
  const v = g.window?.v ?? natural.v;
  return { u: u ?? fallback, v: v ?? fallback, assumed: u === null || v === null };
}
