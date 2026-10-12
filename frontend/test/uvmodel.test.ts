import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { viewBox } from "../src/geom/bounds";
import type { Geom } from "../src/geom/types";
import type { Frame, Vec2 } from "../src/geom/vec";
import type { SceneObject } from "../src/protocol";
import { uvModel, uvSubject, wrapAxis, wrapUv } from "../src/viewuv/model";

const TAU = 2 * Math.PI;
const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const obj = (id: string, geom: Geom, extra: Partial<SceneObject> = {}): SceneObject => ({ id, geom, ...extra });
const byId = (...objects: SceneObject[]) => new Map(objects.map((o) => [o.id, o]));
const cylinder = obj("Y", { type: "cylinder", frame: world, r: 2, window: { v: [-1, 4] } });
const sphere = obj("S", { type: "sphere", frame: world, r: 1 });
const ring = obj("ring", { type: "pcurve", surface: "Y", curve: { type: "line", o: [0, 1.5, 0], d: [1, 0, 0] } });
const lost = obj("lost", { type: "pcurve", surface: "gone", curve: { type: "line", o: [0, 0, 0], d: [1, 0, 0] } });
const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9));

describe("uvSubject", () => {
  it("shows the selected surface, or the surface of the selected pcurve", () => {
    const objects = byId(sphere, cylinder, ring);
    expect(uvSubject(objects, "S")?.id).toBe("S");
    expect(uvSubject(objects, "ring")?.id).toBe("Y");
  });

  it("else shows the surface of the first pcurve whose surface exists", () => {
    expect(uvSubject(byId(sphere, lost, cylinder, ring), null)?.id).toBe("Y");
    expect(uvSubject(byId(sphere, cylinder, ring, obj("P", { type: "point", p: [0, 0, 0] })), "P")?.id).toBe("Y");
  });

  it("is null with no pcurve and no surface selected (the pane stays hidden)", () => {
    expect(uvSubject(byId(sphere, cylinder), null)).toBeNull();
    expect(uvSubject(byId(sphere, lost), "lost")).toBeNull();
  });
});

describe("wrapAxis", () => {
  it("cuts a path at each seam it crosses and shifts the pieces into the window, both ways", () => {
    // u from -1 to 4π + 1 while v goes 0 → 2: seams at u = 0, 2π and 4π.
    const span = 4 * Math.PI + 2;
    const vAt = (u: number) => (2 * (u + 1)) / span;
    const pieces = wrapAxis([[-1, 0], [4 * Math.PI + 1, 2]], 0, 0, TAU);
    expect(pieces).toHaveLength(4);
    close(pieces[0][0], [TAU - 1, 0]); // u = -1 is u = 2π − 1 one turn on
    close(pieces[0][1], [TAU, vAt(0)]); // it meets the seam …
    close(pieces[1][0], [0, vAt(0)]); // … and carries on from the other side
    close(pieces[2][0], [0, vAt(TAU)]);
    close(pieces[3][1], [1, 2]);
    expect(wrapAxis([[1, 0], [-1, 0]], 0, 0, TAU)).toEqual([[[1, 0], [0, 0]], [[TAU, 0], [TAU - 1, 0]]]);
  });

  it("leaves no zero-length piece when the path ends on a seam", () => {
    expect(wrapAxis([[0, 1], [TAU / 2, 1], [TAU, 1]], 0, 0, TAU)).toHaveLength(1);
  });
});

describe("uvModel", () => {
  const doc = JSON.parse(readFileSync(new URL("../e2e/scenes/pcurve.json", import.meta.url), "utf8")) as { objects: SceneObject[] };
  const objects = doc.objects;
  const subject = objects[0];
  const box = viewBox(objects.map((o) => o.geom));
  const m = uvModel(objects, subject, box, () => true);

  it("takes the window the 3D view draws, with its seams", () => {
    expect(m.u).toEqual([0, TAU]);
    expect(m.v).toEqual([-1, 4]);
    expect(m.period).toEqual({ u: TAU, v: null });
    expect(m.seams).toEqual({ u: [0, TAU], v: [] });
  });

  it("draws the ring as one line across the window and the helix wrapped at every seam", () => {
    const ringPaths = m.curves.find((c) => c.id === "ring")!.paths;
    expect(ringPaths).toHaveLength(1);
    close(ringPaths[0][0], [0, 1.5]);
    close(ringPaths[0][ringPaths[0].length - 1], [TAU, 1.5]);
    const helix = m.curves.find((c) => c.id === "helix")!;
    expect(helix.paths).toHaveLength(4); // v = u/4 over v ∈ [-1, 4]: u from -4 to 16, cells -1 … 2
    for (const p of helix.paths) for (const q of p) expect(q[0] >= -1e-9 && q[0] <= TAU + 1e-9).toBe(true);
    expect(m.curves.find((c) => c.id === "zigzag")).toMatchObject({ dashed: true, paths: [expect.any(Array)] });
  });

  it("leaves hidden pcurves out, and wraps a hover point into the window", () => {
    expect(uvModel(objects, subject, box, (o) => o.id !== "helix").curves.map((c) => c.id)).toEqual(["ring", "zigzag"]);
    close(wrapUv(m, [-1, 7]), [TAU - 1, 7]);
  });
});
