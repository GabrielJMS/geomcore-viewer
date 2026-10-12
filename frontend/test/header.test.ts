import { describe, expect, it } from "vitest";
import { Store } from "../src/store";
import { RunCounter, headerModel, objectCount, plural, statusLine, statusState } from "../src/ui/header";
import type { SceneObject } from "../src/protocol";

const obj = (id: string, geom: unknown) => ({ id, geom }) as SceneObject;

describe("header", () => {
  it("numbers runs in the order they are seen", () => {
    const runs = new RunCounter();
    expect(runs.observe(null)).toBe(0);
    expect(runs.observe("a1")).toBe(1);
    expect(runs.observe("a1")).toBe(1);
    expect(runs.observe("b2")).toBe(2);
    expect(runs.observe("a1")).toBe(1);
  });

  it("counts objects but not notes", () => {
    expect(objectCount([obj("p", { type: "point", p: [0, 0, 0] }), obj("n", { type: "note", text: "hi" })])).toBe(1);
    expect(plural(1, "object")).toBe("1 object");
    expect(plural(0, "object")).toBe("0 objects");
  });

  it("builds the title, run and count", () => {
    const store = new Store();
    const runs = new RunCounter();
    expect(headerModel(store, runs)).toEqual({ title: "geomcore-viewer", run: "", count: "0 objects" });
    store.reset(
      { version: 2, title: "Conics", run: "r1", view: "auto", objects: [obj("p", { type: "point", p: [0, 0, 0] })] },
      [{ id: "bad", message: "unknown type" }],
    );
    expect(headerModel(store, runs)).toEqual({ title: "Conics", run: "run 1", count: "1 object · 1 rejected" });
  });

  it("colours the status by what it reports", () => {
    expect(statusState("live")).toBe("live");
    expect(statusState("live · reconnecting…")).toBe("");
    expect(statusState("static: sample-scene.json")).toBe("");
    expect(statusState("clear failed: the server answered HTTP 415")).toBe("error");
    expect(statusState("could not load x.json (HTTP 404)")).toBe("error");
    expect(statusState("live: unsupported scene version 9 (this viewer reads 1 and 2)")).toBe("error");
  });

  it("keeps a recorded view failure visible and marks the status as an error", () => {
    expect(statusLine("live", [])).toEqual({ text: "live", state: "live" });
    expect(statusLine("live", ["3D view unavailable: no WebGL"])).toEqual({
      text: "live · 3D view unavailable: no WebGL",
      state: "error",
    });
    expect(statusLine("static: a.json", ["2D view failed: x"]).state).toBe("error");
    expect(statusLine("", ["3D view unavailable: no WebGL"]).text).toBe("3D view unavailable: no WebGL");
  });
});
