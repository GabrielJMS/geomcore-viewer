import { describe, expect, it } from "vitest";
import type { SceneObject } from "../src/protocol";
import { Store } from "../src/store";
import { panelModel } from "../src/ui/panel";
import { UiState } from "../src/ui/state";

const obj = (id: string, geom: unknown, extra: Partial<SceneObject> = {}) => ({ id, geom, ...extra }) as SceneObject;
const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

function storeOf(objects: SceneObject[]): Store {
  const store = new Store();
  store.reset({ version: 2, title: "", run: null, view: "auto", objects }, [{ id: "bad", message: "unknown type" }]);
  return store;
}

const scene = [
  obj("E", { type: "ellipse", frame, a: 3, b: 2 }, { group: "conics", style: { color: "#d1495b" } }),
  obj("P₁", { type: "point", p: [1.8412, 1.62, 0] }, { group: "intersections", label: "P₁" }),
  obj("note", { type: "note", text: "2 tangent points", level: "warn" }),
  obj("C", { type: "circle", frame, r: 1 }, { group: "conics" }),
  obj("S", { type: "points", positions: [[0, 0, 0], [1, 1, 0]] }),
];

describe("panelModel", () => {
  it("lists ungrouped rows first, then groups in order of appearance", () => {
    const model = panelModel(storeOf(scene), new UiState(null));
    expect(model.groups.map((g) => g.name)).toEqual([null, "conics", "intersections"]);
    expect(model.groups[0].rows.map((r) => r.id)).toEqual(["note", "S"]);
    expect(model.groups[1].rows.map((r) => r.id)).toEqual(["E", "C"]);
    expect(model.problems).toEqual([{ id: "bad", message: "unknown type" }]);
  });

  it("describes each row", () => {
    const model = panelModel(storeOf(scene), new UiState(null));
    const rows = model.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.id === "P₁")).toMatchObject({ kind: "object", label: "P₁", detail: "(1.841, 1.62)" });
    expect(rows.find((r) => r.id === "S")).toMatchObject({ detail: "2 points" });
    expect(rows.find((r) => r.id === "E")).toMatchObject({ detail: "ellipse", color: "#d1495b" });
    expect(rows.find((r) => r.id === "note")).toEqual({ kind: "note", id: "note", text: "2 tangent points", warn: true });
  });

  it("reflects visibility, collapse and selection", () => {
    const ui = new UiState(null);
    ui.setGroupVisible("conics", false);
    ui.setObjectVisible("P₁", false);
    ui.setCollapsed("intersections", true);
    ui.select("C");
    const model = panelModel(storeOf(scene), ui);
    const [, conics, intersections] = model.groups;
    expect(conics).toMatchObject({ visible: false, collapsed: false });
    expect(conics.rows[1]).toMatchObject({ id: "C", visible: true, shown: false, selected: true });
    expect(intersections).toMatchObject({ visible: true, collapsed: true });
    expect(intersections.rows[0]).toMatchObject({ visible: false, shown: false, selected: false });
  });

  it("drops the ungrouped section when every object has a group", () => {
    const model = panelModel(storeOf([scene[0]]), new UiState(null));
    expect(model.groups.map((g) => g.name)).toEqual(["conics"]);
  });
});
