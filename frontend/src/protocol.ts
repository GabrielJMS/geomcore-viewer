// Scene protocol v1 types. Mirrors protocol/SCENE.md.

export type EntityKind = "curve3d" | "curve2d" | "surface" | "points3d" | "points2d";

export interface Entity {
  id: string;
  kind: EntityKind;
  name?: string;
  color?: string;
  /** curve3d: [x,y,z][] · curve2d: [u,v][] */
  points?: number[][];
  /** surface */
  vertices?: number[][];
  indices?: number[];
  /** points3d / points2d */
  positions?: number[][];
  size?: number;
}

export interface SceneDoc {
  version: number;
  entities: Entity[];
}

export function isEntity(value: unknown): value is Entity {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e["id"] === "string" &&
    ["curve3d", "curve2d", "surface", "points3d", "points2d"].includes(e["kind"] as string)
  );
}
