// Scene protocol v2: types, validation and v1 migration. Mirrors protocol/SCENE.md.
import { CURVE_TYPES, Geom, SURFACE_TYPES } from "./geom/types";
import type { Vec3 } from "./geom/vec";

export const PROTOCOL = 2;

export interface Style {
  color?: string;
  width?: number;
  dashed?: boolean;
  opacity?: number;
}

export interface SceneObject {
  id: string;
  geom: Geom;
  label?: string;
  group?: string;
  source?: string;
  style?: Style;
  extras?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export type ViewMode = "auto" | "2d" | "3d";

export interface SceneDoc {
  version: 2;
  title: string;
  run: string | null;
  view: ViewMode;
  objects: SceneObject[];
}

export interface Problem {
  id: string;
  message: string;
}

export type ServerEvent =
  | { type: "run"; run: string; keep: boolean }
  | { type: "upsert"; objects: unknown[]; title?: string; view?: string }
  | { type: "remove"; id: string }
  | { type: "clear" };

type FieldKind = "vec" | "vecs" | "num" | "nums" | "frame" | "str";

const FIELDS: Record<string, Record<string, FieldKind>> = {
  line: { o: "vec", d: "vec" },
  circle: { frame: "frame", r: "num" },
  ellipse: { frame: "frame", a: "num", b: "num" },
  parabola: { frame: "frame", f: "num" },
  hyperbola: { frame: "frame", a: "num", b: "num" },
  plane: { frame: "frame" },
  cylinder: { frame: "frame", r: "num" },
  cone: { frame: "frame", semi_angle: "num", ref_radius: "num" },
  sphere: { frame: "frame", r: "num" },
  torus: { frame: "frame", R: "num", r: "num" },
  polyline: { points: "vecs" },
  mesh: { vertices: "vecs", indices: "nums" },
  point: { p: "vec" },
  points: { positions: "vecs" },
  arrow: { at: "vec", vec: "vec" },
  text: { at: "vec", text: "str" },
  note: { text: "str" },
};
const POSITIVE = ["r", "a", "b", "R"];
const VIEWS: ReadonlySet<string> = new Set(["auto", "2d", "3d"]);

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function asVec(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || (v.length !== 2 && v.length !== 3) || !v.every(finite)) return null;
  return [v[0], v[1], v.length === 3 ? v[2] : 0];
}

