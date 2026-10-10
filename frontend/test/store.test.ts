import { afterEach, describe, expect, it, vi } from "vitest";
import { Store, StoreEvent } from "../src/store";

const pt = (id: string, x = 0) => ({ id, geom: { type: "point", p: [x, 0, 0] } });

function storeWith(...ids: string[]) {
  const store = new Store();
  store.reset({ version: 2, title: "", run: "r1", view: "auto", objects: ids.map((id) => pt(id) as never) });
  const events: StoreEvent["type"][] = [];
  store.onChange((ev) => events.push(ev.type));
  return { store, events };
}

const ids = (store: Store) => [...store.objects.keys()];

describe("Store.apply", () => {
  it("keeps the old scene until the new run's first upsert, then swaps", () => {
    const { store, events } = storeWith("a");
    store.apply({ type: "run", run: "r2", keep: false });
    expect(ids(store)).toEqual(["a"]);
    store.apply({ type: "upsert", objects: [pt("b")], title: "second", view: "3d" });
    expect(ids(store)).toEqual(["b"]);
    expect(store.title).toBe("second");
    expect(store.view).toBe("3d");
    expect(events).toEqual(["reset"]);
  });

  it("accumulates with keep and within a run", () => {
    const { store, events } = storeWith("a");
    store.apply({ type: "run", run: "r2", keep: true });
    store.apply({ type: "upsert", objects: [pt("b")] });
    store.apply({ type: "upsert", objects: [pt("a", 5)] });
    expect(ids(store)).toEqual(["a", "b"]);
    expect(store.objects.get("a")?.geom).toEqual({ type: "point", p: [5, 0, 0] });
    expect(events).toEqual(["upsert", "upsert"]);
  });

  it("records problems without dropping valid objects", () => {
    const { store } = storeWith();
    store.apply({ type: "upsert", objects: [pt("ok"), { id: "bad", geom: { type: "foo" } }] });
    expect(ids(store)).toEqual(["ok"]);
    expect(store.problems.get("bad")?.message).toBe('unknown type "foo"');
    store.apply({ type: "remove", id: "bad" });
    expect(store.problems.size).toBe(0);
  });

  it("removes and clears", () => {
    const { store, events } = storeWith("a", "b");
    store.apply({ type: "remove", id: "a" });
    store.apply({ type: "clear" });
    expect(ids(store)).toEqual([]);
    expect(events).toEqual(["remove", "reset"]);
  });
});

describe("Store.loadUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports HTTP failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const store = new Store();
    await store.loadUrl("missing.json");
    expect(store.status).toBe("could not load missing.json (HTTP 404)");
    expect(store.problems.get("_doc")?.message).toBe("could not load missing.json (HTTP 404)");
  });

  it("reports documents that are not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>")));
    const store = new Store();
    await store.loadUrl("page.html");
    expect(store.status).toBe("could not load page.html (not JSON)");
  });

  it("reports unsupported versions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ version: 9, objects: [] })));
    const store = new Store();
    await store.loadUrl("future.json");
    expect(store.problems.get("_doc")?.message).toMatch(/unsupported scene version 9/);
  });
});
