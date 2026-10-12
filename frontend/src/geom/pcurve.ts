import { Geom, PcurveGeom, SurfaceGeom, isSurface } from "./types";

/**
 * The surface a pcurve lies on, or null when its id names no object or one that is not a
 * surface. Such a pcurve is kept (its surface may arrive later) but not drawn; the panel
 * flags it.
 */
export function pcurveSurface(g: PcurveGeom, lookup: (id: string) => Geom | undefined): SurfaceGeom | null {
  const s = lookup(g.surface);
  return s && isSurface(s) ? s : null;
}