function normalize(value: unknown, kind: FieldKind): unknown {
  switch (kind) {
    case "vec":
      return asVec(value);
    case "vecs": {
      if (!Array.isArray(value)) return null;
      const vecs = value.map(asVec);
      return vecs.every((v) => v !== null) ? vecs : null;
    }
    case "num":
      return finite(value) ? value : null;
    case "nums":
      return Array.isArray(value) && value.every((i) => Number.isInteger(i) && i >= 0) ? value : null;
    case "str":
      return typeof value === "string" ? value : null;
    case "frame": {
      if (typeof value !== "object" || value === null) return null;
      const f = value as Record<string, unknown>;
      const axes = ["o", "x", "y", "z"].map((k) => asVec(f[k]));
      return axes.every((a) => a !== null) ? { o: axes[0], x: axes[1], y: axes[2], z: axes[3] } : null;
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const record = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const isRange = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(finite);

function validWindow(w: unknown): boolean {
  const r = record(w);
  return r !== undefined && (r.u === undefined || isRange(r.u)) && (r.v === undefined || isRange(r.v));
}

/** Validate one object (v1 entities are migrated first). Never throws. */
export function parseObject(raw: unknown): { object: SceneObject } | { problem: Problem } {
  const r = record(raw);
  if (!r) return { problem: { id: "?", message: "object is not a JSON object" } };
  if (typeof r.kind === "string") return parseObject(migrateV1(r));
  const id = typeof r.id === "string" ? r.id : "?";
  const fail = (message: string) => ({ problem: { id, message } });
  if (id === "?") return fail("missing string id");
  const g = record(r.geom);
  if (!g || typeof g.type !== "string") return fail("missing geom.type");
  const fields = Object.prototype.hasOwnProperty.call(FIELDS, g.type) ? FIELDS[g.type] : undefined;
  if (!fields) return fail(`unknown type "${g.type}"`);
  const geom: Record<string, unknown> = { ...g };
  for (const [key, kind] of Object.entries(fields)) {
    const value = normalize(g[key], kind);
    if (value === null) return fail(`${g.type}.${key} is missing or malformed`);
    geom[key] = value;
  }
  for (const key of POSITIVE) if (key in fields && (geom[key] as number) <= 0) return fail(`${g.type}.${key} must be positive`);
  if (g.type === "parabola" && geom.f === 0) return fail("parabola.f must be non-zero");
  if (g.type === "line" && Math.hypot(...(geom.d as Vec3)) === 0) return fail("line.d must be non-zero");
  if (g.type === "polyline" && (geom.points as Vec3[]).length < 2) return fail("polyline.points needs at least 2 points");
  if (g.type === "points" && (geom.positions as Vec3[]).length === 0) return fail("points.points must not be empty");
  if (g.type === "mesh") {
    if ((geom.indices as number[]).length === 0) return fail("mesh.indices must be a non-empty multiple of 3");
    const n = (geom.vertices as Vec3[]).length;
    const idx = geom.indices as number[];
    if (idx.length % 3 !== 0 || idx.some((i) => i >= n)) return fail("mesh.indices must be triangles indexing vertices");
  }
  if (SURFACE_TYPES.has(g.type) && g.window !== undefined && !validWindow(g.window)) {
    return fail(`${g.type}.window must be {u?: [a, b], v?: [a, b]}`);
  }
  if (CURVE_TYPES.has(g.type) && g.range !== undefined) {
    const range = g.range;
    if (!Array.isArray(range) || range.length !== 2 || !range.every(finite)) return fail(`${g.type}.range must be [t0, t1]`);
  }
  const object: SceneObject = { id, geom: geom as unknown as Geom };
  const label = str(r.label);
  if (label) object.label = label;
  const group = str(r.group);
  if (group) object.group = group;
  const source = str(r.source);
  if (source) object.source = source;
  const style = record(r.style);
  if (style) object.style = style as Style;
  const extras = record(r.extras);
  if (extras) object.extras = extras;
  const meta = record(r.meta);
  if (meta) object.meta = meta;
  return { object };
}

/** v1 entity → v2 object (see SCENE.md "Compatibility"). */
export function migrateV1(e: Record<string, unknown>): Record<string, unknown> {
  const style: Style = {};
  if (typeof e.color === "string") style.color = e.color;
  if (typeof e.opacity === "number") style.opacity = e.opacity;
  const base: Record<string, unknown> = { id: e.id, label: e.name, style };
  switch (e.kind) {
    case "curve3d":
    case "curve2d":
      return { ...base, geom: { type: "polyline", points: e.points } };
    case "surface":
      return { ...base, geom: { type: "mesh", vertices: e.vertices, indices: e.indices } };
    case "points3d":
    case "points2d":
      return { ...base, geom: { type: "points", positions: e.positions, ...(e.size !== undefined ? { size: e.size } : {}) } };
    default:
      return { ...base, geom: { type: `v1:${String(e.kind)}` } };
  }
}

export class VersionError extends Error {}

/** Parse a v1 or v2 document; invalid objects become problems, other versions throw. */
export function parseDoc(raw: unknown): { doc: SceneDoc; problems: Problem[] } {
  const r = record(raw) ?? {};
  const items = r.version === 1 ? r.entities : r.version === PROTOCOL ? r.objects : undefined;
  if (!Array.isArray(items)) throw new VersionError(`unsupported scene version ${String(r.version)} (this viewer reads 1 and 2)`);
  const objects: SceneObject[] = [];
  const problems: Problem[] = [];
  for (const item of items) {
    const parsed = parseObject(item);
    if ("object" in parsed) objects.push(parsed.object);
    else problems.push(parsed.problem);
  }
  const view = typeof r.view === "string" && VIEWS.has(r.view) ? (r.view as ViewMode) : "auto";
  return { doc: { version: 2, title: str(r.title) ?? "", run: str(r.run) ?? null, view, objects }, problems };
}
