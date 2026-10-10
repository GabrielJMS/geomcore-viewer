import { describe, expect, it } from "vitest";
import { VersionError, parseDoc, parseObject } from "../src/protocol";

const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

describe("parseObject", () => {
  it("accepts a valid analytic object and pads 2D vectors", () => {
    const r = parseObject({ id: "L", label: "L", geom: { type: "line", o: [0, 1], d: [1, 0] } });
    expect(r).toEqual({ object: { id: "L", label: "L", geom: { type: "line", o: [0, 1, 0], d: [1, 0, 0] } } });
  });

  it.each([
    [{ geom: { type: "point", p: [0, 0, 0] } }, "?", "missing string id"],
    [{ id: "a", geom: { type: "foo" } }, "a", 'unknown type "foo"'],
    [{ id: "a", geom: { type: "circle", frame, r: -1 } }, "a", "circle.r must be positive"],
    [{ id: "a", geom: { type: "parabola", frame, f: 0 } }, "a", "parabola.f must be non-zero"],
    [{ id: "a", geom: { type: "ellipse", frame, a: 1 } }, "a", "ellipse.b is missing or malformed"],
    [{ id: "a", geom: { type: "mesh", vertices: [[0, 0, 0]], indices: [0, 0] } }, "a", "mesh.indices must be triangles indexing vertices"],
    [{ id: "a", geom: { type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [1] } }, "a", "line.range must be [t0, t1]"],
    [{ id: "a", geom: { type: "point", p: [0, NaN, 0] } }, "a", "point.p is missing or malformed"],
    [{ id: "a", geom: { type: "line", o: [0, 0, 0], d: [0, 0, 0] } }, "a", "line.d must be non-zero"],
    [{ id: "a", geom: { type: "plane", frame, window: { u: [1] } } }, "a", "plane.window must be {u?: [a, b], v?: [a, b]}"],
    [{ id: "a", geom: { type: "polyline", points: [] } }, "a", "polyline.points needs at least 2 points"],
    [{ id: "a", geom: { type: "polyline", points: [[0, 0, 0]] } }, "a", "polyline.points needs at least 2 points"],
    [{ id: "a", geom: { type: "points", positions: [] } }, "a", "points.points must not be empty"],
    [{ id: "a", geom: { type: "mesh", vertices: [[0, 0, 0]], indices: [] } }, "a", "mesh.indices must be a non-empty multiple of 3"],
    [{ id: "a", geom: { type: "constructor" } }, "a", 'unknown type "constructor"'],
  ])("rejects %j", (raw, id, message) => {
    expect(parseObject(raw)).toEqual({ problem: { id, message } });
  });
});

describe("parseDoc", () => {
  it("migrates v1 entities", () => {
    const { doc, problems } = parseDoc({
      version: 1,
      entities: [
        { id: "c", kind: "curve2d", name: "pc", color: "#f00", points: [[0, 0], [1, 1]] },
        { id: "s", kind: "surface", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 2], opacity: 0.5 },
        { id: "q", kind: "points3d", positions: [[0, 0, 0]], size: 3 },
        { id: "x", kind: "hologram" },
      ],
    });
    expect(doc.objects[0]).toEqual({ id: "c", label: "pc", style: { color: "#f00" }, geom: { type: "polyline", points: [[0, 0, 0], [1, 1, 0]] } });
    expect(doc.objects[1].style).toEqual({ opacity: 0.5 });
    expect(doc.objects[2].geom).toEqual({ type: "points", positions: [[0, 0, 0]], size: 3 });
    expect(problems).toEqual([{ id: "x", message: 'unknown type "v1:hologram"' }]);
  });

  it("reads v2 metadata and rejects other versions", () => {
    const { doc } = parseDoc({ version: 2, title: "t", run: "r", view: "2d", objects: [] });
    expect(doc).toEqual({ version: 2, title: "t", run: "r", view: "2d", objects: [] });
    expect(() => parseDoc({ version: 3, objects: [] })).toThrow(VersionError);
  });
});
