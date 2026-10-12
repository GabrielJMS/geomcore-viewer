# geomcore-viewer v2 — Phase 2: Plane View and Page Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 2D pane into the classroom plane view of spec §5.2. It needs exact edge-to-edge conics, a 1-2-5 grid, labelled points, derived extras, hover tooltips and click-to-copy. Around it goes the page shell of §5.1: a single main view, header, grouped panel with visibility, keys, presentation mode and a light/dark theme. Phase 2 also fixes the Phase 1 backlog, starting with the re-run freeze.

**Architecture:**
- Everything the plane view computes is pure TypeScript under `frontend/src/geom/` and `frontend/src/view2d/`, unit-tested in node: clipping, adaptive sampling, extras, camera, grid, label placement, picking and the draw list.
- Only `view2d/view.ts` touches PixiJS and the DOM. Store events are coalesced to one redraw per animation frame in every consumer.
- Page state that is not scene data lives in one `UiState`: theme, presentation mode, view choice, visibility and selection. It survives run swaps.

**Tech Stack:**
- Frontend: TypeScript 5, Vite 6, PixiJS 8.21 (2D), Babylon.js 8.56 (3D), vitest 3 (node environment, no DOM), Playwright (new, e2e).
- Python: stdlib-only, pytest, 3.9+.

**Spec:** `docs/superpowers/specs/2026-10-10-viewer-v2-design.md`. Phase 2 covers §5.2 plus the panel/header/keys/presentation mode/theme of §5.1, the e2e tests of §9 that concern 2D and run swaps, and the palette contrast requirement of §3.5.

## Global Constraints

- Python package stays **stdlib-only** and supports **Python 3.9+** (CI runs 3.9 and 3.12).
- Frontend tests run in vitest's **node** environment (no jsdom). Every pure module must be importable without `document`/`window` at import time.
- Never use port **8765** for local runs or tests: an unrelated process holds it on the dev machine. Live manual runs use **8799**; the e2e server uses **8797**.
- Do not touch the sibling `../geomcore` repository (someone else has staged work there).
- Light theme is the default; `T` toggles dark and the choice persists in `localStorage` under `geomcore-viewer.theme`.
- Default palette colours must have contrast **≥ 3:1** against both backgrounds, light `#f7f8fa` and dark `#16181d` (spec §3.5).
- Keys (spec §5.1): `F` fit, `P` presentation mode (chrome hidden, ×1.5 line widths and fonts), `T` light/dark, `2`/`3` switch view, plus `Esc` (leave presentation, else clear the selection). `U` ((u,v) pane) is **Phase 3**: do not bind it.
- 2D drawing: curves are clipped to the viewport + **10 %** margin and resampled on every view change with chord error **≤ 0.25 px**, at most **4096** points per visible piece. Line widths are constant in pixels. Hover picks the nearest object within **8 px**.
- Point labels read `P₁ (1.84, 1.62)`: up to **3 decimals**, trailing zeros dropped, coordinates taken from the protocol and never recomputed.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands are run from the repository root unless a step says `cd frontend`. Python tests: `PYTHONPATH=python python3 -m pytest python/tests -q` (use an interpreter that has pytest; on the dev machine that is the repo's `.venv/bin/python`, as the system `python3` has none). Add `../geomcore/geomcore-py` to `PYTHONPATH` to also run the two tests against real geomcore (read-only). Frontend: `cd frontend && npx vitest run` and `npm run build` (runs `tsc --noEmit`).

## Review Focus

The spec does not list these five inputs, but each is likely to hurt a real user. Each line names the owning task's test.

1. **A hidden pane (0 × 0) or a pane resized while hidden.** The camera must stay finite, and nothing may be NaN or Infinity when the view is shown again. *Test:* `fitCamera` with width/height 0 in Task 6 (`camera2d.test.ts › stays finite for a hidden pane`; `camera.test.ts` already holds the 3D `cameraScale` tests).
2. **Extreme zoom (scale 1e-6 … 1e8).** A line must still run edge to edge, the sampler must stay under its point cap, and grid steps must stay finite with readable ticks. *Tests:* Task 7 `render.test.ts › keeps the line edge to edge at extreme zoom`, Task 4 `sample.test.ts › caps the points at extreme zoom`, Task 6 `plane.test.ts › formats very large and very small steps`.
3. **Keys pressed with modifiers or while typing.** Ctrl+F (browser find), ⌘P (print) and typing in a text field must not trigger viewer actions; a focused panel checkbox must still allow `F`. *Test:* Task 10 `keys.test.ts`.
4. **`localStorage` unavailable or throwing** (private mode, sandboxed iframe, file://). The page must still load, and the theme still toggles for the session. *Test:* Task 2 `state.test.ts › survives a storage that throws`.
5. **A re-run while a group is hidden, or after the selected object vanished.** Hidden groups and ids stay hidden for the new run's objects. A selection pointing to a missing id must not throw or move the camera. *Tests:* Task 2 `state.test.ts › keeps hidden groups and ids across runs`, Task 12 e2e `a re-run swaps the scene but keeps the camera and hidden groups`.

## Rulings Recorded While Planning

- geomcore's `docs/viewer.md` needs no change: the Python API is unchanged.
- The (u,v) pane, the `U` key and 3D highlight/picking are Phase 3. In Phase 2, selecting an object in 3D only frames it.
- `meta.params` names differ across geomcore functions (`t`, `s`, `(u, v)`, multiplicity). The tooltip therefore shows them generically as `params (…)`.
- Clicking a curve in the 2D view does nothing (hover already highlights it). Clicking a point copies its coordinates. Selecting and framing happen from the panel.
- A port-less `GEOMCORE_VIEWER_URL` means port 80 for both the client and the CLI, as the URL literally says.
- geomcore labels some transversal crossings "tangent" (an upstream issue). The viewer only repeats the tag in notes and never derives geometry from it.

## File Structure

```
frontend/src/
  frame.ts               NEW  FrameScheduler (one run per animation frame) + Changes (folded store events)
  store.ts               MOD  `live` flag, skip re-applying the identical first scene, clearAll only when live
  main.ts                MOD  shell wiring (Tasks 8, 9 minimal; Task 10 final)
  style.css              MOD  labels/tooltip (Task 8); full themed rewrite (Task 10)
  view3d.ts              MOD  coalesced updates, UiState (visibility, theme, selection, auto-fit), setActive
  view2d.ts              DEL  replaced by view2d/
  geom/vec.ts            MOD  + Vec2
  geom/clip.ts           NEW  Rect, expandRect, quadraticRoots, clipCurve2D (closed-form parameter clipping)
  geom/sample.ts         NEW  sampleAdaptive (≤ 0.25 px chords, capped), dashPolyline, segmentDistance
  geom/extras.ts         NEW  curveExtras: foci, center, axes, asymptotes, directrix, vertex
  view2d/camera.ts       NEW  Camera2D, worldToScreen, screenToWorld, visibleRect, fitCamera, zoomAt, panBy, resizeCamera
  view2d/plane.ts        NEW  niceStep, gridSpacing, ticks, formatTick
  view2d/placement.ts    NEW  placeLabels (greedy, 8 candidates)
  view2d/pick.ts         NEW  pickNearest
  view2d/render.ts       NEW  buildDrawList (pure draw list), curvePolylines, describeHit
  view2d/view.ts         NEW  View2D: PixiJS painting, DOM labels, tooltip, pan/zoom/hover/click
  ui/theme.ts            NEW  Theme, Palette, PALETTES, mixHex, luminance, contrast, applyTheme
  ui/state.ts            NEW  UiState, autoView
  ui/format.ts           NEW  fmtNum, fmtPoint, fmtParams
  ui/labels.ts           NEW  LabelLayer (DOM overlay), TextMeasure
  ui/header.ts           NEW  RunCounter, objectCount, plural, headerModel, statusState, renderHeader
  ui/keys.ts             NEW  keyAction, mountKeys
  ui/panel.ts            MOD  panelModel (pure) + mountPanel v2
  ui/colors.ts           MOD  DEFAULT_COLOR #3a7cc2
frontend/index.html      MOD  single stage + header controls + panel
frontend/test/           NEW  frame, theme, state, clip, sample, extras, camera2d, plane, placement, pick, format, render, header, keys, panel tests; MOD store
frontend/e2e/viewer.e2e.ts      NEW  Playwright (4 tests, server on 8797)
frontend/playwright.config.ts   NEW
frontend/package.json           MOD  @playwright/test, "e2e" script
python/geomcore_viewer/adapt.py MOD  indexed() labels, hit-tuple params → meta
python/geomcore_viewer/viewer.py MOD palette, indexed labels, meta copied, refused hint
python/geomcore_viewer/server.py MOD allowed_hosts (port 80 bare host), 403 names the app, default_port → 80 / ValueError
python/geomcore_viewer/spawn.py  MOD "refused" probe state, refused_hint, 3 s spawn timeout
python/geomcore_viewer/__main__.py MOD lazy default port, clean error on a malformed URL
python/tests/                    MOD test_adapt, test_viewer, test_server, test_spawn
protocol/SCENE.md, README.md     MOD docs
frontend/public/sample-scene.json MOD regenerated (new palette, meta params)
.github/workflows/ci.yml         MOD e2e job
.gitignore                       MOD test-results/, playwright-report/
```

---

### Task 1: Frame coalescing and store papercuts

Phase 1 handled every store event on its own. A ~300-object re-run (300 upserts) re-rendered the panel and recomputed scene bounds 300 times, freezing the tab for 1–3.5 s. This task adds the per-frame scheduler that every consumer uses from now on. It also fixes two store papercuts: the initial scene was applied twice, and "clear" POSTed to static hosts, where GitHub Pages answers 405.

**Files:**
- Create: `frontend/src/frame.ts`
- Modify: `frontend/src/store.ts`
- Test: `frontend/test/frame.test.ts` (new), `frontend/test/store.test.ts`

**Interfaces:**
- Consumes: `StoreEvent` from `frontend/src/store.ts`.
- Produces:
  - `class FrameScheduler { constructor(work: () => void, raf?: (cb: () => void) => unknown); request(): void }`
  - `class Changes { reset: boolean; readonly ids: Set<string>; note(ev: StoreEvent): void; get empty(): boolean; take(): { reset: boolean; ids: string[] } }`
  - `Store.live: boolean`: true once connected to a live server.

- [ ] **Step 1: Write the failing tests for the scheduler**

Create `frontend/test/frame.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Changes, FrameScheduler } from "../src/frame";
import type { SceneObject } from "../src/protocol";

function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    raf: (cb: () => void) => queue.push(cb),
    flush: () => queue.splice(0).forEach((cb) => cb()),
    size: () => queue.length,
  };
}

const pt = (id: string) => ({ id, geom: { type: "point", p: [0, 0, 0] } }) as SceneObject;

describe("FrameScheduler", () => {
  it("runs the work once per frame however often it is requested", () => {
    const frames = manualFrames();
    const work = vi.fn();
    const scheduler = new FrameScheduler(work, frames.raf);
    for (let i = 0; i < 300; i++) scheduler.request();
    expect(frames.size()).toBe(1);
    frames.flush();
    expect(work).toHaveBeenCalledTimes(1);
    scheduler.request();
    frames.flush();
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("keeps scheduling after a frame whose work threw", () => {
    const frames = manualFrames();
    const scheduler = new FrameScheduler(() => {
      throw new Error("boom");
    }, frames.raf);
    scheduler.request();
    expect(() => frames.flush()).toThrow("boom");
    scheduler.request();
    expect(frames.size()).toBe(1);
  });
});

describe("Changes", () => {
  it("collects upserted and removed ids until taken", () => {
    const changes = new Changes();
    changes.note({ type: "upsert", objects: [pt("a"), pt("b")] });
    changes.note({ type: "remove", id: "c" });
    changes.note({ type: "meta" });
    expect(changes.empty).toBe(false);
    expect(changes.take()).toEqual({ reset: false, ids: ["a", "b", "c"] });
    expect(changes.empty).toBe(true);
  });

  it("lets a reset swallow the ids before and after it", () => {
    const changes = new Changes();
    changes.note({ type: "upsert", objects: [pt("a")] });
    changes.note({ type: "reset" });
    changes.note({ type: "upsert", objects: [pt("b")] });
    expect(changes.take()).toEqual({ reset: true, ids: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/frame.test.ts`
Expected: FAIL, "Failed to resolve import "../src/frame"".

- [ ] **Step 3: Implement `frame.ts`**

Create `frontend/src/frame.ts`:

```ts
import type { StoreEvent } from "./store";

type Raf = (callback: () => void) => unknown;

/** Runs `work` once on the next animation frame, however many times `request()` is called before it. */
export class FrameScheduler {
  private queued = false;

  constructor(
    private work: () => void,
    private raf: Raf = (callback) => requestAnimationFrame(callback),
  ) {}

  request(): void {
    if (this.queued) return;
    this.queued = true;
    this.raf(() => {
      this.queued = false; // before the work: a throwing frame must not wedge the scheduler
      this.work();
    });
  }
}

/** Store events folded between two frames: a reset swallows every id before and after it. */
export class Changes {
  reset = false;
  readonly ids = new Set<string>();

  note(ev: StoreEvent): void {
    if (ev.type === "reset") {
      this.reset = true;
      this.ids.clear();
    } else if (this.reset || ev.type === "meta") {
      return;
    } else if (ev.type === "upsert") {
      for (const o of ev.objects) this.ids.add(o.id);
    } else {
      this.ids.add(ev.id);
    }
  }

  get empty(): boolean {
    return !this.reset && this.ids.size === 0;
  }

  take(): { reset: boolean; ids: string[] } {
    const out = { reset: this.reset, ids: [...this.ids] };
    this.reset = false;
    this.ids.clear();
    return out;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run test/frame.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing store tests**

In `frontend/test/store.test.ts`, inside `describe("Store.load", …)`, replace the `NoopEventSource` class and the `stub` helper with versions that can capture the event source:

```ts
  class NoopEventSource {
    static last: NoopEventSource | null = null;
    onmessage: ((msg: { data: string }) => void) | null = null;
    onerror = null;
    onopen = null;
    constructor() {
      NoopEventSource.last = this;
    }
  }

  function stub(routes: Record<string, () => Response>) {
    const fetchMock = vi.fn(async (url: string) => {
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      return route();
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("EventSource", NoopEventSource);
    return fetchMock;
  }
```

Then add these tests at the end of the same `describe("Store.load", …)` block:

```ts
  it("does not apply the connection's first scene event twice", async () => {
    const doc = { version: 2, title: "t", run: "r1", view: "auto", objects: [pt("a")] };
    stub({ "api/scene": () => Response.json(doc) });
    const store = new Store();
    await store.load();
    expect(store.live).toBe(true);
    const events: StoreEvent["type"][] = [];
    store.onChange((ev) => events.push(ev.type));
    NoopEventSource.last!.onmessage!({ data: JSON.stringify({ type: "scene", doc }) });
    expect(events).toEqual(["meta"]);
    expect(store.status).toBe("live");
  });

  it("applies a scene event that differs, or that follows other events", async () => {
    const doc = { version: 2, title: "t", run: "r1", view: "auto", objects: [pt("a")] };
    stub({ "api/scene": () => Response.json(doc) });
    const store = new Store();
    await store.load();
    const source = NoopEventSource.last!;
    source.onmessage!({ data: JSON.stringify({ type: "upsert", objects: [pt("b")] }) });
    expect(ids(store)).toEqual(["a", "b"]);
    source.onmessage!({ data: JSON.stringify({ type: "scene", doc }) }); // e.g. after a reconnect
    expect(ids(store)).toEqual(["a"]);
  });
```

Replace the whole `describe("Store.clearAll", …)` block with:

```ts
describe("Store.clearAll", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts a JSON body with a JSON content type and clears the page", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { store } = storeWith("a");
    store.live = true;
    await store.clearAll();
    expect(fetchMock).toHaveBeenCalledWith("api/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(ids(store)).toEqual([]);
  });

  it("reports a refused clear instead of swallowing it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 415 })));
    const { store } = storeWith("a");
    store.live = true;
    await store.clearAll();
    expect(store.status).toBe("clear failed: the server answered HTTP 415");
  });

  it("reports an unreachable live server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    const { store } = storeWith("a");
    store.live = true;
    await store.clearAll();
    expect(store.status).toBe("clear failed: the server is unreachable");
  });

  it("only clears the page on a static page, where there is no server to ask", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 405 }));
    vi.stubGlobal("fetch", fetchMock);
    const { store } = storeWith("a");
    await store.clearAll();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ids(store)).toEqual([]);
    expect(store.status).toBe("");
  });
});
```

- [ ] **Step 6: Run the store tests to verify the new ones fail**

Run: `cd frontend && npx vitest run test/store.test.ts`
Expected: FAIL. `store.live` is undefined, `events` contains `"reset"`, and the static clear calls fetch.

- [ ] **Step 7: Implement the store changes**

In `frontend/src/store.ts`, add two fields after `private swapPending = false;`:

```ts
  /** True once the page is connected to a live server (as opposed to a static scene). */
  live = false;
  /** The scene document last loaded from the server, to skip the identical first `scene` event. */
  private lastScene: string | null = null;
```

Replace the start of `apply` (the `switch` header and the `case "scene"` branch) with:

```ts
  apply(ev: ServerEvent): void {
    if (ev.type !== "scene") this.lastScene = null; // the state has moved on: a later scene must apply
    switch (ev.type) {
      case "scene": {
        // The first event of every /events connection: the full scene, taken under the
        // server's lock, so everything after it is a delta on top of exactly this. On the
        // first connection it repeats the snapshot connectLive just loaded: skip that one.
        const key = JSON.stringify(ev.doc);
        if (key !== this.lastScene) {
          if (!this.loadJson(ev.doc, "live")) return;
          this.lastScene = key;
        }
        this.setStatus("live");
        return;
      }
```

(The remaining cases `run`, `upsert`, `remove` and `clear` stay as they are.)

In `connectLive`, replace

```ts
    if (!this.loadJson(scene.raw, "live")) return "failed";
    this.setStatus("live");
```

with

```ts
    if (!this.loadJson(scene.raw, "live")) return "failed";
    this.live = true;
    this.lastScene = JSON.stringify(scene.raw);
    this.setStatus("live");
```

Replace `clearAll` with:

```ts
  /** The "clear" button: empty the page and, when live, the server's scene. */
  async clearAll(): Promise<void> {
    this.apply({ type: "clear" });
    if (!this.live) return; // a static page: there is no server scene to clear
    try {
      const res = await fetch("api/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) this.setStatus(`clear failed: the server answered HTTP ${res.status}`);
    } catch {
      this.setStatus("clear failed: the server is unreachable");
    }
  }
```

- [ ] **Step 8: Run all frontend tests and the type check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS; tsc prints nothing.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/frame.ts frontend/src/store.ts frontend/test/frame.test.ts frontend/test/store.test.ts
git commit -m "frontend: one redraw per frame (FrameScheduler, Changes); skip the duplicate first scene; clear only asks a live server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Theme palette and UI state

**Files:**
- Create: `frontend/src/ui/theme.ts`, `frontend/src/ui/state.ts`
- Modify: `frontend/src/ui/colors.ts:3`
- Test: `frontend/test/theme.test.ts`, `frontend/test/state.test.ts`

**Interfaces:**
- Consumes: `inPlaneZ0` (`geom/planar.ts`), `SceneObject`, `ViewMode` (`protocol.ts`), `DEFAULT_COLOR` (`ui/colors.ts`).
- Produces:
  - `type Theme = "light" | "dark"`
  - `interface Palette { bg: string; gridMinor: string; gridMajor: string; axis: string; text: string }`
  - `PALETTES: Record<Theme, Palette>`
  - `mixHex(a: string, b: string, t: number): string`
  - `luminance(hex: string): number`
  - `contrast(a: string, b: string): number`
  - `applyTheme(theme: Theme): void`
  - `type ActiveView = "2d" | "3d"`
  - `type UiEvent = "theme" | "presenting" | "view" | "visibility" | "selection" | "autofit" | "collapse"`
  - `interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }`
  - `autoView(objects: Iterable<SceneObject>): ActiveView`
  - `class UiState`:
    - fields: `theme`, `presenting`, `autoFit`, `viewOverride`, `selected`, `hiddenIds`, `hiddenGroups`, `collapsedGroups`
    - methods: `onChange(h: (ev: UiEvent) => void)`, `setTheme`, `toggleTheme`, `setPresenting(on)`, `setAutoFit(on)`, `setView(v: ActiveView)`, `activeView(sceneView: ViewMode, objects): ActiveView`, `isVisible(o): boolean`, `setObjectVisible(id, visible)`, `setGroupVisible(group, visible)`, `setCollapsed(group, collapsed)`, `select(id | null)`

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR } from "../src/ui/colors";
import { PALETTES, contrast, luminance, mixHex } from "../src/ui/theme";

describe("theme colours", () => {
  it("mixes two colours channel by channel", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#d1495b", "#f7f8fa", 0)).toBe("#d1495b");
    expect(mixHex("#d1495b", "#f7f8fa", 1)).toBe("#f7f8fa");
  });

  it("computes WCAG luminance and contrast", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
    expect(luminance("#000000")).toBe(0);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 6);
  });

  it("keeps the default object colour readable on both themes", () => {
    expect(contrast(DEFAULT_COLOR, PALETTES.light.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(DEFAULT_COLOR, PALETTES.dark.bg)).toBeGreaterThanOrEqual(3);
  });

  it("keeps text and axes readable on their own background", () => {
    for (const p of Object.values(PALETTES)) {
      expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.axis, p.bg)).toBeGreaterThanOrEqual(3);
    }
  });
});
```

Create `frontend/test/state.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SceneObject } from "../src/protocol";
import { KeyValueStore, UiState, autoView } from "../src/ui/state";

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const obj = (id: string, geom: unknown, group?: string) => ({ id, geom, ...(group ? { group } : {}) }) as SceneObject;
const point = (id: string, z = 0, group?: string) => obj(id, { type: "point", p: [1, 2, z] }, group);
const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

describe("UiState theme", () => {
  it("starts light, reads a stored dark theme and persists toggles", () => {
    expect(new UiState(memory()).theme).toBe("light");
    const storage = memory({ "geomcore-viewer.theme": "dark" });
    const ui = new UiState(storage);
    expect(ui.theme).toBe("dark");
    ui.toggleTheme();
    expect(ui.theme).toBe("light");
    expect(storage.data.get("geomcore-viewer.theme")).toBe("light");
  });

  it("survives a storage that throws, and works without one", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const ui = new UiState(broken);
    expect(ui.theme).toBe("light");
    expect(() => ui.toggleTheme()).not.toThrow();
    expect(ui.theme).toBe("dark");
    const bare = new UiState(null);
    bare.toggleTheme();
    expect(bare.theme).toBe("dark");
  });
});

describe("UiState view", () => {
  it("picks 2D for planar or empty scenes and 3D otherwise", () => {
    expect(autoView([])).toBe("2d");
    expect(autoView([point("a"), obj("c", { type: "circle", frame, r: 1 })])).toBe("2d");
    expect(autoView([obj("n", { type: "note", text: "hi" })])).toBe("2d");
    expect(autoView([point("a"), point("b", 1)])).toBe("3d");
    expect(autoView([obj("s", { type: "sphere", frame, r: 1 })])).toBe("3d");
  });

  it("prefers the user's pick, then the scene's view, then auto", () => {
    const ui = new UiState(null);
    const planar = [point("a")];
    expect(ui.activeView("auto", planar)).toBe("2d");
    expect(ui.activeView("3d", planar)).toBe("3d");
    ui.setView("2d");
    expect(ui.activeView("3d", planar)).toBe("2d");
  });
});

describe("UiState visibility and selection", () => {
  it("keeps hidden groups and ids across runs", () => {
    const ui = new UiState(null);
    ui.setGroupVisible("conics", false);
    ui.setObjectVisible("P₁", false);
    // a re-run brings new objects: matched by group name and by id
    expect(ui.isVisible(point("E2", 0, "conics"))).toBe(false);
    expect(ui.isVisible(point("P₁", 0, "intersections"))).toBe(false);
    expect(ui.isVisible(point("Q₁", 0, "intersections"))).toBe(true);
    ui.setGroupVisible("conics", true);
    expect(ui.isVisible(point("E2", 0, "conics"))).toBe(true);
  });

  it("tells listeners what changed", () => {
    const ui = new UiState(null);
    const seen = vi.fn();
    ui.onChange(seen);
    ui.select("a");
    ui.setPresenting(true);
    ui.setPresenting(true); // no change, no event
    ui.setAutoFit(false);
    ui.setCollapsed("g", true);
    expect(seen.mock.calls.map((c) => c[0])).toEqual(["selection", "presenting", "autofit", "collapse"]);
    expect(ui.selected).toBe("a");
    expect(ui.collapsedGroups.has("g")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/theme.test.ts test/state.test.ts`
Expected: FAIL, "Failed to resolve import "../src/ui/theme"".

- [ ] **Step 3: Implement `theme.ts`**

Create `frontend/src/ui/theme.ts`:

```ts
export type Theme = "light" | "dark";

/** Canvas colours of one theme; style.css mirrors them in its custom properties. */
export interface Palette {
  bg: string;
  gridMinor: string;
  gridMajor: string;
  axis: string;
  text: string;
}

export const PALETTES: Record<Theme, Palette> = {
  light: { bg: "#f7f8fa", gridMinor: "#e6e8ec", gridMajor: "#cfd3da", axis: "#6b7280", text: "#374151" },
  dark: { bg: "#16181d", gridMinor: "#23262d", gridMajor: "#343842", axis: "#9aa3b2", text: "#d6dae1" },
};

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** `a` moved a fraction `t` of the way towards `b` (both `#rrggbb`). */
export function mixHex(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca.map((c, i) => Math.round(c + (cb[i] - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 … 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Switch the page's CSS custom properties (style.css `:root[data-theme="dark"]`). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
```

- [ ] **Step 4: Implement `state.ts`**

Create `frontend/src/ui/state.ts`:

```ts
import { inPlaneZ0 } from "../geom/planar";
import type { SceneObject, ViewMode } from "../protocol";
import type { Theme } from "./theme";

export type ActiveView = "2d" | "3d";
export type UiEvent = "theme" | "presenting" | "view" | "visibility" | "selection" | "autofit" | "collapse";

/** The part of `Storage` the UI needs (tests pass a Map-backed fake). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const THEME_KEY = "geomcore-viewer.theme";

function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // a sandboxed page throws on access
  }
}

/** "2d" when every object lies in z = 0 (an empty scene too), else "3d". */
export function autoView(objects: Iterable<SceneObject>): ActiveView {
  for (const o of objects) if (!inPlaneZ0(o.geom)) return "3d";
  return "2d";
}

function toggle(set: Set<string>, key: string, present: boolean): void {
  if (present) set.add(key);
  else set.delete(key);
}

/**
 * Page state that is not scene data: theme, presentation mode, the view the user picked,
 * auto-fit, visibility, collapsed groups and the selection. It outlives run swaps, so
 * hidden groups and ids stay hidden when a re-run brings objects with the same group
 * name or id (spec §5.1).
 */
export class UiState {
  theme: Theme;
  presenting = false;
  autoFit = true;
  viewOverride: ActiveView | null = null;
  selected: string | null = null;
  readonly hiddenIds = new Set<string>();
  readonly hiddenGroups = new Set<string>();
  readonly collapsedGroups = new Set<string>();
  private handlers = new Set<(ev: UiEvent) => void>();

  constructor(private storage: KeyValueStore | null = browserStorage()) {
    this.theme = this.read(THEME_KEY) === "dark" ? "dark" : "light";
  }

  onChange(handler: (ev: UiEvent) => void): void {
    this.handlers.add(handler);
  }

  private emit(ev: UiEvent): void {
    for (const handler of this.handlers) handler(ev);
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    try {
      this.storage?.setItem(THEME_KEY, theme);
    } catch {
      /* storage full or blocked: the theme still applies to this page */
    }
    this.emit("theme");
  }

  toggleTheme(): void {
    this.setTheme(this.theme === "light" ? "dark" : "light");
  }

  setPresenting(on: boolean): void {
    if (on === this.presenting) return;
    this.presenting = on;
    this.emit("presenting");
  }

  setAutoFit(on: boolean): void {
    this.autoFit = on;
    this.emit("autofit");
  }

  setView(view: ActiveView): void {
    this.viewOverride = view;
    this.emit("view");
  }

  /** The view to show: the user's pick (keys 2/3, header switch), else the scene's, else auto. */
  activeView(sceneView: ViewMode, objects: Iterable<SceneObject>): ActiveView {
    if (this.viewOverride) return this.viewOverride;
    return sceneView === "auto" ? autoView(objects) : sceneView;
  }

  isVisible(o: SceneObject): boolean {
    return !this.hiddenIds.has(o.id) && !(o.group !== undefined && this.hiddenGroups.has(o.group));
  }

  setObjectVisible(id: string, visible: boolean): void {
    toggle(this.hiddenIds, id, !visible);
    this.emit("visibility");
  }

  setGroupVisible(group: string, visible: boolean): void {
    toggle(this.hiddenGroups, group, !visible);
    this.emit("visibility");
  }

  setCollapsed(group: string, collapsed: boolean): void {
    toggle(this.collapsedGroups, group, collapsed);
    this.emit("collapse");
  }

  /** Select an object (views frame it), or clear the selection with null. */
  select(id: string | null): void {
    this.selected = id;
    this.emit("selection");
  }
}
```

- [ ] **Step 5: Change the default colour**

The Phase 1 `#30638e` has contrast 2.5 on the dark background. In `frontend/src/ui/colors.ts` replace

```ts
export const DEFAULT_COLOR = "#30638e";
```

with

```ts
/** Contrast ≥ 3:1 on both theme backgrounds (test/theme.test.ts). */
export const DEFAULT_COLOR = "#3a7cc2";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all PASS, including the existing `colors.test.ts` (it imports `DEFAULT_COLOR` rather than repeating the literal).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ui/theme.ts frontend/src/ui/state.ts frontend/src/ui/colors.ts frontend/test/theme.test.ts frontend/test/state.test.ts
git commit -m "frontend: theme palettes and UiState (theme, presentation, view pick, visibility, selection) that outlive run swaps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Closed-form curve clipping

Spec §5.2: "infinite curves clipped to viewport + 10 % margin by solving the parameter interval inside the view box (closed-form for line/parabola/hyperbola)". A curve can only enter or leave a rectangle where it crosses one of the four edge lines x = xmin, x = xmax, y = ymin and y = ymax. Each crossing has a closed form:

| curve | coordinate k of P(t) | crossings of P_k(t) = c |
|---|---|---|
| line | o_k + d_k·t | t = (c − o_k)/d_k |
| circle / ellipse | o_k + A cos t + B sin t, A = r_a·x_k, B = r_b·y_k | t = φ ± acos((c − o_k)/R), R = √(A²+B²), φ = atan2(B, A), plus 2πn |
| parabola | o_k + x_k·t²/(4f) + y_k·t | roots of (x_k/4f)·t² + y_k·t + (o_k − c) |
| hyperbola | o_k + a·x_k cosh t + b·y_k sinh t | with e = eᵗ > 0: (A+B)·e² + 2(o_k − c)·e + (A − B) = 0, t = ln e |

Between consecutive crossings the curve is entirely inside or entirely outside, so a midpoint test decides. For an infinite curve, the unbounded pieces before the first crossing and after the last one lie outside.

**Files:**
- Create: `frontend/src/geom/clip.ts`
- Test: `frontend/test/clip.test.ts`

**Interfaces:**
- Consumes: `evalCurve` (`geom/curves.ts`), `CurveGeom`, `Range` (`geom/types.ts`), `Vec3` (`geom/vec.ts`).
- Produces:
  - `interface Rect { xmin: number; xmax: number; ymin: number; ymax: number }`
  - `expandRect(r: Rect, frac: number): Rect`
  - `quadraticRoots(a: number, b: number, c: number): number[]`
  - `clipCurve2D(g: CurveGeom, rect: Rect): Range[]`: increasing, disjoint parameter intervals.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/clip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Rect, clipCurve2D, expandRect, quadraticRoots } from "../src/geom/clip";
import { evalCurve } from "../src/geom/curves";
import type { CurveGeom, Range } from "../src/geom/types";
import type { Frame, Vec3 } from "../src/geom/vec";

const TAU = 2 * Math.PI;
const R = (xmin: number, xmax: number, ymin: number, ymax: number): Rect => ({ xmin, xmax, ymin, ymax });
const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
function turned(angle: number, o: Vec3 = [0.3, -0.2, 0]): Frame {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { o, x: [c, s, 0], y: [-s, c, 0], z: [0, 0, 1] };
}

function expectRanges(got: Range[], want: Range[]): void {
  expect(got.length).toBe(want.length);
  got.forEach((r, i) => {
    expect(r[0]).toBeCloseTo(want[i][0], 9);
    expect(r[1]).toBeCloseTo(want[i][1], 9);
  });
}

describe("quadraticRoots", () => {
  it("solves without cancellation and falls back to the linear case", () => {
    expect(quadraticRoots(1, -3, 2).sort()).toEqual([1, 2]);
    expect(quadraticRoots(0, 2, -4)).toEqual([2]);
    expect(quadraticRoots(1, 0, 1)).toEqual([]);
    expect(quadraticRoots(0, 0, 1)).toEqual([]);
    const [small] = quadraticRoots(1, -1e8, 1).sort((a, b) => a - b);
    expect(small).toBeCloseTo(1e-8, 20);
  });
});

describe("expandRect", () => {
  it("grows by a fraction of the size on every side", () => {
    expect(expandRect(R(0, 10, -2, 2), 0.1)).toEqual(R(-1, 11, -2.4, 2.4));
  });
});

describe("clipCurve2D", () => {
  it("clips an infinite line to the rectangle", () => {
    expectRanges(clipCurve2D({ type: "line", o: [0, 0, 0], d: [1, 1, 0] }, R(-1, 1, -1, 1)), [[-1, 1]]);
  });

  it("returns nothing for a line that misses", () => {
    expect(clipCurve2D({ type: "line", o: [0, 5, 0], d: [1, 0, 0] }, R(-1, 1, -1, 1))).toEqual([]);
  });

  it("keeps a ranged line's own ends", () => {
    expectRanges(clipCurve2D({ type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [0, 0.5] }, R(-1, 1, -1, 1)), [[0, 0.5]]);
  });

  it("keeps a circle that fits whole", () => {
    expectRanges(clipCurve2D({ type: "circle", frame: world, r: 1 }, R(-2, 2, -2, 2)), [[0, TAU]]);
  });

  it("splits a circle that the rectangle cuts at the seam", () => {
    expectRanges(clipCurve2D({ type: "circle", frame: world, r: 2 }, R(0, 3, -3, 3)), [
      [0, Math.PI / 2],
      [(3 * Math.PI) / 2, TAU],
    ]);
  });

  it("clips a parabola in closed form", () => {
    expectRanges(clipCurve2D({ type: "parabola", frame: world, f: 0.25 }, R(-1, 4, -1, 1)), [[-1, 1]]);
  });

  it("clips a hyperbola branch in closed form", () => {
    const t = Math.acosh(10);
    expectRanges(clipCurve2D({ type: "hyperbola", frame: world, a: 1, b: 1 }, R(-10, 10, -10, 10)), [[-t, t]]);
  });

  it("drops a hyperbola branch that lies outside", () => {
    expect(clipCurve2D({ type: "hyperbola", frame: world, a: 1, b: 1 }, R(-10, -1, -10, 10))).toEqual([]);
  });

  it("works at extreme zoom", () => {
    const line: CurveGeom = { type: "line", o: [0, 0, 0], d: [1, 1, 0] };
    const tiny = clipCurve2D(line, R(1 - 1e-7, 1 + 1e-7, 1 - 1e-7, 1 + 1e-7));
    expectRanges(tiny, [[1 - 1e-7, 1 + 1e-7]]);
    expectRanges(clipCurve2D(line, R(-1e9, 1e9, -1e9, 1e9)), [[-1e9, 1e9]]);
  });

  it("finds every visible piece of tilted conics (sampled check)", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const curves: { g: CurveGeom; span: Range }[] = [
      { g: { type: "line", o: [0.2, -0.1, 0], d: [0.6, -1.3, 0] }, span: [-12, 12] },
      { g: { type: "ellipse", frame: turned(0.7), a: 3, b: 1.2 }, span: [0, TAU] },
      { g: { type: "circle", frame: turned(-1.1), r: 2, range: [0.5, 4] }, span: [0.5, 4] },
      { g: { type: "parabola", frame: turned(2.2), f: -0.4 }, span: [-8, 8] },
      { g: { type: "hyperbola", frame: turned(-0.4), a: 1.1, b: 0.6 }, span: [-3.5, 3.5] },
    ];
    for (let trial = 0; trial < 40; trial++) {
      const x0 = random() * 8 - 4;
      const y0 = random() * 8 - 4;
      const rect = R(x0, x0 + 0.5 + random() * 4, y0, y0 + 0.5 + random() * 4);
      for (const { g, span } of curves) {
        const ranges = clipCurve2D(g, rect);
        for (const [a, b] of ranges) {
          const mid = evalCurve(g, (a + b) / 2);
          expect(mid[0]).toBeGreaterThanOrEqual(rect.xmin - 1e-9);
          expect(mid[0]).toBeLessThanOrEqual(rect.xmax + 1e-9);
          expect(mid[1]).toBeGreaterThanOrEqual(rect.ymin - 1e-9);
          expect(mid[1]).toBeLessThanOrEqual(rect.ymax + 1e-9);
        }
        const shrunk = expandRect(rect, -1e-6);
        for (let i = 0; i <= 2000; i++) {
          const t = span[0] + ((span[1] - span[0]) * i) / 2000;
          const p = evalCurve(g, t);
          const strictlyInside = p[0] > shrunk.xmin && p[0] < shrunk.xmax && p[1] > shrunk.ymin && p[1] < shrunk.ymax;
          if (!strictlyInside) continue;
          const covered = ranges.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);
          expect(covered, `${g.type} t=${t} inside but not drawn`).toBe(true);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/clip.test.ts`
Expected: FAIL, "Failed to resolve import "../src/geom/clip"".

- [ ] **Step 3: Implement `clip.ts`**

Create `frontend/src/geom/clip.ts`:

```ts
import { evalCurve } from "./curves";
import type { CurveGeom, Range } from "./types";
import type { Vec3 } from "./vec";

const TAU = 2 * Math.PI;

/** Axis-aligned rectangle in the z = 0 plane, in world units. */
export interface Rect {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/** `r` grown by `frac` of its size on every side (negative shrinks it). */
export function expandRect(r: Rect, frac: number): Rect {
  const dx = (r.xmax - r.xmin) * frac;
  const dy = (r.ymax - r.ymin) * frac;
  return { xmin: r.xmin - dx, xmax: r.xmax + dx, ymin: r.ymin - dy, ymax: r.ymax + dy };
}

/** Real roots of a·x² + b·x + c without cancellation; a vanishing `a` falls back to the linear case. */
export function quadraticRoots(a: number, b: number, c: number): number[] {
  if (a === 0 || Math.abs(a) <= 1e-12 * Math.max(Math.abs(b), Math.abs(c))) return b === 0 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(disc));
  if (q === 0) return [0]; // b = c = 0: a double root at 0
  return [q / a, c / q];
}

/** Solutions of A·cos t + B·sin t = m (that is R·cos(t − φ) = m) in [lo, hi]. */
function trigRoots(A: number, B: number, m: number, lo: number, hi: number): number[] {
  const R = Math.hypot(A, B);
  if (R === 0 || Math.abs(m) > R) return [];
  const phi = Math.atan2(B, A);
  const delta = Math.acos(m / R);
  const out: number[] = [];
  for (const base of [phi + delta, phi - delta]) {
    for (let t = base + TAU * Math.ceil((lo - base) / TAU); t <= hi; t += TAU) out.push(t);
  }
  return out;
}

/** Parameters where coordinate k (0 = x, 1 = y) of the curve equals c. */
function crossings(g: CurveGeom, k: 0 | 1, c: number, lo: number, hi: number): number[] {
  switch (g.type) {
    case "line":
      return g.d[k] === 0 ? [] : [(c - g.o[k]) / g.d[k]];
    case "circle":
      return trigRoots(g.r * g.frame.x[k], g.r * g.frame.y[k], c - g.frame.o[k], lo, hi);
    case "ellipse":
      return trigRoots(g.a * g.frame.x[k], g.b * g.frame.y[k], c - g.frame.o[k], lo, hi);
    case "parabola":
      return quadraticRoots(g.frame.x[k] / (4 * g.f), g.frame.y[k], g.frame.o[k] - c);
    case "hyperbola": {
      const A = g.a * g.frame.x[k];
      const B = g.b * g.frame.y[k];
      return quadraticRoots(A + B, 2 * (g.frame.o[k] - c), A - B)
        .filter((e) => e > 0)
        .map(Math.log);
    }
  }
}

/** Parameter domain drawn: the range (capped at one turn for closed curves), one full turn, or all of ℝ. */
function domain(g: CurveGeom): Range {
  const closed = g.type === "circle" || g.type === "ellipse";
  if (g.range) {
    const [a, b] = g.range[0] <= g.range[1] ? g.range : [g.range[1], g.range[0]];
    return closed && b - a > TAU ? [a, a + TAU] : [a, b];
  }
  return closed ? [0, TAU] : [-Infinity, Infinity];
}

const inside = (r: Rect, p: Vec3): boolean => p[0] >= r.xmin && p[0] <= r.xmax && p[1] >= r.ymin && p[1] <= r.ymax;

/**
 * Parameter intervals of `g` whose points lie inside `rect`, increasing and disjoint.
 * The curve can only enter or leave the rectangle where it crosses one of its four edge
 * lines, so between consecutive crossings it is entirely in or out and a midpoint test
 * decides. The unbounded pieces of an infinite curve, before the first crossing and after
 * the last one, are outside.
 */
export function clipCurve2D(g: CurveGeom, rect: Rect): Range[] {
  const [lo, hi] = domain(g);
  const cuts = new Set<number>();
  for (const k of [0, 1] as const) {
    for (const c of k === 0 ? [rect.xmin, rect.xmax] : [rect.ymin, rect.ymax]) {
      for (const t of crossings(g, k, c, lo, hi)) if (Number.isFinite(t) && t > lo && t < hi) cuts.add(t);
    }
  }
  const bounds = [lo, ...[...cuts].sort((a, b) => a - b), hi];
  const out: Range[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    if (!inside(rect, evalCurve(g, (a + b) / 2))) continue;
    const last = out[out.length - 1];
    if (last && last[1] === a) last[1] = b;
    else out.push([a, b]);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run test/clip.test.ts && npx tsc --noEmit`
Expected: PASS (13 tests); tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/geom/clip.ts frontend/test/clip.test.ts
git commit -m "geom: clip curves to a rectangle by solving for the parameter interval (closed form per conic)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Adaptive screen-space sampling and dashes

**Files:**
- Modify: `frontend/src/geom/vec.ts` (add `Vec2`)
- Create: `frontend/src/geom/sample.ts`
- Test: `frontend/test/sample.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Vec2 = [number, number]` (in `geom/vec.ts`)
  - `interface Sampled { pts: Vec2[]; ts: number[] }`
  - `segmentDistance(p: Vec2, a: Vec2, b: Vec2): number`
  - `sampleAdaptive(f: (t: number) => Vec2, t0: number, t1: number, tol = 0.25, maxPoints = 4096): Sampled`
  - `dashPolyline(pts: Vec2[], dash: number, gap: number, maxDashes = 5000): Vec2[][]`

- [ ] **Step 1: Add `Vec2`**

In `frontend/src/geom/vec.ts`, below `export type Vec3 = [number, number, number];`, add:

```ts
/** A screen-space point, in pixels. */
export type Vec2 = [number, number];
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/test/sample.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dashPolyline, sampleAdaptive, segmentDistance } from "../src/geom/sample";
import type { Vec2 } from "../src/geom/vec";

const TAU = 2 * Math.PI;
const circle = (r: number) => (t: number): Vec2 => [r * Math.cos(t), r * Math.sin(t)];

describe("segmentDistance", () => {
  it("measures to the segment, not the infinite line", () => {
    expect(segmentDistance([5, 3], [0, 0], [10, 0])).toBe(3);
    expect(segmentDistance([13, 4], [0, 0], [10, 0])).toBe(5);
    expect(segmentDistance([1, 1], [0, 0], [0, 0])).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe("sampleAdaptive", () => {
  it("keeps a straight map at the 16 seed segments, ends exact", () => {
    const { pts, ts } = sampleAdaptive((t) => [t, 2 * t], 0, 1);
    expect(pts.length).toBe(17);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[16]).toEqual([1, 2]);
    expect(ts[0]).toBe(0);
    expect(ts[16]).toBe(1);
  });

  it("stays within a quarter pixel of a 100 px circle", () => {
    const f = circle(100);
    const { pts, ts } = sampleAdaptive(f, 0, TAU);
    expect(ts.length).toBe(pts.length);
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const s of [0.25, 0.5, 0.75]) {
        const p = f(ts[i] + s * (ts[i + 1] - ts[i]));
        expect(segmentDistance(p, pts[i], pts[i + 1])).toBeLessThanOrEqual(0.25 + 1e-9);
      }
    }
  });

  it("caps the points at extreme zoom and still ends at t1", () => {
    const { pts, ts } = sampleAdaptive(circle(1e9), 0, TAU);
    expect(pts.length).toBeLessThanOrEqual(4096);
    expect(ts[ts.length - 1]).toBe(TAU);
  });

  it("does not refine a curve smaller than a pixel, nor one that evaluates to NaN", () => {
    expect(sampleAdaptive(circle(1e-6), 0, TAU).pts.length).toBe(17);
    expect(sampleAdaptive(() => [NaN, NaN], 0, 1).pts.length).toBe(17);
  });
});

describe("dashPolyline", () => {
  it("cuts a straight line into dashes of the given length", () => {
    const dashes = dashPolyline([[0, 0], [100, 0]], 6, 4);
    expect(dashes.length).toBe(10);
    expect(dashes[0]).toEqual([[0, 0], [6, 0]]);
    expect(dashes[1]).toEqual([[10, 0], [16, 0]]);
    expect(dashes[9]).toEqual([[90, 0], [96, 0]]);
  });

  it("carries a dash around a corner", () => {
    const dashes = dashPolyline([[0, 0], [5, 0], [5, 5]], 6, 4);
    expect(dashes).toEqual([[[0, 0], [5, 0], [5, 1]]]);
  });

  it("falls back to a solid line rather than produce too many dashes", () => {
    const line: Vec2[] = [[0, 0], [1e6, 0]];
    expect(dashPolyline(line, 1, 1)).toEqual([line]);
  });

  it("gives nothing for a single point", () => {
    expect(dashPolyline([[1, 1]], 6, 4)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/sample.test.ts`
Expected: FAIL, "Failed to resolve import "../src/geom/sample"".

- [ ] **Step 4: Implement `sample.ts`**

Create `frontend/src/geom/sample.ts`:

```ts
import type { Vec2 } from "./vec";

export interface Sampled {
  pts: Vec2[];
  /** The parameter of every point (for tooltips: hover → t). */
  ts: number[];
}

const SEED_SEGMENTS = 16;
const MAX_DEPTH = 20;

/** Distance from `p` to the segment [a, b]. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy);
}

/**
 * Screen-space polyline of `f` over [t0, t1]: 16 even segments, each halved until the
 * curve's midpoint is within `tol` pixels of the chord, with at most `maxPoints` points in
 * all (spec §5.2: chord error ≤ 0.25 px, segments capped). Conics have no inflection, so
 * the midpoint test bounds the whole arc.
 */
export function sampleAdaptive(f: (t: number) => Vec2, t0: number, t1: number, tol = 0.25, maxPoints = 4096): Sampled {
  const pts: Vec2[] = [f(t0)];
  const ts: number[] = [t0];
  let budget = maxPoints - SEED_SEGMENTS - 1;
  const refine = (a: number, pa: Vec2, b: number, pb: Vec2, depth: number): void => {
    const m = (a + b) / 2;
    const pm = f(m);
    if (depth < MAX_DEPTH && budget > 0 && segmentDistance(pm, pa, pb) > tol) {
      budget--;
      refine(a, pa, m, pm, depth + 1);
      refine(m, pm, b, pb, depth + 1);
    } else {
      pts.push(pb);
      ts.push(b);
    }
  };
  for (let i = 0; i < SEED_SEGMENTS; i++) {
    const a = ts[ts.length - 1];
    const b = i + 1 === SEED_SEGMENTS ? t1 : t0 + ((t1 - t0) * (i + 1)) / SEED_SEGMENTS;
    refine(a, pts[pts.length - 1], b, f(b), 0);
  }
  return { pts, ts };
}

/**
 * Dashes along a polyline: `dash` pixels drawn, `gap` skipped, repeating across corners.
 * Returns the line solid when it would take more than `maxDashes` dashes.
 */
export function dashPolyline(pts: Vec2[], dash: number, gap: number, maxDashes = 5000): Vec2[][] {
  if (pts.length < 2) return [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (!(dash > 0 && gap > 0) || total / (dash + gap) > maxDashes) return [pts];
  const out: Vec2[][] = [];
  let on = true;
  let left = dash; // pixels left in the current dash or gap
  let current: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (seg > left) {
      const s = left / seg;
      const cut: Vec2 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
      if (on) {
        current.push(cut);
        out.push(current);
      } else {
        current = [cut];
      }
      on = !on;
      seg -= left;
      a = cut;
      left = on ? dash : gap;
    }
    left -= seg;
    if (on) current.push(b);
  }
  if (on && current.length >= 2) out.push(current);
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run test/sample.test.ts && npx tsc --noEmit`
Expected: PASS (9 tests); tsc prints nothing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/geom/vec.ts frontend/src/geom/sample.ts frontend/test/sample.test.ts
git commit -m "geom: adaptive screen-space sampling (≤ 0.25 px, capped) and polyline dashes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Task 5: Derived extras (foci, center, axes, asymptotes, directrix, vertex)

Spec §5.2: "Extras derived from analytic parameters: foci, center, principal axes, asymptotes, directrix, vertex — dashed, same color, lighter." This task computes them; Task 7 draws them. Extra lines are returned as infinite `line` geoms, so they reuse the clipping and sampling of Tasks 3 and 4 unchanged.

Closed forms, in the curve's frame (x along `frame.x`, y along `frame.y`):

| curve | foci | directrix | other |
|---|---|---|---|
| circle | center "O" | — | axes |
| ellipse | ±c on the major axis, c = √\|a² − b²\| (on y when b > a) | ±big²/c, perpendicular to the major axis | center, 4 vertices, axes |
| parabola (P = t²/(4f)·x + t·y) | f·x | through −f·x, along y | vertex = origin, axis along x |
| hyperbola (one branch, a cosh t, b sinh t) | ±c on x, c = √(a² + b²) | x = a²/c (the drawn branch's) | center, vertex a·x, axes, asymptotes along a·x ± b·y |

The tests check the defining properties rather than the formulas: the focal sum of an ellipse, a parabola's equal distances, a hyperbola's focal difference and its eccentricity ratio, and asymptotic approach.

**Files:**
- Create: `frontend/src/geom/extras.ts`
- Test: `frontend/test/extras.test.ts`

**Interfaces:**
- Consumes: `CurveGeom` (`geom/types.ts`), `Vec3`, `add`, `scale`, `inFrame` (`geom/vec.ts`).
- Produces:
  - `type LineGeom = Extract<CurveGeom, { type: "line" }>`
  - `interface Extras { lines: LineGeom[]; points: { p: Vec3; name: string }[] }`
  - `curveExtras(g: CurveGeom, wanted: Record<string, unknown>): Extras`. Point names: `O`, `F`, `F₁`, `F₂`, `V`, `V₁`…`V₄`. For a hyperbola, `lines` come in the order asymptotes, then directrix (when both are asked).

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/extras.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evalCurve } from "../src/geom/curves";
import { Extras, LineGeom, curveExtras } from "../src/geom/extras";
import type { CurveGeom } from "../src/geom/types";
import type { Frame, Vec3 } from "../src/geom/vec";

const ALL = { foci: true, center: true, axes: true, asymptotes: true, directrix: true, vertex: true };
const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
function turned(angle: number, o: Vec3 = [1.5, -0.7, 0]): Frame {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { o, x: [c, s, 0], y: [-s, c, 0], z: [0, 0, 1] };
}

const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
/** Distance from p to an infinite line. */
function lineDist(p: Vec3, l: LineGeom): number {
  const w = [p[0] - l.o[0], p[1] - l.o[1]];
  return Math.abs(w[0] * l.d[1] - w[1] * l.d[0]) / Math.hypot(l.d[0], l.d[1]);
}
const named = (e: Extras, name: string): Vec3 => {
  const found = e.points.find((p) => p.name === name);
  if (!found) throw new Error(`no extra point ${name}`);
  return found.p;
};
const params = [-2.5, -1, -0.3, 0.4, 1.2, 2.9];

describe("curveExtras", () => {
  it("puts an ellipse's foci where the focal distances sum to the major axis", () => {
    for (const [g, major] of [
      [{ type: "ellipse", frame: turned(0.6), a: 3, b: 2 }, 6],
      [{ type: "ellipse", frame: turned(-1.2), a: 1, b: 2.5 }, 5], // b > a: foci on the y axis
    ] as [CurveGeom, number][]) {
      const e = curveExtras(g, { foci: true });
      for (const t of params) {
        const p = evalCurve(g, t);
        expect(dist(p, named(e, "F₁")) + dist(p, named(e, "F₂"))).toBeCloseTo(major, 9);
      }
    }
  });

  it("keeps the eccentricity ratio for an ellipse's directrices", () => {
    const g: CurveGeom = { type: "ellipse", frame: turned(0.3), a: 4, b: 3 };
    const e = curveExtras(g, { foci: true, directrix: true });
    const ecc = Math.sqrt(16 - 9) / 4;
    expect(e.lines).toHaveLength(2);
    for (const t of params) {
      const p = evalCurve(g, t);
      expect(dist(p, named(e, "F₁")) / lineDist(p, e.lines[0])).toBeCloseTo(ecc, 9);
    }
  });

  it("puts a parabola's focus and directrix at equal distances from every point", () => {
    for (const f of [0.5, -0.5]) {
      const g: CurveGeom = { type: "parabola", frame: turned(2.1), f };
      const e = curveExtras(g, { foci: true, directrix: true });
      for (const t of params) {
        const p = evalCurve(g, t);
        expect(dist(p, named(e, "F"))).toBeCloseTo(lineDist(p, e.lines[0]), 9);
      }
    }
  });

  it("gives a hyperbola its foci, asymptotes and directrix", () => {
    const g: CurveGeom = { type: "hyperbola", frame: turned(-0.8), a: 1.5, b: 0.8 };
    const e = curveExtras(g, { foci: true, asymptotes: true, directrix: true });
    const c = Math.hypot(1.5, 0.8);
    for (const t of params) {
      const p = evalCurve(g, t);
      expect(Math.abs(dist(p, named(e, "F₁")) - dist(p, named(e, "F₂")))).toBeCloseTo(3, 9);
      expect(dist(p, named(e, "F₁")) / lineDist(p, e.lines[2])).toBeCloseTo(c / 1.5, 9);
    }
    const far = evalCurve(g, 8);
    expect(Math.min(lineDist(far, e.lines[0]), lineDist(far, e.lines[1]))).toBeLessThan(1e-3);
  });

  it("marks a circle's center and an ellipse's vertices", () => {
    const circle = curveExtras({ type: "circle", frame: turned(0.4), r: 2 }, { center: true });
    expect(circle.points).toEqual([{ p: [1.5, -0.7, 0], name: "O" }]);
    const ellipse = curveExtras({ type: "ellipse", frame: world, a: 3, b: 2 }, { vertex: true, axes: true });
    expect(ellipse.points.map((p) => p.p)).toEqual([[3, 0, 0], [-3, 0, 0], [0, 2, 0], [0, -2, 0]]);
    expect(ellipse.lines).toHaveLength(2);
  });

  it("gives nothing for a line, a false value or an unknown key", () => {
    expect(curveExtras({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }, ALL)).toEqual({ lines: [], points: [] });
    const g: CurveGeom = { type: "ellipse", frame: world, a: 3, b: 2 };
    expect(curveExtras(g, { foci: false, isolines: [4, 4], asymptotes: true })).toEqual({ lines: [], points: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/extras.test.ts`
Expected: FAIL, "Failed to resolve import "../src/geom/extras"".

- [ ] **Step 3: Implement `extras.ts`**

Create `frontend/src/geom/extras.ts`:

```ts
import type { CurveGeom } from "./types";
import { Vec3, add, inFrame, scale } from "./vec";

export type LineGeom = Extract<CurveGeom, { type: "line" }>;

/** Construction elements of a conic: infinite lines (drawn like any line) and named points. */
export interface Extras {
  lines: LineGeom[];
  points: { p: Vec3; name: string }[];
}

/**
 * The extras an object asks for (protocol `extras`: foci, center, axes, asymptotes,
 * directrix, vertex), derived from the analytic parameters. Unknown keys, false values
 * and extras that do not apply to the curve (asymptotes of an ellipse) give nothing.
 */
export function curveExtras(g: CurveGeom, wanted: Record<string, unknown>): Extras {
  const out: Extras = { lines: [], points: [] };
  if (g.type === "line") return out;
  const on = (key: string): boolean => Boolean(wanted[key]);
  const f = g.frame;
  const at = (cx: number, cy: number): Vec3 => inFrame(f, cx, cy);
  const line = (o: Vec3, d: Vec3) => out.lines.push({ type: "line", o, d });
  const point = (p: Vec3, name: string) => out.points.push({ p, name });
  const axes = () => {
    line(f.o, f.x);
    line(f.o, f.y);
  };
  switch (g.type) {
    case "circle":
      if (on("center") || on("foci")) point(f.o, "O"); // a circle's foci coincide with its center
      if (on("axes")) axes();
      break;
    case "ellipse": {
      const major = g.a >= g.b; // the foci lie on the longer axis
      const c = Math.sqrt(Math.abs(g.a * g.a - g.b * g.b));
      const big = Math.max(g.a, g.b);
      const along = (s: number) => (major ? at(s, 0) : at(0, s));
      if (on("foci")) {
        point(along(c), "F₁");
        point(along(-c), "F₂");
      }
      if (on("center")) point(f.o, "O");
      if (on("vertex")) {
        point(at(g.a, 0), "V₁");
        point(at(-g.a, 0), "V₂");
        point(at(0, g.b), "V₃");
        point(at(0, -g.b), "V₄");
      }
      if (on("axes")) axes();
      if (on("directrix") && c > 0) {
        const d = (big * big) / c;
        const dir = major ? f.y : f.x;
        line(along(d), dir);
        line(along(-d), dir);
      }
      break;
    }
    case "parabola":
      // P(t) = o + t²/(4f)·x + t·y: focus at f·x, directrix through −f·x along y.
      if (on("foci")) point(at(g.f, 0), "F");
      if (on("vertex")) point(f.o, "V");
      if (on("axes")) line(f.o, f.x);
      if (on("directrix")) line(at(-g.f, 0), f.y);
      break;
    case "hyperbola": {
      // One branch, P(t) = o + a·cosh t·x + b·sinh t·y.
      const c = Math.hypot(g.a, g.b);
      if (on("foci")) {
        point(at(c, 0), "F₁");
        point(at(-c, 0), "F₂");
      }
      if (on("center")) point(f.o, "O");
      if (on("vertex")) point(at(g.a, 0), "V");
      if (on("axes")) axes();
      if (on("asymptotes")) {
        line(f.o, add(scale(f.x, g.a), scale(f.y, g.b)));
        line(f.o, add(scale(f.x, g.a), scale(f.y, -g.b)));
      }
      if (on("directrix")) line(at((g.a * g.a) / c, 0), f.y); // the drawn branch's directrix
      break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run test/extras.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests); tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/geom/extras.ts frontend/test/extras.test.ts
git commit -m "geom: derive conic extras (foci, center, axes, asymptotes, directrix, vertex) from the analytic parameters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Plane-view camera, grid, label placement, picking and number formats

Five small pure modules that the draw list (Task 7) and the PixiJS view (Task 8) are built from. None of them touches the DOM.

- `view2d/camera.ts`: a world point at the pane's center, `scale` pixels per unit, y up, aspect locked 1:1. `fitCamera` must stay finite for a hidden 0 × 0 pane (Review Focus 1). The scale is clamped to [1e-9, 1e12] so extreme zoom never produces 0 or Infinity.
- `view2d/plane.ts`: the 1-2-5 grid. Major lines sit 60–150 px apart, and minor lines split them in 5 (in 4 for a 2·10ᵏ step). Tick labels switch to exponent notation for steps ≥ 1e6 or < 1e-4.
- `view2d/placement.ts`: greedy label placement (spec §5.2). Each label tries 8 spots around its anchor and takes the first that stays in the pane, overlaps no placed label, and covers no anchor's dot.
- `view2d/pick.ts`: the nearest object within 8 px. A point beats a curve passing under it by a 4 px bias, and the curve parameter is interpolated along the hit segment.
- `ui/format.ts`: `P₁ (1.84, 1.62)` formatting (Global Constraints): up to 3 decimals, trailing zeros dropped, never `-0`.

The existing `test/camera.test.ts` covers the 3D `src/camera.ts`, so the plane camera's tests go in `test/camera2d.test.ts`.

**Files:**
- Create: `frontend/src/view2d/camera.ts`, `frontend/src/view2d/plane.ts`, `frontend/src/view2d/placement.ts`, `frontend/src/view2d/pick.ts`, `frontend/src/ui/format.ts`
- Test: `frontend/test/camera2d.test.ts`, `frontend/test/plane.test.ts`, `frontend/test/placement.test.ts`, `frontend/test/pick.test.ts`, `frontend/test/format.test.ts`

**Interfaces:**
- Consumes: `Rect` (`geom/clip.ts`), `Box`, `Vec2`, `Vec3` (`geom/vec.ts`), `segmentDistance` (`geom/sample.ts`).
- Produces:
  - `interface Camera2D { cx: number; cy: number; scale: number; width: number; height: number }`, `MIN_SCALE = 1e-9`, `MAX_SCALE = 1e12`
  - `worldToScreen(c, x, y): Vec2`, `screenToWorld(c, sx, sy): Vec2`, `visibleRect(c): Rect`
  - `fitCamera(box: Box | null, width, height, pad = 40): Camera2D`, `zoomAt(c, sx, sy, factor)`, `panBy(c, dx, dy)`, `resizeCamera(c, width, height)`
  - `niceStep(raw)`, `gridSpacing(scale, targetPx = 60): { major; minor }`, `ticks(lo, hi, step, max = 2000): number[]`, `formatTick(v, step): string`
  - `interface LabelRequest { key; ax; ay; w; h; fixed? }`, `interface PlacedLabel { key; left; top }`, `MAX_LABELS = 500`, `placeLabels(requests, width, height): PlacedLabel[]`
  - `interface Pickable { id; polylines: { pts: Vec2[]; ts: number[] | null }[]; dots: { at: Vec2; index: number }[] }`, `interface Hit { id; dist; at: Vec2; t: number | null; index: number | null }`, `pickNearest(items, x, y, radius = 8): Hit | null`
  - `fmtNum(v, decimals = 3)`, `fmtPoint(p: Vec3)`, `fmtParams(v: unknown): string | null`

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/camera2d.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  Camera2D,
  MAX_SCALE,
  MIN_SCALE,
  fitCamera,
  panBy,
  resizeCamera,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomAt,
} from "../src/view2d/camera";

const cam: Camera2D = { cx: 1, cy: 2, scale: 50, width: 800, height: 600 };
const finite = (c: Camera2D) => [c.cx, c.cy, c.scale].every(Number.isFinite) && c.scale > 0;

describe("Camera2D transforms", () => {
  it("maps the center to the middle of the pane, y up", () => {
    expect(worldToScreen(cam, 1, 2)).toEqual([400, 300]);
    expect(worldToScreen(cam, 2, 3)).toEqual([450, 250]);
    expect(screenToWorld(cam, 450, 250)).toEqual([2, 3]);
  });

  it("reports the visible world rectangle", () => {
    expect(visibleRect(cam)).toEqual({ xmin: -7, xmax: 9, ymin: -4, ymax: 8 });
  });
});

describe("fitCamera", () => {
  it("frames a box with padding, keeping the aspect ratio 1:1", () => {
    const c = fitCamera({ min: [0, 0, 0], max: [10, 2, 0] }, 840, 600);
    expect(c).toEqual({ cx: 5, cy: 1, scale: 76, width: 840, height: 600 });
  });

  it("frames a vertical segment and a single point", () => {
    expect(fitCamera({ min: [3, 0, 0], max: [3, 4, 0] }, 800, 600).scale).toBe(130);
    const point = fitCamera({ min: [3, 4, 0], max: [3, 4, 0] }, 800, 600);
    expect([point.cx, point.cy, point.scale]).toEqual([3, 4, 260]);
  });

  it("shows ±5 around the origin for an empty scene", () => {
    const c = fitCamera(null, 800, 600);
    expect(visibleRect(c).ymin).toBeCloseTo(-5.77, 2);
    expect([c.cx, c.cy]).toEqual([0, 0]);
  });

  it("stays finite for a hidden pane", () => {
    const box = { min: [-1, -1, 0], max: [4, 2, 0] } as const;
    for (const [w, h] of [[0, 0], [0, 600], [1, 1]]) {
      const c = fitCamera({ min: [...box.min], max: [...box.max] }, w, h);
      expect(finite(c)).toBe(true);
      expect(finite(resizeCamera(c, 800, 600))).toBe(true);
      expect(worldToScreen(resizeCamera(c, 800, 600), 0, 0).every(Number.isFinite)).toBe(true);
    }
    expect(finite(fitCamera(null, 0, 0))).toBe(true);
  });

  it("clamps the zoom for huge and tiny scenes", () => {
    expect(fitCamera({ min: [0, 0, 0], max: [1e-15, 1e-15, 0] }, 800, 600).scale).toBe(MAX_SCALE);
    expect(fitCamera({ min: [0, 0, 0], max: [1e15, 1e15, 0] }, 800, 600).scale).toBe(MIN_SCALE);
  });
});

describe("zoomAt and panBy", () => {
  it("keeps the world point under the cursor while zooming", () => {
    const before = screenToWorld(cam, 100, 500);
    const zoomed = zoomAt(cam, 100, 500, 3);
    expect(zoomed.scale).toBe(150);
    const after = screenToWorld(zoomed, 100, 500);
    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
  });

  it("stops at the zoom limits", () => {
    expect(zoomAt(cam, 0, 0, 1e30).scale).toBe(MAX_SCALE);
    expect(zoomAt(cam, 0, 0, 1e-30).scale).toBe(MIN_SCALE);
  });

  it("drags the world with the pointer", () => {
    const moved = panBy(cam, 50, -100);
    expect(worldToScreen(moved, 1, 2)).toEqual([450, 200]);
  });
});
```

Create `frontend/test/plane.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTick, gridSpacing, niceStep, ticks } from "../src/view2d/plane";

describe("niceStep and gridSpacing", () => {
  it("rounds up to 1, 2 or 5 times a power of ten", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.3)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.0031)).toBeCloseTo(0.005, 15);
    expect(niceStep(2e7)).toBe(2e7);
  });

  it("puts major lines 60 to 150 px apart with matching minor lines", () => {
    expect(gridSpacing(100)).toEqual({ major: 1, minor: 0.2 });
    expect(gridSpacing(40)).toEqual({ major: 2, minor: 0.5 });
    expect(gridSpacing(25)).toEqual({ major: 5, minor: 1 });
  });
});

describe("ticks", () => {
  it("lists the multiples of the step in range", () => {
    expect(ticks(-1.2, 2.5, 1)).toEqual([-1, 0, 1, 2]);
    expect(ticks(0.1, 0.9, 1)).toEqual([]);
  });

  it("gives up rather than produce thousands of lines", () => {
    expect(ticks(0, 1e6, 1)).toEqual([]);
    expect(ticks(0, 1999, 1)).toHaveLength(2000);
  });
});

describe("formatTick", () => {
  it("shows as many decimals as the step needs", () => {
    expect(formatTick(2, 1)).toBe("2");
    expect(formatTick(-1.5, 0.5)).toBe("-1.5");
    expect(formatTick(0.30000000000000004, 0.1)).toBe("0.3");
    expect(formatTick(0.025, 0.005)).toBe("0.025");
    expect(formatTick(400, 200)).toBe("400");
  });

  it("writes 0 for the origin even after rounding noise", () => {
    expect(formatTick(1e-17, 0.1)).toBe("0");
    expect(formatTick(-0, 1)).toBe("0");
  });

  it("formats very large and very small steps", () => {
    expect(formatTick(3e6, 1e6)).toBe("3e6");
    expect(formatTick(-2e9, 1e9)).toBe("-2e9");
    expect(formatTick(2.5e-5, 5e-6)).toBe("2.5e-5");
    expect(formatTick(3 * 1e-7, 1e-7)).toBe("3e-7");
    const { major } = gridSpacing(1e-6);
    expect(Number.isFinite(major)).toBe(true);
    expect(formatTick(7 * major, major)).toBe("7e8");
  });
});
```

Create `frontend/test/placement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LabelRequest, MAX_LABELS, placeLabels } from "../src/view2d/placement";

const req = (key: string, ax: number, ay: number, extra: Partial<LabelRequest> = {}): LabelRequest => ({
  key,
  ax,
  ay,
  w: 60,
  h: 16,
  ...extra,
});

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}
const overlap = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

describe("placeLabels", () => {
  it("puts a lone label north-east of its anchor", () => {
    expect(placeLabels([req("a", 100, 100)], 800, 600)).toEqual([{ key: "a", left: 106, top: 78 }]);
  });

  it("moves a label inside the pane near an edge", () => {
    const [placed] = placeLabels([req("a", 790, 5)], 800, 600);
    expect(placed.left + 60).toBeLessThanOrEqual(800);
    expect(placed.top).toBeGreaterThanOrEqual(0);
  });

  it("never overlaps two labels nor covers another anchor's dot", () => {
    const requests = Array.from({ length: 30 }, (_, i) => req(`p${i}`, 300 + (i % 6) * 25, 300 + Math.floor(i / 6) * 12));
    const placed = placeLabels(requests, 800, 600);
    expect(placed.length).toBeGreaterThan(5);
    const boxes = placed.map((p) => ({ l: p.left, t: p.top, r: p.left + 60, b: p.top + 16 }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
      for (const q of requests) expect(overlap(boxes[i], { l: q.ax - 5, t: q.ay - 5, r: q.ax + 5, b: q.ay + 5 })).toBe(false);
    }
  });

  it("drops a label with no free spot", () => {
    const placed = placeLabels([req("a", 30, 10), req("b", 30, 10)], 70, 30);
    expect(placed.map((p) => p.key)).toEqual([]);
    expect(placeLabels([req("a", 10, 28)], 100, 30).map((p) => p.key)).toEqual(["a"]);
  });

  it("places fixed labels first, exactly above their anchor", () => {
    const placed = placeLabels([req("dot", 100, 100), req("text", 100, 100, { fixed: true })], 800, 600);
    expect(placed[0]).toEqual({ key: "text", left: 100, top: 84 });
    expect(placed.map((p) => p.key)).toEqual(["text", "dot"]);
  });

  it("stops at the label cap", () => {
    const many = Array.from({ length: 2000 }, (_, i) => req(`p${i}`, (i % 100) * 1000, Math.floor(i / 100) * 1000, { w: 10, h: 10 }));
    expect(placeLabels(many, 1e6, 1e6)).toHaveLength(MAX_LABELS);
  });
});
```

Create `frontend/test/pick.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Pickable, pickNearest } from "../src/view2d/pick";

const curve: Pickable = { id: "C", polylines: [{ pts: [[0, 100], [200, 100]], ts: [0, 2] }], dots: [] };
const point: Pickable = { id: "P", polylines: [], dots: [{ at: [100, 103], index: 0 }] };

describe("pickNearest", () => {
  it("finds a curve within 8 px and interpolates its parameter", () => {
    const hit = pickNearest([curve], 50, 106);
    expect(hit).toMatchObject({ id: "C", dist: 6, at: [50, 100], index: null });
    expect(hit!.t).toBeCloseTo(0.5, 12);
  });

  it("misses beyond the radius", () => {
    expect(pickNearest([curve], 50, 109)).toBeNull();
  });

  it("prefers a point over a curve passing under it", () => {
    expect(pickNearest([curve, point], 100, 101)?.id).toBe("P");
    expect(pickNearest([point, curve], 100, 101)?.id).toBe("P");
  });

  it("keeps the curve when the pointer is right on it and the point is farther", () => {
    const below: Pickable = { id: "P", polylines: [], dots: [{ at: [100, 107], index: 0 }] };
    expect(pickNearest([curve, below], 100, 100)?.id).toBe("C");
  });

  it("reports which dot of a points object was hit", () => {
    const cloud: Pickable = { id: "S", polylines: [], dots: [{ at: [0, 0], index: 0 }, { at: [20, 0], index: 1 }] };
    expect(pickNearest([cloud], 18, 2)).toMatchObject({ id: "S", index: 1, t: null, at: [20, 0] });
  });
});
```

Create `frontend/test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fmtNum, fmtParams, fmtPoint } from "../src/ui/format";

describe("format", () => {
  it("keeps up to 3 decimals and drops trailing zeros", () => {
    expect(fmtNum(1.84)).toBe("1.84");
    expect(fmtNum(1.6180339)).toBe("1.618");
    expect(fmtNum(2)).toBe("2");
    expect(fmtNum(2.0004)).toBe("2");
    expect(fmtNum(-0.0001)).toBe("0");
    expect(fmtNum(1500)).toBe("1500");
    expect(fmtNum(0.785398, 4)).toBe("0.7854");
  });

  it("writes plane points without z", () => {
    expect(fmtPoint([1.84, 1.62, 0])).toBe("(1.84, 1.62)");
    expect(fmtPoint([1, -2, 0.5])).toBe("(1, -2, 0.5)");
  });

  it("formats meta params generically", () => {
    expect(fmtParams(0.785398)).toBe("0.7854");
    expect(fmtParams([0.785398, 2.1])).toBe("(0.7854, 2.1)");
    expect(fmtParams([1, null])).toBe("(1, —)");
    expect(fmtParams("t")).toBeNull();
    expect(fmtParams(undefined)).toBeNull();
    expect(fmtParams([1, {}])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/camera2d.test.ts test/plane.test.ts test/placement.test.ts test/pick.test.ts test/format.test.ts`
Expected: FAIL, five "Failed to resolve import" errors.

- [ ] **Step 3: Implement the camera**

Create `frontend/src/view2d/camera.ts`:

```ts
import type { Rect } from "../geom/clip";
import type { Box, Vec2 } from "../geom/vec";

/** The plane view's camera: world point (cx, cy) at the pane's center, `scale` pixels per world unit, y up. */
export interface Camera2D {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}

export const MIN_SCALE = 1e-9;
export const MAX_SCALE = 1e12;

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function worldToScreen(c: Camera2D, x: number, y: number): Vec2 {
  return [(x - c.cx) * c.scale + c.width / 2, c.height / 2 - (y - c.cy) * c.scale];
}

export function screenToWorld(c: Camera2D, sx: number, sy: number): Vec2 {
  return [c.cx + (sx - c.width / 2) / c.scale, c.cy - (sy - c.height / 2) / c.scale];
}

/** The world rectangle the pane shows. */
export function visibleRect(c: Camera2D): Rect {
  const hw = c.width / 2 / c.scale;
  const hh = c.height / 2 / c.scale;
  return { xmin: c.cx - hw, xmax: c.cx + hw, ymin: c.cy - hh, ymax: c.cy + hh };
}

/**
 * Frame `box` (its x/y extent) with `pad` pixels on every side. A pane that is hidden
 * (0 × 0) still gets a finite camera; an empty scene shows ±5 around the origin; a single
 * point gets a 2 × 2 window around it.
 */
export function fitCamera(box: Box | null, width: number, height: number, pad = 40): Camera2D {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const availW = Math.max(w - 2 * pad, w / 2);
  const availH = Math.max(h - 2 * pad, h / 2);
  if (!box) return { cx: 0, cy: 0, scale: clampScale(Math.min(availW, availH) / 10), width, height };
  let bw = box.max[0] - box.min[0];
  let bh = box.max[1] - box.min[1];
  if (!(bw > 0) && !(bh > 0)) bw = bh = 2;
  const fits = [bw > 0 ? availW / bw : Infinity, bh > 0 ? availH / bh : Infinity];
  return {
    cx: (box.min[0] + box.max[0]) / 2,
    cy: (box.min[1] + box.max[1]) / 2,
    scale: clampScale(Math.min(...fits)),
    width,
    height,
  };
}

/** Zoom by `factor` keeping the world point under screen (sx, sy) in place. */
export function zoomAt(c: Camera2D, sx: number, sy: number, factor: number): Camera2D {
  const [wx, wy] = screenToWorld(c, sx, sy);
  const scale = clampScale(c.scale * factor);
  return {
    ...c,
    scale,
    cx: wx - (sx - c.width / 2) / scale,
    cy: wy + (sy - c.height / 2) / scale,
  };
}

/** Move the view by a screen drag of (dx, dy) pixels. */
export function panBy(c: Camera2D, dx: number, dy: number): Camera2D {
  return { ...c, cx: c.cx - dx / c.scale, cy: c.cy + dy / c.scale };
}

/** The pane changed size: keep the center and the zoom. */
export function resizeCamera(c: Camera2D, width: number, height: number): Camera2D {
  return { ...c, width, height };
}
```

- [ ] **Step 4: Implement the grid helpers**

Create `frontend/src/view2d/plane.ts`:

```ts
/** The smallest 1, 2 or 5 × 10ᵏ that is ≥ `raw`. */
export function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  for (const m of [1, 2, 5]) if (m * base >= raw * (1 - 1e-12)) return m * base;
  return 10 * base;
}

/** Major grid lines at least `targetPx` apart (so 60–150 px); minor lines split them in 5 (in 4 when the major step is 2·10ᵏ). */
export function gridSpacing(scale: number, targetPx = 60): { major: number; minor: number } {
  const major = niceStep(targetPx / scale);
  const mantissa = Math.round(major / 10 ** Math.floor(Math.log10(major)));
  return { major, minor: major / (mantissa === 2 ? 4 : 5) };
}

/** Multiples of `step` in [lo, hi], none when there would be more than `max`. */
export function ticks(lo: number, hi: number, step: number, max = 2000): number[] {
  const first = Math.ceil(lo / step);
  const last = Math.floor(hi / step);
  if (!(last - first < max)) return [];
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i * step);
  return out;
}

/** A tick label: as many decimals as the step needs, exponent notation for very large or small steps. */
export function formatTick(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-9) return "0";
  if (step >= 1e6 || step < 1e-4) return Number(v.toPrecision(12)).toExponential().replace("e+", "e");
  return v.toFixed(Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}
```

- [ ] **Step 5: Implement label placement**

Create `frontend/src/view2d/placement.ts`:

```ts
/** A label to place: anchored at screen (ax, ay), `w` × `h` pixels. `fixed` labels sit just above their anchor. */
export interface LabelRequest {
  key: string;
  ax: number;
  ay: number;
  w: number;
  h: number;
  fixed?: boolean;
}

export interface PlacedLabel {
  key: string;
  left: number;
  top: number;
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

const GAP = 6;
const DOT = 5;
export const MAX_LABELS = 500;

/** Candidate top-left corners around the anchor, in order of preference: NE, E, SE, NW, W, SW, N, S. */
function candidates(q: LabelRequest): [number, number][] {
  const { ax, ay, w, h } = q;
  return [
    [ax + GAP, ay - GAP - h],
    [ax + GAP, ay - h / 2],
    [ax + GAP, ay + GAP],
    [ax - GAP - w, ay - GAP - h],
    [ax - GAP - w, ay - h / 2],
    [ax - GAP - w, ay + GAP],
    [ax - w / 2, ay - GAP - h],
    [ax - w / 2, ay + GAP],
  ];
}

const overlaps = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/**
 * Greedy placement (spec §5.2): requests in order, each at the first candidate that stays
 * inside the `width` × `height` pane and overlaps neither a placed label nor any anchor's
 * dot. Fixed labels (plain text objects) go first, where they were asked. A label with no
 * free spot is left out; at most `MAX_LABELS` are placed.
 */
export function placeLabels(requests: LabelRequest[], width: number, height: number): PlacedLabel[] {
  const taken: Box[] = requests.map((q) => ({ l: q.ax - DOT, t: q.ay - DOT, r: q.ax + DOT, b: q.ay + DOT }));
  const out: PlacedLabel[] = [];
  const ordered = [...requests.filter((q) => q.fixed), ...requests.filter((q) => !q.fixed)];
  for (const q of ordered) {
    if (out.length >= MAX_LABELS) break;
    const spots: [number, number][] = q.fixed ? [[q.ax, q.ay - q.h]] : candidates(q);
    for (const [left, top] of spots) {
      const box = { l: left, t: top, r: left + q.w, b: top + q.h };
      if (box.l < 0 || box.t < 0 || box.r > width || box.b > height) continue;
      if (!q.fixed && taken.some((o) => overlaps(o, box))) continue;
      taken.push(box);
      out.push({ key: q.key, left, top });
      break;
    }
  }
  return out;
}
```

- [ ] **Step 6: Implement picking**

Create `frontend/src/view2d/pick.ts`:

```ts
import { segmentDistance } from "../geom/sample";
import type { Vec2 } from "../geom/vec";

/** What the pointer can hit: an object's screen polylines (with their parameters, for curves) and dots. */
export interface Pickable {
  id: string;
  polylines: { pts: Vec2[]; ts: number[] | null }[];
  dots: { at: Vec2; index: number }[];
}

export interface Hit {
  id: string;
  /** Pixels from the pointer. */
  dist: number;
  /** The hit point on the polyline, or the dot's center. */
  at: Vec2;
  /** The curve parameter at `at` (interpolated), when the polyline carries parameters. */
  t: number | null;
  /** Which dot of a `points` object was hit. */
  index: number | null;
}

/** Points win a near-tie with a curve passing under them. */
const POINT_BIAS = 4;

/** The object nearest to screen (x, y) within `radius` pixels (spec §5.2: 8 px), or null. */
export function pickNearest(items: Pickable[], x: number, y: number, radius = 8): Hit | null {
  const p: Vec2 = [x, y];
  let best: Hit | null = null;
  let bestScore = Infinity;
  for (const item of items) {
    for (const dot of item.dots) {
      const d = Math.hypot(dot.at[0] - x, dot.at[1] - y);
      if (d <= radius && d - POINT_BIAS < bestScore) {
        bestScore = d - POINT_BIAS;
        best = { id: item.id, dist: d, at: dot.at, t: null, index: dot.index };
      }
    }
    for (const line of item.polylines) {
      const pts = line.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = segmentDistance(p, pts[i], pts[i + 1]);
        if (d > radius || d >= bestScore) continue;
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
        const ts = line.ts;
        bestScore = d;
        best = {
          id: item.id,
          dist: d,
          at: [a[0] + s * dx, a[1] + s * dy],
          t: ts ? ts[i] + s * (ts[i + 1] - ts[i]) : null,
          index: null,
        };
      }
    }
  }
  return best;
}
```

- [ ] **Step 7: Implement the number formats**

Create `frontend/src/ui/format.ts`:

```ts
import type { Vec3 } from "../geom/vec";

/** A number with at most `decimals` decimals, trailing zeros dropped, never "-0". */
export function fmtNum(v: number, decimals = 3): string {
  const s = v.toFixed(decimals);
  const trimmed = s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

/** "(x, y)" for a point in the plane z = 0, else "(x, y, z)". */
export function fmtPoint(p: Vec3): string {
  const xy = `${fmtNum(p[0])}, ${fmtNum(p[1])}`;
  return Math.abs(p[2]) < 1e-12 ? `(${xy})` : `(${xy}, ${fmtNum(p[2])})`;
}

/** `meta.params` for the tooltip: a number, a tuple "(…)" or "—" for null; null when it is anything else. */
export function fmtParams(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return fmtNum(v, 4);
  if (v === null) return "—";
  if (Array.isArray(v)) {
    const parts = v.map(fmtParams);
    return parts.every((p) => p !== null) ? `(${parts.join(", ")})` : null;
  }
  return null;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run test/camera2d.test.ts test/plane.test.ts test/placement.test.ts test/pick.test.ts test/format.test.ts && npx tsc --noEmit`
Expected: PASS (31 tests: camera2d 10, plane 7, placement 6, pick 5, format 3); tsc prints nothing.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/view2d/camera.ts frontend/src/view2d/plane.ts frontend/src/view2d/placement.ts frontend/src/view2d/pick.ts frontend/src/ui/format.ts frontend/test/camera2d.test.ts frontend/test/plane.test.ts frontend/test/placement.test.ts frontend/test/pick.test.ts frontend/test/format.test.ts
git commit -m "view2d: camera, 1-2-5 grid, greedy label placement, picking and coordinate formats (pure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The plane view's draw list

`buildDrawList` turns the scene and the camera into everything one frame paints, in screen pixels: strokes, dots, labels and what hover can pick. It is pure, so every rule of spec §5.2 is unit-tested here and Task 8 only paints the result. The rules:

- Only planar objects (`inPlaneZ0`) that UiState shows are drawn. Notes go to the panel only.
- Curves are clipped to the viewport plus 10 % (Task 3) and sampled to ≤ 0.25 px (Task 4) on every frame, so line widths stay constant in pixels. A curve's label sits 30 % along its longest on-screen run.
- Widths: `style.width` or 2.5 px, ×1.5 in presentation mode, +1.5 px while hovered. `style.dashed` dashes 7/5 px (scaled with the width), and `style.opacity` becomes the alpha.
- Extras are thinner (1.5 px), dashed, and their colour is mixed 45 % towards the background. Extra points are hollow and named (`F₁`).
- A point gets a filled dot and the label `P₁ (1.841, 1.62)`, with the coordinates taken from the protocol. A `points` object gets one dot per position and its label at the first one.
- `text` objects are drawn where they are asked, in the theme's text colour unless they have a `style.color`.
- Labels are ordered for placement: the hovered object first, then text, points, curves, extras.

**Files:**
- Create: `frontend/src/view2d/render.ts`
- Test: `frontend/test/render.test.ts`

**Interfaces:**
- Consumes:
  - from earlier tasks: `clipCurve2D`, `expandRect`, `Rect` (Task 3); `sampleAdaptive`, `dashPolyline`, `Sampled` (Task 4); `curveExtras` (Task 5); `Camera2D`, `worldToScreen`, `screenToWorld`, `visibleRect` (Task 6); `Pickable`, `Hit` (Task 6); `fmtNum`, `fmtPoint`, `fmtParams` (Task 6); `Palette`, `mixHex` (Task 2)
  - from Phase 1: `evalCurve`, `inPlaneZ0`, `arrowPolylines`, `isCurve`, `colorOf`
- Produces:
  - constants `LINE_PX = 2.5`, `POINT_PX = 4.5`, `HIGHLIGHT_PX = 1.5`, `EXTRA_PX = 1.5`, `EXTRA_DOT_PX = 3.5`, `DASH = [7, 5]`, `EXTRA_MIX = 0.45`, `MARGIN = 0.1`
  - `interface DrawOptions { visible: (o: SceneObject) => boolean; palette: Palette; widthScale: number; highlight: string | null }`
  - `interface Stroke { id; extra: boolean; paths: Vec2[][]; color; width; alpha }`
  - `interface Dot { id; at: Vec2; color; radius; alpha; hollow: boolean }`
  - `type TextKind = "text" | "point" | "curve" | "extra"`, `interface TextItem { key; id; text; at: Vec2; color; kind: TextKind }`
  - `interface DrawList { strokes: Stroke[]; dots: Dot[]; texts: TextItem[]; pickables: Pickable[] }`
  - `curvePolylines(g: CurveGeom, cam: Camera2D, clip: Rect): Sampled[]`
  - `buildDrawList(objects: Iterable<SceneObject>, cam: Camera2D, opts: DrawOptions): DrawList`
  - `describeHit(o: SceneObject, hit: Hit, cam: Camera2D): string[]`: the tooltip lines.
  - Text keys: `c:<id>` curve label, `p:<id>` point label, `t:<id>` text, `x:<id>:<name>` extra point.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Vec2 } from "../src/geom/vec";
import type { SceneObject } from "../src/protocol";
import { PALETTES, mixHex } from "../src/ui/theme";
import { Camera2D } from "../src/view2d/camera";
import { DrawOptions, EXTRA_MIX, buildDrawList, describeHit } from "../src/view2d/render";

const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const obj = (id: string, geom: unknown, extra: Partial<SceneObject> = {}) => ({ id, geom, ...extra }) as SceneObject;
const cam: Camera2D = { cx: 0, cy: 0, scale: 100, width: 800, height: 600 };
const opts = (extra: Partial<DrawOptions> = {}): DrawOptions => ({
  visible: () => true,
  palette: PALETTES.light,
  widthScale: 1,
  highlight: null,
  ...extra,
});
const diagonal = obj("L", { type: "line", o: [0.3, -0.2, 0], d: [1, 0.7, 0] });

/** True when the polyline enters from beyond one edge of the pane and leaves beyond another. */
function crossesPane(pts: Vec2[], c: Camera2D): boolean {
  const outside = (p: Vec2) => p[0] < 0 || p[0] > c.width || p[1] < 0 || p[1] > c.height;
  return pts.length >= 2 && outside(pts[0]) && outside(pts[pts.length - 1]);
}

describe("buildDrawList", () => {
  it("draws an infinite line edge to edge", () => {
    const list = buildDrawList([diagonal], cam, opts());
    expect(list.strokes).toHaveLength(1);
    expect(list.strokes[0].paths).toHaveLength(1);
    expect(crossesPane(list.strokes[0].paths[0], cam)).toBe(true);
  });

  it("keeps the line edge to edge at extreme zoom", () => {
    for (const scale of [1e-6, 1e-3, 1e3, 1e8]) {
      const c = { ...cam, cx: 0.3, cy: -0.2, scale }; // centred on the line's origin, which lies on it
      const [stroke] = buildDrawList([diagonal], c, opts()).strokes;
      expect(stroke.paths, `scale ${scale}`).toHaveLength(1);
      const pts = stroke.paths[0];
      expect(crossesPane(pts, c), `scale ${scale}`).toBe(true);
      expect(pts.length).toBeLessThanOrEqual(4096);
      expect(pts.flat().every(Number.isFinite)).toBe(true);
    }
  });

  it("labels a point with its protocol coordinates", () => {
    const list = buildDrawList([obj("P₁", { type: "point", p: [1.8412, 1.62, 0] }, { label: "P₁" })], cam, opts());
    expect(list.dots).toMatchObject([{ id: "P₁", at: [584.12, 138], radius: 4.5, hollow: false }]);
    expect(list.texts).toMatchObject([{ key: "p:P₁", text: "P₁ (1.841, 1.62)", kind: "point" }]);
  });

  it("skips hidden, non-planar and note objects", () => {
    const objects = [
      obj("hidden", { type: "point", p: [0, 0, 0] }),
      obj("lifted", { type: "point", p: [0, 0, 1] }),
      obj("sphere", { type: "sphere", frame, r: 1 }),
      obj("note", { type: "note", text: "hi" }),
    ];
    const list = buildDrawList(objects, cam, opts({ visible: (o) => o.id !== "hidden" }));
    expect(list.dots).toEqual([]);
    expect(list.strokes).toEqual([]);
    expect(list.texts).toEqual([]);
  });

  it("draws extras dashed, thinner and faded towards the background", () => {
    const e = obj("E", { type: "ellipse", frame, a: 3, b: 2 }, { style: { color: "#d1495b" }, extras: { foci: true, axes: true } });
    const list = buildDrawList([e], cam, opts());
    const extra = list.strokes.find((s) => s.extra)!;
    expect(extra.color).toBe(mixHex("#d1495b", PALETTES.light.bg, EXTRA_MIX));
    expect(extra.width).toBe(1.5);
    expect(extra.paths.length).toBeGreaterThan(20); // two axes cut into 7 px dashes
    expect(list.dots.filter((d) => d.hollow).map((d) => d.at)).toEqual([[400 + 100 * Math.sqrt(5), 300], [400 - 100 * Math.sqrt(5), 300]]);
    expect(list.texts.filter((t) => t.kind === "extra").map((t) => t.text)).toEqual(["F₁", "F₂"]);
  });

  it("widens lines by half in presentation mode and more when highlighted", () => {
    const c = obj("C", { type: "circle", frame, r: 1 });
    expect(buildDrawList([c], cam, opts({ widthScale: 1.5 })).strokes[0].width).toBe(3.75);
    expect(buildDrawList([c], cam, opts({ widthScale: 1.5, highlight: "C" })).strokes[0].width).toBe(5.25);
  });

  it("honours the style's width, dashes and opacity", () => {
    const c = obj("C", { type: "circle", frame, r: 1 }, { style: { width: 4, dashed: true, opacity: 0.5 } });
    const [stroke] = buildDrawList([c], cam, opts()).strokes;
    expect(stroke.width).toBe(4);
    expect(stroke.alpha).toBe(0.5);
    expect(stroke.paths.length).toBeGreaterThan(40); // 628 px of circle in 12 px periods
  });

  it("puts highlighted labels first, then text, points, curves, extras", () => {
    const objects = [
      obj("C", { type: "circle", frame, r: 1 }),
      obj("P", { type: "point", p: [2, 0, 0] }),
      obj("T", { type: "text", at: [0, 2, 0], text: "hello" }),
    ];
    expect(buildDrawList(objects, cam, opts()).texts.map((t) => t.id)).toEqual(["T", "P", "C"]);
    expect(buildDrawList(objects, cam, opts({ highlight: "C" })).texts.map((t) => t.id)).toEqual(["C", "T", "P"]);
  });

  it("gives pickables with curve parameters", () => {
    const list = buildDrawList([obj("C", { type: "circle", frame, r: 1 })], cam, opts());
    const [line] = list.pickables[0].polylines;
    expect(line.ts).not.toBeNull();
    expect(line.ts!.length).toBe(line.pts.length);
  });
});

describe("describeHit", () => {
  it("shows a point's label, type, coordinates and params", () => {
    const p = obj("P₁", { type: "point", p: [1.84, 1.62, 0] }, { label: "P₁", meta: { params: [0.785398, 2.1] } });
    expect(describeHit(p, { id: "P₁", dist: 0, at: [0, 0], t: null, index: 0 }, cam)).toEqual([
      "P₁ · point",
      "(1.84, 1.62)",
      "params (0.7854, 2.1)",
    ]);
  });

  it("shows a curve's parameter and the point there", () => {
    const c = obj("C", { type: "circle", frame, r: 1 });
    expect(describeHit(c, { id: "C", dist: 1, at: [400, 200], t: Math.PI / 2, index: null }, cam)).toEqual([
      "C · circle",
      "t = 1.5708",
      "(0, 1)",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/render.test.ts`
Expected: FAIL, "Failed to resolve import "../src/view2d/render"".

- [ ] **Step 3: Implement `render.ts`**

Create `frontend/src/view2d/render.ts`:

```ts
import { Rect, clipCurve2D, expandRect } from "../geom/clip";
import { evalCurve } from "../geom/curves";
import { curveExtras } from "../geom/extras";
import { inPlaneZ0 } from "../geom/planar";
import { Sampled, dashPolyline, sampleAdaptive } from "../geom/sample";
import { arrowPolylines } from "../geom/tessellate";
import { CurveGeom, isCurve } from "../geom/types";
import type { Vec2, Vec3 } from "../geom/vec";
import type { SceneObject } from "../protocol";
import { colorOf } from "../ui/colors";
import { fmtNum, fmtParams, fmtPoint } from "../ui/format";
import { Palette, mixHex } from "../ui/theme";
import { Camera2D, screenToWorld, visibleRect, worldToScreen } from "./camera";
import type { Hit, Pickable } from "./pick";

export const LINE_PX = 2.5;
export const POINT_PX = 4.5;
export const HIGHLIGHT_PX = 1.5;
export const EXTRA_PX = 1.5;
export const EXTRA_DOT_PX = 3.5;
export const DASH: [number, number] = [7, 5];
/** How far extras move towards the background colour ("same color, lighter"). */
export const EXTRA_MIX = 0.45;
/** Curves are clipped to the viewport grown by this fraction on every side (spec §5.2). */
export const MARGIN = 0.1;

export interface DrawOptions {
  visible: (o: SceneObject) => boolean;
  palette: Palette;
  /** 1, or 1.5 in presentation mode. */
  widthScale: number;
  /** The hovered object, drawn thicker. */
  highlight: string | null;
}

export interface Stroke {
  id: string;
  extra: boolean;
  paths: Vec2[][];
  color: string;
  width: number;
  alpha: number;
}

export interface Dot {
  id: string;
  at: Vec2;
  color: string;
  radius: number;
  alpha: number;
  hollow: boolean;
}

export type TextKind = "text" | "point" | "curve" | "extra";

export interface TextItem {
  key: string;
  id: string;
  text: string;
  /** Screen anchor: the point, a spot on the curve, or the text's own position. */
  at: Vec2;
  color: string;
  kind: TextKind;
}

/** Everything one frame of the plane view paints, in screen pixels. */
export interface DrawList {
  strokes: Stroke[];
  dots: Dot[];
  texts: TextItem[];
  pickables: Pickable[];
}

const KIND_ORDER: Record<TextKind, number> = { text: 0, point: 1, curve: 2, extra: 3 };

const labelOf = (o: SceneObject): string => o.label ?? o.id;
const insideRect = (r: Rect, p: Vec3): boolean => p[0] >= r.xmin && p[0] <= r.xmax && p[1] >= r.ymin && p[1] <= r.ymax;

/** The curve's visible pieces as screen polylines: clipped in closed form, then sampled to ≤ 0.25 px. */
export function curvePolylines(g: CurveGeom, cam: Camera2D, clip: Rect): Sampled[] {
  const toScreen = (t: number): Vec2 => {
    const p = evalCurve(g, t);
    return worldToScreen(cam, p[0], p[1]);
  };
  return clipCurve2D(g, clip).map(([a, b]) => sampleAdaptive(toScreen, a, b));
}

/** Where a curve's label goes: 30 % along the longest run of its points inside the pane. */
function curveAnchor(pieces: Sampled[], cam: Camera2D): Vec2 | null {
  let best: Vec2[] = [];
  for (const piece of pieces) {
    let run: Vec2[] = [];
    for (const p of piece.pts) {
      if (p[0] >= 0 && p[0] <= cam.width && p[1] >= 0 && p[1] <= cam.height) {
        run.push(p);
        if (run.length > best.length) best = run;
      } else {
        run = [];
      }
    }
  }
  return best.length ? best[Math.floor((best.length - 1) * 0.3)] : null;
}

/**
 * The draw list for one frame: strokes, dots and labels of every visible planar object,
 * plus what hover can pick. Pure (no PixiJS, no DOM), so the whole plane view is testable.
 */
export function buildDrawList(objects: Iterable<SceneObject>, cam: Camera2D, opts: DrawOptions): DrawList {
  const out: DrawList = { strokes: [], dots: [], texts: [], pickables: [] };
  const clip = expandRect(visibleRect(cam), MARGIN);
  const ws = opts.widthScale;
  const dash = (paths: Vec2[][]): Vec2[][] => paths.flatMap((p) => dashPolyline(p, DASH[0] * ws, DASH[1] * ws));
  const screen = (p: Vec3): Vec2 => worldToScreen(cam, p[0], p[1]);
  for (const o of objects) {
    const g = o.geom;
    if (g.type === "note" || !inPlaneZ0(g) || !opts.visible(o)) continue;
    const color = colorOf(o);
    const lit = o.id === opts.highlight ? HIGHLIGHT_PX : 0;
    const alpha = Math.min(Math.max(o.style?.opacity ?? 1, 0), 1);
    const width = (o.style?.width ?? LINE_PX) * ws + lit;
    const stroke = (paths: Vec2[][]) =>
      out.strokes.push({ id: o.id, extra: false, paths: o.style?.dashed ? dash(paths) : paths, color, width, alpha });
    const pick: Pickable = { id: o.id, polylines: [], dots: [] };
    out.pickables.push(pick);
    if (isCurve(g)) {
      const pieces = curvePolylines(g, cam, clip);
      stroke(pieces.map((s) => s.pts));
      pick.polylines = pieces.map((s) => ({ pts: s.pts, ts: s.ts }));
      const anchor = curveAnchor(pieces, cam);
      if (anchor) out.texts.push({ key: `c:${o.id}`, id: o.id, text: labelOf(o), at: anchor, color: opts.palette.text, kind: "curve" });
      if (o.extras) {
        const extras = curveExtras(g, o.extras);
        const faded = mixHex(color, opts.palette.bg, EXTRA_MIX);
        const lines = extras.lines.flatMap((l) => curvePolylines(l, cam, clip).map((s) => s.pts));
        if (lines.length) out.strokes.push({ id: o.id, extra: true, paths: dash(lines), color: faded, width: EXTRA_PX * ws, alpha });
        for (const x of extras.points) {
          if (!insideRect(clip, x.p)) continue;
          const at = screen(x.p);
          out.dots.push({ id: o.id, at, color: faded, radius: EXTRA_DOT_PX * ws, alpha, hollow: true });
          out.texts.push({ key: `x:${o.id}:${x.name}`, id: o.id, text: x.name, at, color: opts.palette.text, kind: "extra" });
        }
      }
    } else if (g.type === "polyline" || g.type === "arrow") {
      const lines = g.type === "polyline" ? [g.points] : arrowPolylines(g.at, g.vec);
      const paths = lines.map((l) => l.map(screen));
      stroke(paths);
      pick.polylines = paths.map((pts) => ({ pts, ts: null }));
    } else if (g.type === "point") {
      if (!insideRect(clip, g.p)) continue;
      const at = screen(g.p);
      out.dots.push({ id: o.id, at, color, radius: POINT_PX * ws + lit, alpha, hollow: false });
      pick.dots.push({ at, index: 0 });
      out.texts.push({ key: `p:${o.id}`, id: o.id, text: `${labelOf(o)} ${fmtPoint(g.p)}`, at, color: opts.palette.text, kind: "point" });
    } else if (g.type === "points") {
      const radius = (g.size ?? 3) * ws + lit;
      g.positions.forEach((p, index) => {
        if (!insideRect(clip, p)) return;
        const at = screen(p);
        out.dots.push({ id: o.id, at, color, radius, alpha, hollow: false });
        pick.dots.push({ at, index });
      });
      const first = g.positions[0];
      if (insideRect(clip, first)) {
        out.texts.push({ key: `p:${o.id}`, id: o.id, text: labelOf(o), at: screen(first), color: opts.palette.text, kind: "point" });
      }
    } else if (g.type === "text") {
      const textColor = o.style?.color ? color : opts.palette.text;
      out.texts.push({ key: `t:${o.id}`, id: o.id, text: g.text, at: screen(g.at), color: textColor, kind: "text" });
    }
  }
  const rank = (t: TextItem) => (t.id === opts.highlight ? -1 : KIND_ORDER[t.kind]);
  out.texts.sort((a, b) => rank(a) - rank(b));
  return out;
}

/** Tooltip lines for a hover hit: "label · type", the curve parameter, the coordinates, `meta.params`. */
export function describeHit(o: SceneObject, hit: Hit, cam: Camera2D): string[] {
  const g = o.geom;
  const lines = [`${labelOf(o)} · ${g.type}`];
  let at: Vec3;
  if (g.type === "point") {
    at = g.p;
  } else if (g.type === "points" && hit.index !== null) {
    at = g.positions[hit.index];
  } else if (isCurve(g) && hit.t !== null) {
    lines.push(`t = ${fmtNum(hit.t, 4)}`);
    at = evalCurve(g, hit.t);
  } else {
    const [x, y] = screenToWorld(cam, hit.at[0], hit.at[1]);
    at = [x, y, 0];
  }
  lines.push(fmtPoint(at));
  const params = fmtParams(o.meta?.params);
  if (params !== null) lines.push(`params ${params}`);
  return lines;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all PASS, including `render.test.ts` (11 tests); tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/view2d/render.ts frontend/test/render.test.ts
git commit -m "view2d: pure draw list (clipped, resampled curves; extras; point labels; pickables) and tooltip text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Task 8: The PixiJS plane view and DOM labels

This task replaces the Phase 1 `src/view2d.ts` with `view2d/view.ts`, the only plane-view module that touches PixiJS and the DOM. Every frame (at most one per animation frame, through `FrameScheduler`) it:

1. resizes the renderer to the host, then refits the camera if auto-fit is on and the user has not moved it, else keeps it;
2. draws the grid, the axes and the tick labels (pinned inside the pane when an axis is off screen);
3. builds the draw list (Task 7), paints its strokes and dots, places the labels (Task 6) and renders them as DOM elements;
4. calls `app.render()`. The application is created with `autoStart: false`, so nothing renders between frames.

Input listeners sit on the host element, so DOM labels on top do not swallow them. A pointerdown on a `.label` is ignored, so label text stays selectable. A drag of more than 3 px pans, the wheel zooms about the pointer, and hovering highlights the nearest object with a tooltip. Clicking a point copies its coordinates and reports through `notify`; clicking a curve does nothing (Rulings).

`main.ts` gets a minimal edit here: a `UiState`, the new constructor, and auto-fit routed through UiState for the 2D view. Task 10 rewrites `main.ts`.

**Files:**
- Create: `frontend/src/ui/labels.ts`, `frontend/src/view2d/view.ts`
- Delete: `frontend/src/view2d.ts`
- Modify: `frontend/src/main.ts`, `frontend/src/style.css`

**Interfaces:**
- Consumes:
  - from earlier tasks: `FrameScheduler` (Task 1); `UiState`, `UiEvent`, `PALETTES`, `Palette` (Task 2); Task 6's camera, `pickNearest`, `placeLabels`, `formatTick`, `gridSpacing`, `ticks`; Task 7's `buildDrawList`, `describeHit`, `DrawList`, `Stroke`
  - from Phase 1: `sceneBounds`, `inPlaneZ0`, `Store`, `StoreEvent`
- Produces:
  - `FONT_FAMILY`
  - `interface LabelItem { key; text; left; top; className; fontPx; color? }`
  - `class LabelLayer { constructor(host: HTMLElement); render(items: LabelItem[]): void }`
  - `class TextMeasure { width(text, fontPx, weight = 400): number }`
  - `class View2D`:
    - `constructor(store: Store, ui: UiState, host: HTMLElement, notify: (message: string) => void)`
    - `setActive(active: boolean): void`, `fitRequested(): void`
    - getters for debugging and e2e: `camera: Camera2D` (a copy) and `strokesOf(id): Stroke[]` (the last frame's strokes)
  - DOM classes: `.labels` (the overlay), `.label` (object labels, plus `.extra` or `.lit`), `.tick`, `.tooltip` (lines in `div`s, the first with class `head`).

This task has no unit tests: the logic it calls is tested in Tasks 6 and 7, and Task 12's e2e tests drive this class in a browser. Steps 6 and 7 below verify it by building and by looking at it.

- [ ] **Step 1: Create the label layer**

Create `frontend/src/ui/labels.ts`:

```ts
export const FONT_FAMILY = "system-ui, sans-serif";

/** One DOM label: `key` keeps the same element across frames. */
export interface LabelItem {
  key: string;
  text: string;
  left: number;
  top: number;
  className: string;
  fontPx: number;
  color?: string;
}

/**
 * Text drawn as DOM elements over a canvas (spec §5.2: crisp at any zoom, selectable).
 * Elements are reused by key, so a redraw only moves them.
 */
export class LabelLayer {
  readonly root: HTMLDivElement;
  private nodes = new Map<string, HTMLDivElement>();

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "labels";
    host.appendChild(this.root);
  }

  render(items: LabelItem[]): void {
    const keep = new Set<string>();
    for (const item of items) {
      keep.add(item.key);
      let node = this.nodes.get(item.key);
      if (!node) {
        node = document.createElement("div");
        this.nodes.set(item.key, node);
        this.root.appendChild(node);
      }
      if (node.textContent !== item.text) node.textContent = item.text;
      if (node.className !== item.className) node.className = item.className;
      node.style.fontSize = `${item.fontPx}px`;
      node.style.color = item.color ?? "";
      node.style.transform = `translate(${Math.round(item.left)}px, ${Math.round(item.top)}px)`;
    }
    for (const [key, node] of this.nodes) {
      if (keep.has(key)) continue;
      node.remove();
      this.nodes.delete(key);
    }
  }
}

/** Text widths for label placement, measured once per (text, size, weight) with a canvas. */
export class TextMeasure {
  private ctx: CanvasRenderingContext2D | null = document.createElement("canvas").getContext("2d");
  private cache = new Map<string, number>();

  width(text: string, fontPx: number, weight = 400): number {
    const key = `${weight}|${fontPx}|${text}`;
    let w = this.cache.get(key);
    if (w === undefined) {
      if (this.ctx) {
        this.ctx.font = `${weight} ${fontPx}px ${FONT_FAMILY}`;
        w = this.ctx.measureText(text).width;
      } else {
        w = 0.6 * fontPx * text.length;
      }
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(key, w);
    }
    return w;
  }
}
```

- [ ] **Step 2: Create the view**

Create `frontend/src/view2d/view.ts`:

```ts
import * as PIXI from "pixi.js";
import { sceneBounds } from "../geom/bounds";
import { inPlaneZ0 } from "../geom/planar";
import type { Vec2 } from "../geom/vec";
import { FrameScheduler } from "../frame";
import type { Store, StoreEvent } from "../store";
import { LabelItem, LabelLayer, TextMeasure } from "../ui/labels";
import type { UiEvent, UiState } from "../ui/state";
import { PALETTES, Palette } from "../ui/theme";
import { Camera2D, fitCamera, panBy, resizeCamera, visibleRect, worldToScreen, zoomAt } from "./camera";
import { Hit, pickNearest } from "./pick";
import { placeLabels } from "./placement";
import { formatTick, gridSpacing, ticks } from "./plane";
import { DrawList, Stroke, buildDrawList, describeHit } from "./render";

const LABEL_PX = 13;
const TICK_PX = 11;
/** Minor grid lines closer than this are left out. */
const MINOR_MIN_PX = 8;
const DRAG_PX = 3;
const WHEEL_ZOOM = 0.0015;
const EMPTY: DrawList = { strokes: [], dots: [], texts: [], pickables: [] };

/** The plane z = 0 (spec §5.2): PixiJS strokes and dots, DOM labels, pan, zoom, hover and click. */
export class View2D {
  private app = new PIXI.Application();
  private grid = new PIXI.Graphics();
  private shapes = new PIXI.Graphics();
  private ready = false;
  private active = false;
  private cam: Camera2D = fitCamera(null, 0, 0);
  private userMoved = false;
  private sceneChanged = true;
  private list: DrawList = EMPTY;
  private highlight: string | null = null;
  private pointer: Vec2 | null = null;
  private labels: LabelLayer;
  private tooltip: HTMLDivElement;
  private measure = new TextMeasure();
  private frame = new FrameScheduler(() => this.draw());

  constructor(
    private store: Store,
    private ui: UiState,
    private host: HTMLElement,
    private notify: (message: string) => void,
  ) {
    this.labels = new LabelLayer(host);
    this.tooltip = document.createElement("div");
    this.tooltip.className = "tooltip";
    this.tooltip.hidden = true;
    host.appendChild(this.tooltip);
    store.onChange((ev) => this.onStore(ev));
    ui.onChange((ev) => this.onUi(ev));
    new ResizeObserver(() => this.frame.request()).observe(host);
    this.listen();
    void this.app
      .init({
        autoStart: false,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        preference: "webgl",
        background: PALETTES[ui.theme].bg,
        width: Math.max(host.clientWidth, 1),
        height: Math.max(host.clientHeight, 1),
      })
      .then(() => {
        host.prepend(this.app.canvas);
        this.app.stage.addChild(this.grid, this.shapes);
        this.ready = true;
        this.frame.request();
      })
      .catch((err: unknown) => {
        console.error("geomcore-viewer: 2D view failed", err);
        notify(`2D view failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  /** Debug and e2e access: the current camera. */
  get camera(): Camera2D {
    return { ...this.cam };
  }

  /** Debug and e2e access: the strokes of one object in the last frame, in screen pixels. */
  strokesOf(id: string): Stroke[] {
    return this.list.strokes.filter((s) => s.id === id);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.frame.request();
  }

  /** The "fit" button or key, or auto-fit turned back on: frame the scene and follow it again. */
  fitRequested(): void {
    this.userMoved = false;
    this.sceneChanged = true;
    this.frame.request();
  }

  private onStore(ev: StoreEvent): void {
    if (ev.type === "meta") return;
    this.sceneChanged = true;
    this.frame.request();
  }

  private onUi(ev: UiEvent): void {
    if (ev === "autofit") {
      if (this.ui.autoFit) this.fitRequested();
    } else if (ev === "selection") {
      this.frameSelected();
    } else if (ev !== "collapse" && ev !== "view") {
      this.frame.request(); // theme, presentation mode, visibility
    }
  }

  /** Frame the selected object; a point (or an infinite curve, whose box is its origin) is only centred. */
  private frameSelected(): void {
    const o = this.ui.selected ? this.store.objects.get(this.ui.selected) : undefined;
    if (!o || !inPlaneZ0(o.geom) || o.geom.type === "note") return;
    const box = sceneBounds([o.geom]);
    if (!box) return;
    const flat = box.max[0] === box.min[0] && box.max[1] === box.min[1];
    this.cam = flat
      ? { ...this.cam, cx: box.min[0], cy: box.min[1] }
      : fitCamera(box, this.cam.width, this.cam.height);
    this.userMoved = true;
    this.frame.request();
  }

  private planarBounds() {
    const geoms = [];
    for (const o of this.store.objects.values()) if (o.geom.type !== "note" && inPlaneZ0(o.geom)) geoms.push(o.geom);
    return sceneBounds(geoms);
  }

  private get palette(): Palette {
    return PALETTES[this.ui.theme];
  }

  private get widthScale(): number {
    return this.ui.presenting ? 1.5 : 1;
  }

  private draw(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!this.ready || !this.active || width === 0 || height === 0) return;
    if (this.app.screen.width !== width || this.app.screen.height !== height) this.app.renderer.resize(width, height);
    const refit = this.ui.autoFit && !this.userMoved && (this.sceneChanged || this.cam.width !== width || this.cam.height !== height);
    this.cam = refit ? fitCamera(this.planarBounds(), width, height) : resizeCamera(this.cam, width, height);
    this.sceneChanged = false;
    const palette = this.palette;
    this.app.renderer.background.color = palette.bg;
    const tickLabels = this.drawGrid(palette);
    this.list = buildDrawList(this.store.objects.values(), this.cam, {
      visible: (o) => this.ui.isVisible(o),
      palette,
      widthScale: this.widthScale,
      highlight: this.highlight,
    });
    if (this.highlight && !this.list.pickables.some((p) => p.id === this.highlight)) this.hover(null);
    this.paint();
    this.labels.render([...tickLabels, ...this.placeTexts()]);
    this.app.render();
  }

  /** Minor and major grid lines, the axes, and the tick labels pinned inside the pane. */
  private drawGrid(palette: Palette): LabelItem[] {
    const g = this.grid.clear();
    const c = this.cam;
    const r = visibleRect(c);
    const { major, minor } = gridSpacing(c.scale);
    const vertical = (x: number, color: string, width: number) => {
      const sx = Math.round(worldToScreen(c, x, 0)[0]) + 0.5;
      g.moveTo(sx, 0).lineTo(sx, c.height).stroke({ width, color });
    };
    const horizontal = (y: number, color: string, width: number) => {
      const sy = Math.round(worldToScreen(c, 0, y)[1]) + 0.5;
      g.moveTo(0, sy).lineTo(c.width, sy).stroke({ width, color });
    };
    if (minor * c.scale >= MINOR_MIN_PX) {
      for (const x of ticks(r.xmin, r.xmax, minor)) vertical(x, palette.gridMinor, 1);
      for (const y of ticks(r.ymin, r.ymax, minor)) horizontal(y, palette.gridMinor, 1);
    }
    const xs = ticks(r.xmin, r.xmax, major);
    const ys = ticks(r.ymin, r.ymax, major);
    for (const x of xs) vertical(x, palette.gridMajor, 1);
    for (const y of ys) horizontal(y, palette.gridMajor, 1);
    const [ox, oy] = worldToScreen(c, 0, 0);
    if (ox >= 0 && ox <= c.width) vertical(0, palette.axis, 1.5);
    if (oy >= 0 && oy <= c.height) horizontal(0, palette.axis, 1.5);

    const px = TICK_PX * this.widthScale;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const labelTop = clamp(oy + 4, 2, c.height - px * 1.4 - 2); // the x labels follow the x axis, kept on screen
    const items: LabelItem[] = [];
    for (const x of xs) {
      const text = formatTick(x, major);
      if (text === "0") continue; // the origin is labelled once, on the y axis
      const left = worldToScreen(c, x, 0)[0] + 3;
      items.push({ key: `tx:${text}`, text, left, top: labelTop, className: "tick", fontPx: px, color: palette.axis });
    }
    for (const y of ys) {
      const text = formatTick(y, major);
      const w = this.measure.width(text, px);
      const left = clamp(ox + 4, 2, c.width - w - 2);
      const top = worldToScreen(c, 0, y)[1] - px * 1.4;
      items.push({ key: `ty:${text}`, text, left, top, className: "tick", fontPx: px, color: palette.axis });
    }
    return items;
  }

  private paint(): void {
    const g = this.shapes.clear();
    const bg = this.palette.bg;
    for (const s of this.list.strokes) {
      let any = false;
      for (const path of s.paths) {
        if (path.length < 2) continue;
        g.moveTo(path[0][0], path[0][1]);
        for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
        any = true;
      }
      if (any) g.stroke({ width: s.width, color: s.color, alpha: s.alpha, cap: "round", join: "round" });
    }
    for (const d of this.list.dots) {
      g.circle(d.at[0], d.at[1], d.radius);
      if (d.hollow) g.fill({ color: bg }).stroke({ width: 1.5 * this.widthScale, color: d.color, alpha: d.alpha });
      else g.fill({ color: d.color, alpha: d.alpha });
    }
  }

  /** Object labels where they do not overlap (spec §5.2), as DOM items. */
  private placeTexts(): LabelItem[] {
    const px = LABEL_PX * this.widthScale;
    const h = Math.ceil(px * 1.35);
    const byKey = new Map(this.list.texts.map((t) => [t.key, t]));
    const requests = this.list.texts.map((t) => ({
      key: t.key,
      ax: t.at[0],
      ay: t.at[1],
      w: Math.ceil(this.measure.width(t.text, px, 600)) + 2,
      h,
      fixed: t.kind === "text",
    }));
    return placeLabels(requests, this.cam.width, this.cam.height).map((p) => {
      const t = byKey.get(p.key)!;
      const className = t.kind === "extra" ? "label extra" : t.id === this.highlight ? "label lit" : "label";
      return { key: p.key, text: t.text, left: p.left, top: p.top, className, fontPx: px, color: t.color };
    });
  }

  private hit(x: number, y: number): Hit | null {
    return pickNearest(this.list.pickables, x, y);
  }

  /** Highlight the hovered object and show its tooltip (null hides both). */
  private hover(hit: Hit | null): void {
    const id = hit?.id ?? null;
    if (id !== this.highlight) {
      this.highlight = id;
      this.frame.request();
    }
    const o = hit ? this.store.objects.get(hit.id) : undefined;
    if (!hit || !o || !this.pointer) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.replaceChildren(
      ...describeHit(o, hit, this.cam).map((line, i) => {
        const div = document.createElement("div");
        if (i === 0) div.className = "head";
        div.textContent = line;
        return div;
      }),
    );
    this.tooltip.hidden = false;
    const [px, py] = this.pointer;
    const left = px + 14 + this.tooltip.offsetWidth > this.cam.width ? px - 14 - this.tooltip.offsetWidth : px + 14;
    this.tooltip.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, py + 14)}px)`;
  }

  /** Clicking a point copies its coordinates; clicking a curve does nothing (hover already shows it). */
  private click(x: number, y: number): void {
    const hit = this.hit(x, y);
    const o = hit ? this.store.objects.get(hit.id) : undefined;
    if (!hit || !o) return;
    const g = o.geom;
    const p = g.type === "point" ? g.p : g.type === "points" && hit.index !== null ? g.positions[hit.index] : null;
    if (!p) return;
    const text = `(${p[0]}, ${p[1]})`;
    const label = o.label ?? o.id;
    if (!navigator.clipboard) {
      this.notify(`${label} ${text}: copying needs https or localhost`);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => this.notify(`copied ${label} ${text}`),
      () => this.notify(`could not copy ${label} ${text}`),
    );
  }

  private listen(): void {
    const host = this.host;
    host.style.touchAction = "none";
    let down: { x: number; y: number; id: number; dragging: boolean } | null = null;
    const local = (ev: PointerEvent | WheelEvent): Vec2 => {
      const rect = host.getBoundingClientRect();
      return [ev.clientX - rect.left, ev.clientY - rect.top];
    };
    host.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || (ev.target as Element).closest?.(".label")) return; // labels stay selectable
      const [x, y] = local(ev);
      down = { x, y, id: ev.pointerId, dragging: false };
      host.setPointerCapture(ev.pointerId);
    });
    host.addEventListener("pointermove", (ev) => {
      const [x, y] = local(ev);
      this.pointer = [x, y];
      if (!down) {
        this.hover(this.hit(x, y));
        return;
      }
      if (!down.dragging && Math.hypot(x - down.x, y - down.y) < DRAG_PX) return;
      if (!down.dragging) this.hover(null);
      this.cam = panBy(this.cam, x - down.x, y - down.y);
      down.x = x;
      down.y = y;
      down.dragging = true;
      this.userMoved = true;
      this.frame.request();
    });
    const release = (ev: PointerEvent, click: boolean) => {
      if (!down || ev.pointerId !== down.id) return;
      if (click && !down.dragging) this.click(...local(ev));
      down = null;
      if (host.hasPointerCapture(ev.pointerId)) host.releasePointerCapture(ev.pointerId);
    };
    host.addEventListener("pointerup", (ev) => release(ev, true));
    host.addEventListener("pointercancel", (ev) => release(ev, false));
    host.addEventListener("pointerleave", () => {
      this.pointer = null;
      if (!down) this.hover(null);
    });
    host.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const [x, y] = local(ev);
        const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY; // lines → pixels (Firefox)
        this.cam = zoomAt(this.cam, x, y, Math.exp(-delta * WHEEL_ZOOM));
        this.userMoved = true;
        this.frame.request();
      },
      { passive: false },
    );
  }
}
```

- [ ] **Step 3: Delete the Phase 1 view**

Run: `git rm frontend/src/view2d.ts`

- [ ] **Step 4: Wire it in `main.ts`**

In `frontend/src/main.ts`, replace the import

```ts
import { View2D } from "./view2d";
```

with

```ts
import { UiState } from "./ui/state";
import { View2D } from "./view2d/view";
```

Replace

```ts
const store = new Store();
const view3d = new View3D(store, byId<HTMLCanvasElement>("canvas3d"));
const view2d = new View2D(store, byId("view2d"));
```

with

```ts
const store = new Store();
const ui = new UiState();
const view3d = new View3D(store, byId<HTMLCanvasElement>("canvas3d"));
const view2d = new View2D(store, ui, byId("view2d"), (message) => store.setStatus(message));
view2d.setActive(true);
```

Replace the `autofit` listener

```ts
byId<HTMLInputElement>("autofit").addEventListener("change", (e) => {
  if ((e.target as HTMLInputElement).checked) {
    view3d.fitRequested();
    view2d.fitRequested();
  }
});
```

with

```ts
byId<HTMLInputElement>("autofit").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  ui.setAutoFit(on); // the 2D view follows UiState; the 3D view reads the checkbox until Task 9
  if (on) view3d.fitRequested();
});
```

- [ ] **Step 5: Style the labels and the tooltip**

Append to `frontend/src/style.css` (Task 10 replaces the whole file with themed colours):

```css
#view2d { overflow: hidden; }
.labels { position: absolute; inset: 0; pointer-events: none; }
.labels > div { position: absolute; left: 0; top: 0; white-space: nowrap; line-height: 1.35; }
.labels .label { font-weight: 600; pointer-events: auto; user-select: text; cursor: text; text-shadow: 0 0 3px #f7f8fa, 0 0 2px #f7f8fa; }
.labels .label.extra { font-weight: 500; }
.labels .label.lit { text-decoration: underline; }
.labels .tick { font-variant-numeric: tabular-nums; }
.tooltip { position: absolute; left: 0; top: 0; pointer-events: none; padding: 0.3rem 0.5rem; border-radius: 4px; background: rgba(17, 24, 39, 0.92); color: #f9fafb; font-size: 12px; line-height: 1.4; white-space: nowrap; }
.tooltip .head { font-weight: 600; }
```

- [ ] **Step 6: Run the tests and the build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all tests PASS; the build ends with "✓ built" (Vite's chunk-size warning about Babylon is expected).

- [ ] **Step 7: Look at it**

Run: `PYTHONPATH=python python3 -m geomcore_viewer serve --dir frontend/dist --port 8799 --no-browser` (port 8799, never 8765), open `http://127.0.0.1:8799/?scene=sample-scene.json`, and check:
- in the right-hand pane, the ellipse, circle, hyperbola branch and line run edge to edge;
- the grid has major lines 60–150 px apart, with tick labels;
- the dashed asymptotes of H and the hollow foci `F₁`, `F₂` of E are visible;
- the point labels read like `P₁ (2.994, -0.123)` and do not overlap;
- hovering a point shows a tooltip, and clicking it puts its full-precision `(x, y)` on the clipboard and in the status line;
- wheel and drag zoom and pan, and the line widths stay the same.

Stop the server with Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/ui/labels.ts frontend/src/view2d/view.ts frontend/src/main.ts frontend/src/style.css
git commit -m "view2d: PixiJS plane view (exact clipped curves, grid, DOM labels, hover tooltip, click-to-copy) replaces the Phase 1 pane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: View3D on frames and UiState

The 3D view gets the same treatment as the plane view. Store events fold into `Changes` and are applied once per frame, and nothing is applied while the view is hidden. The view also follows UiState:
- visibility enables or disables meshes;
- the theme sets the clear colour;
- a selection frames the object (one without extent is only re-targeted);
- auto-fit comes from UiState instead of a DOM checkbox.

Babylon's render loop runs only while the view is active. Resizes come from a `ResizeObserver` on the canvas. Keyboard camera input (the arrow keys) now counts as the user moving the camera, as dragging and the wheel already did (backlog).

**Files:**
- Modify: `frontend/src/view3d.ts` (rewritten in full below), `frontend/src/main.ts`

**Interfaces:**
- Consumes: `Changes`, `FrameScheduler` (Task 1); `UiState`, `UiEvent`, `PALETTES` (Task 2).
- Produces:
  - `class View3D`:
    - `constructor(store: Store, ui: UiState, canvas: HTMLCanvasElement)`
    - `setActive(active: boolean): void`, `fitRequested(): void`
    - getter for debugging and e2e: `cameraState: { alpha; beta; radius; target: Vec3 }`

- [ ] **Step 1: Rewrite `view3d.ts`**

Replace the whole of `frontend/src/view3d.ts` with:

```ts
import * as BABYLON from "@babylonjs/core";
import { cameraScale } from "./camera";
import { Changes, FrameScheduler } from "./frame";
import { halfSize, sameBox, sceneBounds, viewBox } from "./geom/bounds";
import { arrowPolylines, tessellateCurve, tessellateSurface } from "./geom/tessellate";
import { isCurve, isSurface } from "./geom/types";
import type { Box, Vec3 } from "./geom/vec";
import type { SceneObject } from "./protocol";
import type { Store } from "./store";
import { colorOf } from "./ui/colors";
import type { UiEvent, UiState } from "./ui/state";
import { PALETTES } from "./ui/theme";

const v3 = (p: Vec3) => new BABYLON.Vector3(p[0], p[1], p[2]);

/** Babylon 3D pane, z up and right-handed like geomcore. Phase 2: coalesced updates, UiState, render loop only while shown. */
export class View3D {
  readonly scene: BABYLON.Scene;
  readonly camera: BABYLON.ArcRotateCamera;
  private engine: BABYLON.Engine;
  private meshes = new Map<string, BABYLON.AbstractMesh[]>();
  private box: Box = viewBox([]);
  private userMoved = false;
  private active = false;
  private changes = new Changes();
  private frame = new FrameScheduler(() => this.flush());

  constructor(
    private store: Store,
    private ui: UiState,
    canvas: HTMLCanvasElement,
  ) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.camera = new BABYLON.ArcRotateCamera("cam", Math.PI / 2, Math.PI / 3, 10, BABYLON.Vector3.Zero(), this.scene);
    this.camera.upVector = new BABYLON.Vector3(0, 0, 1);
    this.camera.attachControl(canvas, true);
    // Once the user has orbited, panned or zoomed, auto-fit leaves the camera alone until "fit".
    canvas.addEventListener("pointermove", (ev) => {
      if (ev.buttons) this.userMoved = true;
    });
    canvas.addEventListener("wheel", () => (this.userMoved = true), { passive: true });
    canvas.addEventListener("keydown", (ev) => {
      if (ev.key.startsWith("Arrow")) this.userMoved = true; // the camera's keyboard input
    });
    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0.3, 0.5, 1), this.scene);
    this.applyTheme();
    store.onChange((ev) => {
      if (ev.type === "meta") return;
      this.changes.note(ev);
      this.frame.request();
    });
    ui.onChange((ev) => this.uiChanged(ev));
    new ResizeObserver(() => {
      if (!this.active) return;
      this.engine.resize();
      if (this.ui.autoFit && !this.userMoved) this.fit();
    }).observe(canvas);
    this.rebuild();
    this.fit();
  }

  /** Debug and e2e access: the camera's position. */
  get cameraState(): { alpha: number; beta: number; radius: number; target: Vec3 } {
    const t = this.camera.target;
    return { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, target: [t.x, t.y, t.z] };
  }

  /** Render (and apply pending changes) only while the 3D view is the one shown. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.engine.resize();
      this.engine.runRenderLoop(() => this.scene.render());
      this.frame.request();
    } else {
      this.engine.stopRenderLoop();
    }
  }

  private geoms() {
    return [...this.store.objects.values()].map((o) => o.geom);
  }

  /** Store changes folded since the last frame. While hidden they keep accumulating. */
  private flush(): void {
    if (!this.active) return;
    const { reset, ids } = this.changes.take();
    const box = viewBox(this.geoms());
    // Infinite curves and default surface windows depend on the box: rebuild when it moves.
    if (reset || !sameBox(box, this.box)) {
      this.rebuild();
    } else {
      for (const id of ids) {
        const o = this.store.objects.get(id);
        if (o) this.show(o);
        else this.drop(id);
      }
    }
    if (this.ui.autoFit && !this.userMoved) this.fit();
    else this.applyScale();
  }

  private uiChanged(ev: UiEvent): void {
    if (ev === "theme") this.applyTheme();
    else if (ev === "visibility") {
      for (const [id, meshes] of this.meshes) {
        const o = this.store.objects.get(id);
        const visible = o ? this.ui.isVisible(o) : false;
        meshes.forEach((m) => m.setEnabled(visible));
      }
    } else if (ev === "selection") this.frameSelected();
    else if (ev === "autofit" && this.ui.autoFit) this.fitRequested();
  }

  private applyTheme(): void {
    this.scene.clearColor = BABYLON.Color4.FromHexString(`${PALETTES[this.ui.theme].bg}ff`);
  }

  /** The "fit" button or key (or turning auto-fit on): frame the scene and follow it again. */
  fitRequested(): void {
    this.userMoved = false;
    this.fit();
  }

  /** Frame the selected object; one without extent (a point, an infinite curve's origin) is only re-targeted. */
  private frameSelected(): void {
    const o = this.ui.selected ? this.store.objects.get(this.ui.selected) : undefined;
    const b = o ? sceneBounds([o.geom]) : null;
    if (!b) return;
    this.camera.target.copyFrom(v3(b.min).add(v3(b.max)).scale(0.5));
    if (v3(b.max).subtract(v3(b.min)).length() > 0) this.camera.radius = this.fitRadius(b);
    this.userMoved = true;
  }

  /** Distance at which the camera frames the scene (the field of view is vertical, so a narrow pane backs off). */
  private fitRadius(b: Box): number {
    const aspect = this.engine.getAspectRatio(this.camera);
    return (Math.max(v3(b.max).subtract(v3(b.min)).length() / 2, 1e-6) * 3) / Math.min(1, aspect || 1);
  }

  /** Clip planes and zoom feel follow the scene's size, also when the camera is not moved. */
  private applyScale(): void {
    const b = sceneBounds(this.geoms());
    if (b) Object.assign(this.camera, cameraScale(this.fitRadius(b)));
  }

  private fit(): void {
    const b = sceneBounds(this.geoms());
    if (!b) return;
    this.camera.target.copyFrom(v3(b.min).add(v3(b.max)).scale(0.5));
    this.camera.radius = this.fitRadius(b);
    this.applyScale();
  }

  private rebuild(): void {
    this.box = viewBox(this.geoms());
    for (const id of [...this.meshes.keys()]) this.drop(id);
    for (const o of this.store.objects.values()) this.show(o);
  }

  private drop(id: string): void {
    this.meshes.get(id)?.forEach((m) => m.dispose(false, true));
    this.meshes.delete(id);
  }

  private show(o: SceneObject): void {
    this.drop(o.id);
    const made = this.build(o);
    if (!made.length) return;
    const visible = this.ui.isVisible(o);
    made.forEach((m) => m.setEnabled(visible));
    this.meshes.set(o.id, made);
  }

  private build(o: SceneObject): BABYLON.AbstractMesh[] {
    const g = o.geom;
    const color = BABYLON.Color3.FromHexString(colorOf(o));
    if (isCurve(g)) return this.lines(o.id, [tessellateCurve(g, this.box)], color);
    if (g.type === "polyline") return this.lines(o.id, [g.points], color);
    if (g.type === "arrow") return this.lines(o.id, arrowPolylines(g.at, g.vec), color);
    if (isSurface(g)) {
      const mesh = tessellateSurface(g, halfSize(this.box));
      return [this.surface(o, mesh.positions, mesh.indices, color)];
    }
    if (g.type === "mesh") return [this.surface(o, g.vertices.flat(), g.indices, color)];
    if (g.type === "point") return [this.marker(o.id, g.p, color)];
    if (g.type === "points") return g.positions.map((p, i) => this.marker(`${o.id}#${i}`, p, color, 0.5));
    return []; // text and notes: labels in 3D come with Phase 3
  }

  private lines(id: string, polylines: Vec3[][], color: BABYLON.Color3): BABYLON.AbstractMesh[] {
    const drawable = polylines.filter((l) => l.length >= 2);
    if (!drawable.length) return [];
    const mesh = BABYLON.MeshBuilder.CreateLineSystem(`o-${id}`, { lines: drawable.map((l) => l.map(v3)) }, this.scene);
    mesh.color = color;
    return [mesh];
  }

  private surface(o: SceneObject, positions: number[], indices: number[], color: BABYLON.Color3): BABYLON.Mesh {
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, data.normals);
    const mesh = new BABYLON.Mesh(`o-${o.id}`, this.scene);
    data.applyToMesh(mesh);
    const mat = new BABYLON.StandardMaterial(`m-${o.id}`, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
    mat.alpha = Math.min(Math.max(o.style?.opacity ?? 1, 0), 1);
    mesh.material = mat;
    return mesh;
  }

  private marker(id: string, p: Vec3, color: BABYLON.Color3, scale = 1): BABYLON.Mesh {
    const diameter = 0.02 * halfSize(this.box) * scale;
    const sphere = BABYLON.MeshBuilder.CreateSphere(`o-${id}`, { diameter, segments: 8 }, this.scene);
    sphere.position = v3(p);
    const mat = new BABYLON.StandardMaterial(`m-${id}`, this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.6);
    sphere.material = mat;
    return sphere;
  }
}
```

- [ ] **Step 2: Update `main.ts`**

In `frontend/src/main.ts`, replace

```ts
const view3d = new View3D(store, byId<HTMLCanvasElement>("canvas3d"));
```

with

```ts
const view3d = new View3D(store, ui, byId<HTMLCanvasElement>("canvas3d"));
view3d.setActive(true);
```

and replace the `autofit` listener with

```ts
byId<HTMLInputElement>("autofit").addEventListener("change", (e) => {
  ui.setAutoFit((e.target as HTMLInputElement).checked); // turning it on refits both views
});
```

- [ ] **Step 3: Run the tests and the build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all tests PASS; the build ends with "✓ built".

- [ ] **Step 4: Look at it**

Serve as in Task 8 Step 7 (port 8799) and open `http://127.0.0.1:8799/?scene=sample-scene.json`. The 3D pane shows the conics and points as before. Orbit with the mouse, then press the arrow keys: the camera turns. Now run, in the browser console, `document.getElementById("autofit").click()` twice (off, then on): the camera refits.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/view3d.ts frontend/src/main.ts
git commit -m "3d: apply store changes once per frame and only while shown; follow UiState (visibility, theme, selection, auto-fit); arrow keys count as moving the camera

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Page shell: one stage, header, panel, keys, presentation mode, theme

Spec §5.1. The two side-by-side panes become one stage that shows the active view: the user's pick (header switch or keys `2`/`3`), else the scene's `view`, else 2D for a planar scene and 3D otherwise. `view="auto"` was not honoured in Phase 1 (backlog). The header shows the title, the status, "run N" and the object count, plus the controls. The panel groups objects by `group`, with visibility checkboxes for objects and groups; clicking a row selects and frames the object. Everything re-renders at most once per frame.

Keys come from `keyAction`. It returns null for presses with Ctrl, ⌘ or Alt and for keys typed into a text field, but not for a focused checkbox (Review Focus 3).

**Files:**
- Create: `frontend/src/ui/header.ts`, `frontend/src/ui/keys.ts`
- Modify: `frontend/src/ui/panel.ts`, `frontend/src/main.ts`, `frontend/index.html`, `frontend/src/style.css` (each rewritten in full below)
- Test: `frontend/test/header.test.ts`, `frontend/test/keys.test.ts`, `frontend/test/panel.test.ts`

**Interfaces:**
- Consumes:
  - from earlier tasks: `FrameScheduler` (Task 1); `UiState`, `applyTheme` (Task 2); `fmtPoint` (Task 6); `View2D` (Task 8); `View3D` (Task 9)
  - from Phase 1: `colorOf`, `Store`
- Produces:
  - `type KeyAction = "fit" | "present" | "theme" | "view2d" | "view3d" | "escape"`
  - `keyAction(ev: { key; ctrlKey; metaKey; altKey; target }): KeyAction | null`
  - `mountKeys(handlers: Record<KeyAction, () => void>, target: EventTarget = window): void`
  - `class RunCounter { observe(run: string | null): number }`
  - `plural(n, word)`, `objectCount(objects)`
  - `interface HeaderModel { title; run; count }`, `headerModel(store, runs): HeaderModel`
  - `statusState(status): "live" | "error" | ""`
  - `interface HeaderElements { title; status; run; count }`, `renderHeader(store, runs, els)`
  - `interface ObjectRow`, `interface NoteRow`, `interface GroupModel`, `interface PanelModel`
  - `panelModel(store: Store, ui: UiState): PanelModel`, `mountPanel(store: Store, ui: UiState, list: HTMLElement): void`
  - DOM ids: `#chrome`, `#title`, `#status` (`data-state`), `#run`, `#count`, `#view-2d`, `#view-3d`, `#autofit`, `#fit`, `#theme`, `#present`, `#clear`, `#stage` (`data-view`), `#canvas3d`, `#view2d`, `#toast`, `#panel`, `#object-list`
  - panel DOM: `li.group[data-group]` holding `.group-head` (`.twisty`, a checkbox, `.name`, `.detail`) and a `ul`; `li.object[data-id]` (plus `.selected`, `.hidden`); `li.note`; `li.problem`
  - `window.__gv = { store, ui, view2d, view3d }`, for debugging and e2e

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { keyAction } from "../src/ui/keys";

const press = (key: string, extra: Partial<Parameters<typeof keyAction>[0]> = {}) =>
  keyAction({ key, ctrlKey: false, metaKey: false, altKey: false, target: null, ...extra });
const target = (tagName: string, more: Record<string, unknown> = {}) => ({ tagName, ...more }) as unknown as EventTarget;

describe("keyAction", () => {
  it("maps the spec keys, either case", () => {
    expect(press("f")).toBe("fit");
    expect(press("F")).toBe("fit");
    expect(press("p")).toBe("present");
    expect(press("t")).toBe("theme");
    expect(press("2")).toBe("view2d");
    expect(press("3")).toBe("view3d");
    expect(press("Escape")).toBe("escape");
  });

  it("leaves other keys alone, including U until the (u,v) pane exists", () => {
    expect(press("u")).toBeNull();
    expect(press("a")).toBeNull();
    expect(press(" ")).toBeNull();
  });

  it("leaves Ctrl, ⌘ and Alt combinations to the browser", () => {
    expect(press("f", { ctrlKey: true })).toBeNull(); // find
    expect(press("p", { metaKey: true })).toBeNull(); // print
    expect(press("t", { altKey: true })).toBeNull();
  });

  it("ignores keys typed into text fields", () => {
    expect(press("f", { target: target("INPUT", { type: "text" }) })).toBeNull();
    expect(press("f", { target: target("INPUT", { type: "search" }) })).toBeNull();
    expect(press("f", { target: target("TEXTAREA") })).toBeNull();
    expect(press("2", { target: target("SELECT") })).toBeNull();
    expect(press("t", { target: target("DIV", { isContentEditable: true }) })).toBeNull();
  });

  it("still works with a panel checkbox or a button focused", () => {
    expect(press("f", { target: target("INPUT", { type: "checkbox" }) })).toBe("fit");
    expect(press("p", { target: target("BUTTON") })).toBe("present");
  });
});
```

Create `frontend/test/header.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Store } from "../src/store";
import { RunCounter, headerModel, objectCount, plural, statusState } from "../src/ui/header";
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
});
```

Create `frontend/test/panel.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/keys.test.ts test/header.test.ts test/panel.test.ts`
Expected: FAIL. `keys` and `header` fail to resolve; `panel.test.ts` fails on the missing export `panelModel`.

- [ ] **Step 3: Implement the keys**

Create `frontend/src/ui/keys.ts`:

```ts
export type KeyAction = "fit" | "present" | "theme" | "view2d" | "view3d" | "escape";

/** Spec §5.1 keys. `U` ((u,v) pane) is Phase 3. */
const KEYS: ReadonlyMap<string, KeyAction> = new Map([
  ["f", "fit"],
  ["p", "present"],
  ["t", "theme"],
  ["2", "view2d"],
  ["3", "view3d"],
  ["escape", "escape"],
]);

/** Input types that take typed text; checkboxes, buttons and the like do not. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]);

interface KeySource {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !NON_TEXT_INPUTS.has((el.type ?? "text").toLowerCase());
}

/**
 * The viewer action for a key press, or null. Presses with Ctrl, ⌘ or Alt belong to the
 * browser (Ctrl+F find, ⌘P print), and keys typed into a text field belong to the field.
 */
export function keyAction(ev: KeySource): KeyAction | null {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || isTyping(ev.target)) return null;
  return KEYS.get(ev.key.toLowerCase()) ?? null;
}

/** Route key presses on `target` to the handlers; held-down keys do not repeat the action. */
export function mountKeys(handlers: Record<KeyAction, () => void>, target: EventTarget = window): void {
  target.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (ev.repeat) return;
    const action = keyAction(ev);
    if (!action) return;
    ev.preventDefault();
    handlers[action]();
  });
}
```

- [ ] **Step 4: Implement the header**

Create `frontend/src/ui/header.ts`:

```ts
import type { SceneObject } from "../protocol";
import type { Store } from "../store";

/** Numbers the runs seen since the page opened: the header shows "run 3" rather than a run id. */
export class RunCounter {
  private numbers = new Map<string, number>();

  /** The number of `run` (1 for the first one seen), 0 when there is no run. */
  observe(run: string | null): number {
    if (run === null) return 0;
    let n = this.numbers.get(run);
    if (n === undefined) {
      n = this.numbers.size + 1;
      this.numbers.set(run, n);
    }
    return n;
  }
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Objects as the header counts them: notes are messages, not objects. */
export function objectCount(objects: Iterable<SceneObject>): number {
  let n = 0;
  for (const o of objects) if (o.geom.type !== "note") n++;
  return n;
}

export interface HeaderModel {
  title: string;
  run: string;
  count: string;
}

export function headerModel(store: Store, runs: RunCounter): HeaderModel {
  const n = runs.observe(store.run);
  const rejected = store.problems.size ? ` · ${store.problems.size} rejected` : "";
  return {
    title: store.title || "geomcore-viewer",
    run: n ? `run ${n}` : "",
    count: plural(objectCount(store.objects.values()), "object") + rejected,
  };
}

export interface HeaderElements {
  title: HTMLElement;
  status: HTMLElement;
  run: HTMLElement;
  count: HTMLElement;
}

/** Status lines that report a failure (store.ts, view2d/view.ts, main.ts). */
const FAILURE = /fail|error|could not|unsupported|unavailable/i;

export const statusState = (status: string): "live" | "error" | "" =>
  status === "live" ? "live" : FAILURE.test(status) ? "error" : "";

export function renderHeader(store: Store, runs: RunCounter, els: HeaderElements): void {
  const m = headerModel(store, runs);
  els.title.textContent = m.title;
  document.title = store.title ? `${store.title} · geomcore-viewer` : "geomcore-viewer";
  els.status.textContent = store.status;
  els.status.dataset.state = statusState(store.status);
  els.run.textContent = m.run;
  els.count.textContent = m.count;
}
```

- [ ] **Step 5: Rewrite the panel**

Replace the whole of `frontend/src/ui/panel.ts` with:

```ts
import { FrameScheduler } from "../frame";
import type { Problem, SceneObject } from "../protocol";
import type { Store } from "../store";
import { colorOf } from "./colors";
import { fmtPoint } from "./format";
import type { UiState } from "./state";

export interface ObjectRow {
  kind: "object";
  id: string;
  label: string;
  /** Coordinates for a point, "N points", else the geometry type. */
  detail: string;
  color: string;
  /** The object's own checkbox. */
  visible: boolean;
  /** Drawn: its own checkbox and its group's are both on. */
  shown: boolean;
  selected: boolean;
}

export interface NoteRow {
  kind: "note";
  id: string;
  text: string;
  warn: boolean;
}

export interface GroupModel {
  /** null for the objects without a group, listed first. */
  name: string | null;
  visible: boolean;
  collapsed: boolean;
  rows: (ObjectRow | NoteRow)[];
}

export interface PanelModel {
  groups: GroupModel[];
  problems: Problem[];
}

function detailOf(o: SceneObject): string {
  const g = o.geom;
  if (g.type === "point") return fmtPoint(g.p);
  if (g.type === "points") return `${g.positions.length} points`;
  return g.type;
}

/** What the panel shows, from the scene and the UI state (pure, so it is unit-tested). */
export function panelModel(store: Store, ui: UiState): PanelModel {
  const groups = new Map<string | null, GroupModel>([[null, { name: null, visible: true, collapsed: false, rows: [] }]]);
  for (const o of store.objects.values()) {
    const name = o.group ?? null;
    let group = groups.get(name);
    if (!group) {
      group = { name, visible: !ui.hiddenGroups.has(name!), collapsed: ui.collapsedGroups.has(name!), rows: [] };
      groups.set(name, group);
    }
    const g = o.geom;
    if (g.type === "note") {
      group.rows.push({ kind: "note", id: o.id, text: g.text, warn: g.level === "warn" });
      continue;
    }
    group.rows.push({
      kind: "object",
      id: o.id,
      label: o.label ?? o.id,
      detail: detailOf(o),
      color: colorOf(o),
      visible: !ui.hiddenIds.has(o.id),
      shown: ui.isVisible(o),
      selected: ui.selected === o.id,
    });
  }
  return { groups: [...groups.values()].filter((g) => g.rows.length > 0), problems: [...store.problems.values()] };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function checkbox(checked: boolean, label: string, onChange: (checked: boolean) => void): HTMLInputElement {
  const box = el("input");
  box.type = "checkbox";
  box.checked = checked;
  box.setAttribute("aria-label", label);
  box.addEventListener("click", (ev) => ev.stopPropagation()); // toggling visibility is not selecting
  box.addEventListener("change", () => onChange(box.checked));
  return box;
}

/**
 * The side panel (spec §5.1): objects grouped by `group`, each with a visibility checkbox,
 * colour swatch, label and detail; click a row to select (and frame) it, again to deselect.
 * Notes and rejected objects are listed too. Rebuilt at most once per frame.
 */
export function mountPanel(store: Store, ui: UiState, list: HTMLElement): void {
  const objectRow = (row: ObjectRow): HTMLLIElement => {
    const li = el("li", `object${row.selected ? " selected" : ""}${row.shown ? "" : " hidden"}`);
    li.dataset.id = row.id;
    const swatch = el("span", "swatch");
    swatch.style.background = row.color;
    li.append(
      checkbox(row.visible, `show ${row.label}`, (on) => ui.setObjectVisible(row.id, on)),
      swatch,
      el("span", "name", row.label),
      el("span", "detail", row.detail),
    );
    li.addEventListener("click", () => ui.select(ui.selected === row.id ? null : row.id));
    return li;
  };
  const noteRow = (row: NoteRow): HTMLLIElement => el("li", `note ${row.warn ? "warn" : "info"}`, `${row.warn ? "⚠" : "ⓘ"} ${row.text}`);
  const rowsOf = (group: GroupModel) => group.rows.map((r) => (r.kind === "object" ? objectRow(r) : noteRow(r)));
  const render = () => {
    const model = panelModel(store, ui);
    const items: HTMLLIElement[] = [];
    for (const group of model.groups) {
      if (group.name === null) {
        items.push(...rowsOf(group));
        continue;
      }
      const name = group.name;
      const li = el("li", `group${group.collapsed ? " collapsed" : ""}`);
      li.dataset.group = name;
      const head = el("div", "group-head");
      const twisty = el("button", "twisty", group.collapsed ? "▸" : "▾");
      twisty.setAttribute("aria-expanded", String(!group.collapsed));
      twisty.setAttribute("aria-label", `${group.collapsed ? "expand" : "collapse"} ${name}`);
      twisty.addEventListener("click", () => ui.setCollapsed(name, !group.collapsed));
      head.append(
        twisty,
        checkbox(group.visible, `show group ${name}`, (on) => ui.setGroupVisible(name, on)),
        el("span", "name", name),
        el("span", "detail", String(group.rows.length)),
      );
      li.append(head);
      if (!group.collapsed) {
        const ul = el("ul");
        ul.append(...rowsOf(group));
        li.append(ul);
      }
      items.push(li);
    }
    for (const p of model.problems) items.push(el("li", "problem", `⚠ ${p.id}: ${p.message}`));
    list.replaceChildren(...items);
  };
  const frame = new FrameScheduler(render);
  store.onChange((ev) => {
    if (ev.type !== "meta") frame.request();
  });
  ui.onChange((ev) => {
    if (ev === "visibility" || ev === "selection" || ev === "collapse") frame.request();
  });
  render();
}
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `cd frontend && npx vitest run test/keys.test.ts test/header.test.ts test/panel.test.ts`
Expected: PASS (13 tests: keys 5, header 4, panel 4).

- [ ] **Step 7: Rewrite the page**

Replace the whole of `frontend/index.html` with:

```html
<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>geomcore-viewer</title>
  </head>
  <body>
    <header id="chrome">
      <h1 id="title">geomcore-viewer</h1>
      <span id="status" role="status">connecting…</span>
      <span id="run" class="meta"></span>
      <span id="count" class="meta"></span>
      <div class="spacer"></div>
      <div class="seg" role="group" aria-label="view">
        <button id="view-2d" title="Plane view (2)">2D</button><button id="view-3d" title="3D view (3)">3D</button>
      </div>
      <label class="check" title="Frame the scene as it changes"><input type="checkbox" id="autofit" checked /> auto-fit</label>
      <button id="fit" title="Fit the scene (F)">fit</button>
      <button id="theme" title="Light or dark (T)">theme</button>
      <button id="present" title="Presentation mode (P)">present</button>
      <button id="clear" title="Clear the scene">clear</button>
    </header>
    <main>
      <section id="stage" data-view="2d">
        <canvas id="canvas3d"></canvas>
        <div id="view2d"></div>
        <div id="toast" role="status" hidden></div>
      </section>
      <aside id="panel">
        <ul id="object-list"></ul>
        <p class="hint">
          <kbd>F</kbd> fit · <kbd>P</kbd> present · <kbd>T</kbd> theme · <kbd>2</kbd> <kbd>3</kbd> view ·
          <kbd>Esc</kbd> leave / deselect · hover for details, click a point to copy it
        </p>
        <p class="hint">Live via SSE when served locally · <code>?scene=&lt;url&gt;</code> · or drop a <code>.json</code> scene file anywhere.</p>
      </aside>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Replace the whole of `frontend/src/style.css` with:

```css
/* Theme colours. The canvas colours mirror ui/theme.ts PALETTES. */
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --surface: #ffffff;
  --border: #d9dde3;
  --text: #1f2937;
  --muted: #6b7280;
  --accent: #2f6aa8;
  --on-accent: #ffffff;
  --warn: #b45309;
  --ok: #2f7d32;
  --selected: #e3edf8;
  --tooltip-bg: rgba(17, 24, 39, 0.92);
  --tooltip-text: #f9fafb;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #16181d;
  --surface: #1e2128;
  --border: #30343d;
  --text: #e5e7eb;
  --muted: #9aa3b2;
  --accent: #6aa5e0;
  --on-accent: #111827;
  --warn: #f0a35e;
  --ok: #7cc47f;
  --selected: #24364d;
  --tooltip-bg: rgba(243, 244, 246, 0.95);
  --tooltip-text: #111827;
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; display: flex; flex-direction: column; font: 14px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--text); }
button { font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 0.15rem 0.6rem; cursor: pointer; }
button:hover { border-color: var(--accent); }
button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
kbd { font: 11px/1 ui-monospace, monospace; padding: 0.1rem 0.3rem; border: 1px solid var(--border); border-radius: 3px; }

header#chrome { display: flex; gap: 0.75rem; align-items: center; padding: 0.4rem 1rem; background: var(--surface); border-bottom: 1px solid var(--border); }
header h1 { font-size: 1rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header .spacer { flex: 1; }
header .meta { color: var(--muted); font-size: 0.8rem; white-space: nowrap; }
header .meta:empty { display: none; }
#status { font-size: 0.8rem; color: var(--muted); }
#status[data-state="live"] { color: var(--ok); }
#status[data-state="error"] { color: var(--warn); }
.seg { display: flex; }
.seg button:first-child { border-radius: 4px 0 0 4px; }
.seg button:last-child { border-radius: 0 4px 4px 0; margin-left: -1px; }
.check { display: flex; gap: 0.3rem; align-items: center; white-space: nowrap; }

main { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 260px; }
#stage { position: relative; min-width: 0; overflow: hidden; background: var(--bg); }
#canvas3d, #view2d { position: absolute; inset: 0; width: 100%; height: 100%; }
#canvas3d { outline: none; }
#stage[data-view="2d"] #canvas3d, #stage[data-view="3d"] #view2d { display: none; }
#view2d canvas { display: block; }

aside#panel { background: var(--surface); border-left: 1px solid var(--border); padding: 0.5rem 0.75rem; overflow: auto; }
aside ul { list-style: none; padding: 0; margin: 0; }
aside li.object { display: flex; gap: 0.45rem; align-items: center; padding: 0.15rem 0.3rem; border-radius: 4px; cursor: pointer; }
aside li.object:hover { background: var(--bg); }
aside li.object.selected { background: var(--selected); }
aside li.object.hidden .name, aside li.object.hidden .swatch { opacity: 0.4; }
aside .swatch { flex: none; width: 0.8em; height: 0.8em; border-radius: 2px; }
aside .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
aside .detail { margin-left: auto; color: var(--muted); font-size: 0.75rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
aside li.group { margin-top: 0.4rem; }
aside .group-head { display: flex; gap: 0.35rem; align-items: center; font-weight: 600; padding: 0.15rem 0; }
aside .group > ul { padding-left: 1.1rem; }
aside .twisty { border: none; background: none; padding: 0 0.2rem; color: var(--muted); }
aside li.note { color: var(--muted); padding: 0.15rem 0.3rem; }
aside li.note.warn, aside li.problem { color: var(--warn); }
.hint { color: var(--muted); font-size: 0.75rem; }

body.presenting header#chrome, body.presenting aside#panel { display: none; }
body.presenting main { grid-template-columns: 1fr; }

#toast { position: absolute; left: 50%; bottom: 1.25rem; transform: translateX(-50%); padding: 0.4rem 0.8rem; border-radius: 6px; background: var(--tooltip-bg); color: var(--tooltip-text); font-size: 13px; pointer-events: none; }
#toast[hidden] { display: none; }

.labels { position: absolute; inset: 0; pointer-events: none; }
.labels > div { position: absolute; left: 0; top: 0; white-space: nowrap; line-height: 1.35; }
.labels .label { font-weight: 600; pointer-events: auto; user-select: text; cursor: text; text-shadow: 0 0 3px var(--bg), 0 0 2px var(--bg), 0 0 1px var(--bg); }
.labels .label.extra { font-weight: 500; }
.labels .label.lit { text-decoration: underline; }
.labels .tick { font-variant-numeric: tabular-nums; text-shadow: 0 0 2px var(--bg); }
.tooltip { position: absolute; left: 0; top: 0; pointer-events: none; padding: 0.3rem 0.5rem; border-radius: 4px; background: var(--tooltip-bg); color: var(--tooltip-text); font-size: 12px; line-height: 1.4; white-space: nowrap; z-index: 1; }
.tooltip[hidden] { display: none; }
.tooltip .head { font-weight: 600; }
```

Replace the whole of `frontend/src/main.ts` with:

```ts
import "./style.css";
import { FrameScheduler } from "./frame";
import { Store } from "./store";
import { RunCounter, renderHeader } from "./ui/header";
import { mountKeys } from "./ui/keys";
import { mountPanel } from "./ui/panel";
import { UiState } from "./ui/state";
import { applyTheme } from "./ui/theme";
import { View2D } from "./view2d/view";
import { View3D } from "./view3d";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

const store = new Store();
const ui = new UiState();
applyTheme(ui.theme);

const toastEl = byId("toast");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A short message over the view (copied coordinates, presentation mode hint). */
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2500);
}

// A machine without WebGL still gets the plane view and the panel.
let view3d: View3D | null = null;
try {
  view3d = new View3D(store, ui, byId<HTMLCanvasElement>("canvas3d"));
} catch (err) {
  console.error("geomcore-viewer: 3D view failed", err);
  store.setStatus(`3D view unavailable: ${err instanceof Error ? err.message : String(err)}`);
}
const view2d = new View2D(store, ui, byId("view2d"), toast);
mountPanel(store, ui, byId("object-list"));

const runs = new RunCounter();
const header = { title: byId("title"), status: byId("status"), run: byId("run"), count: byId("count") };
const stage = byId("stage");
const autofit = byId<HTMLInputElement>("autofit");
const shell = new FrameScheduler(() => {
  renderHeader(store, runs, header);
  const view = ui.activeView(store.view, store.objects.values());
  stage.dataset.view = view;
  byId("view-2d").setAttribute("aria-pressed", String(view === "2d"));
  byId("view-3d").setAttribute("aria-pressed", String(view === "3d"));
  byId("present").setAttribute("aria-pressed", String(ui.presenting));
  document.body.classList.toggle("presenting", ui.presenting);
  autofit.checked = ui.autoFit;
  view2d.setActive(view === "2d");
  view3d?.setActive(view === "3d");
});
store.onChange(() => shell.request());
ui.onChange((ev) => {
  if (ev === "theme") applyTheme(ui.theme);
  shell.request();
});
shell.request();

const fit = () => {
  view2d.fitRequested();
  view3d?.fitRequested();
};
const present = () => {
  ui.setPresenting(!ui.presenting);
  if (ui.presenting) toast("presentation mode · Esc to leave");
};
byId("fit").addEventListener("click", fit);
byId("view-2d").addEventListener("click", () => ui.setView("2d"));
byId("view-3d").addEventListener("click", () => ui.setView("3d"));
byId("theme").addEventListener("click", () => ui.toggleTheme());
byId("present").addEventListener("click", present);
autofit.addEventListener("change", () => ui.setAutoFit(autofit.checked)); // turning it on refits both views
byId("clear").addEventListener("click", () => void store.clearAll());
mountKeys({
  fit,
  present,
  theme: () => ui.toggleTheme(),
  view2d: () => ui.setView("2d"),
  view3d: () => ui.setView("3d"),
  escape: () => (ui.presenting ? ui.setPresenting(false) : ui.select(null)),
});

// Drag-and-drop a scene .json file anywhere on the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      store.setStatus(`could not parse ${file.name}`);
      return;
    }
    if (store.loadJson(raw, file.name)) store.setStatus(`static: ${file.name}`);
  });
});

// Debug and e2e access (the e2e tests read cameras and strokes through it).
Object.assign(window, { __gv: { store, ui, view2d, view3d } });

void store.load();
```

- [ ] **Step 8: Run all tests and the build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all PASS (188 tests in 21 files); the build ends with "✓ built".

- [ ] **Step 9: Look at it**

Serve as in Task 8 Step 7 (port 8799) and open `http://127.0.0.1:8799/?scene=sample-scene.json`. Check:
- the header reads "Conics and their intersections · static: sample-scene.json · run 1 · 12 objects", with 2D pressed;
- the panel shows the groups "conics" and "intersections";
- unticking "conics" hides the four curves, and ticking it brings them back;
- clicking the row E frames the ellipse, and clicking it again deselects it;
- `3` shows the 3D view and `2` brings the plane back;
- `T` switches to dark;
- `P` hides the header and panel, thickens lines and labels, and shows "presentation mode · Esc to leave";
- `Esc` leaves presentation mode;
- with the cursor in the browser's address bar, `F` types into it and nothing in the page reacts.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/ui/header.ts frontend/src/ui/keys.ts frontend/src/ui/panel.ts frontend/src/main.ts frontend/index.html frontend/src/style.css frontend/test/header.test.ts frontend/test/keys.test.ts frontend/test/panel.test.ts
git commit -m "frontend: one stage with the active view, header (run N, count), grouped panel with visibility, keys F/P/T/2/3/Esc, presentation mode, light/dark theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Python client: palette, indexed labels, hit parameters, port and tunnel papercuts

The 2D tooltip shows the parameters of an intersection hit (`meta.params`), so the Python client has to send them. This task also clears the Python items of the Phase 1 backlog:
- the palette's yellow and teal fail 3:1 contrast on the light background;
- `P₁` with 13 parts collides with `P₁₃`;
- a port-less `GEOMCORE_VIEWER_URL` silently meant 8765;
- a malformed URL crashed `geomcore-viewer --help`;
- an SSH tunnel that changes the port got a bare "foreign application" error;
- the spawn waited 5 s, while the spec says ≤ 3 s.

**Files:**
- Modify: `python/geomcore_viewer/adapt.py`, `viewer.py`, `server.py`, `spawn.py`, `__main__.py`
- Modify: `python/tests/test_adapt.py`, `test_viewer.py`, `test_server.py`, `test_spawn.py`
- Modify: `protocol/SCENE.md`
- Regenerate: `frontend/public/sample-scene.json`

**Interfaces:**
- Produces:
  - `adapt.indexed(label: str, i: int) -> str`: `P` → `P₃`, `P₁` → `P₁,₃`.
  - Each part of an intersection result carries `meta = {"tag": <result tag>, "params": [numbers…]}`; a non-finite number becomes `None`, and a bare geometry has no `params`.
  - `Viewer._build` copies `meta` to the protocol object.
  - `server.default_port() -> int`: 80 when the URL has no port; raises `ValueError` naming `GEOMCORE_VIEWER_URL` when the port is malformed.
  - `server.allowed_hosts(port) -> set[str]`. The 403 body is `{"error": …, "app": "geomcore-viewer"}`.
  - `spawn.probe()` gains the state `"refused"`; `spawn.refused_hint(url) -> str` names `ssh -L <port>:127.0.0.1:<port> <host>`. `ensure_server(url, timeout=3.0)` raises `RuntimeError(refused_hint(url))` on `"refused"`.
- Consumed by: the frontend tooltip (Task 7 `describeHit` reads `meta.params`).

- [ ] **Step 1: Write the failing tests**

Apply the test changes:

````bash
git apply <<'PATCH'
diff --git a/python/tests/test_adapt.py b/python/tests/test_adapt.py
index 6a763ad..2d53060 100644
--- a/python/tests/test_adapt.py
+++ b/python/tests/test_adapt.py
@@ -7,6 +7,7 @@ from geomcore_viewer.adapt import (
     as_vec,
     eval_curve,
     eval_surface,
+    indexed,
     scene_extent,
     subscript,
     to_objects,
@@ -213,3 +214,38 @@ def test_real_geomcore_intersections():
     assert [p["label"] for p in parts] == ["P₁", "P₂"]
     far = Circle3D(P(9, 0, 0), V.z(), 1.0)
     assert to_objects(C.intersect_circle(far), "Q")[0]["geom"]["text"] == "Q: ∅"
+
+
+def test_hit_parameters_and_tag_go_to_meta():
+    parts = to_objects(("points", [(0.1, Point3D(1, 0, 0), 0.2), (0.3, Point3D(0, 1, 0))]), "P")
+    assert [p["meta"] for p in parts] == [
+        {"tag": "points", "params": [0.1, 0.2]},
+        {"tag": "points", "params": [0.3]},
+    ]
+
+
+def test_a_bare_geometry_has_no_params():
+    [part] = to_objects(("point", Point3D(1, 2, 0)), "A")
+    assert part["meta"] == {"tag": "point"}
+    assert "meta" not in to_objects(Point3D(1, 2, 0), "B")[0]
+    assert "meta" not in to_objects([Point3D(1, 2, 0), Point3D(3, 4, 0)], "C")[0]
+
+
+def test_hit_parameters_are_json_safe():
+    [part] = to_objects(("tangent", (float("nan"), Point3D(1, 1, 0), (1, 2.5))), "T")[:1]
+    assert part["meta"] == {"tag": "tangent", "params": [None, [1, 2.5]]}
+
+
+def test_tuples_that_are_not_hits_still_give_their_geometry():
+    two = to_objects(("points", (Point3D(0, 0, 0), Point3D(1, 1, 0))), "P")  # two geometries: not one hit
+    assert [p["label"] for p in two] == ["P₁", "P₂"]
+    assert all(p["meta"] == {"tag": "points"} for p in two)
+    flagged = to_objects(("points", [(True, Point3D(0, 0, 0))]), "F")  # a bool is not a parameter
+    assert flagged[0]["meta"] == {"tag": "points"}
+
+
+def test_indexed_labels_never_collide():
+    assert indexed("P", 3) == "P₃"
+    assert indexed("P", 12) == "P₁₂"
+    assert indexed("P₁", 2) == "P₁,₂"
+    assert indexed("Q₁₀", 1) == "Q₁₀,₁"
diff --git a/python/tests/test_server.py b/python/tests/test_server.py
index e032559..62481a4 100644
--- a/python/tests/test_server.py
+++ b/python/tests/test_server.py
@@ -8,7 +8,7 @@ import urllib.request
 
 import pytest
 
-from geomcore_viewer.server import APP, PROTOCOL, Server
+from geomcore_viewer.server import APP, PROTOCOL, Server, allowed_hosts
 
 
 def _obj(object_id, **geom):
@@ -256,3 +256,14 @@ def test_no_cross_origin_read_header(server):
     assert "Access-Control-Allow-Origin" not in headers
     with urllib.request.urlopen(f"{server.url}/events", timeout=5) as res:
         assert res.headers.get("Access-Control-Allow-Origin") is None
+
+
+def test_refusal_names_the_app(server):
+    status, _, body = _raw(server, "GET", "/api/health", host="127.0.0.1:1")
+    assert status == 403
+    assert json.loads(body)["app"] == APP
+
+
+def test_port_80_accepts_the_bare_host_browsers_send():
+    assert allowed_hosts(8765) == {"127.0.0.1:8765", "localhost:8765"}
+    assert allowed_hosts(80) == {"127.0.0.1:80", "localhost:80", "127.0.0.1", "localhost"}
diff --git a/python/tests/test_spawn.py b/python/tests/test_spawn.py
index 1addfcc..4a2e5a1 100644
--- a/python/tests/test_spawn.py
+++ b/python/tests/test_spawn.py
@@ -1,14 +1,16 @@
+import json
 import socket
 import threading
 import time
-from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
+from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
 
 import pytest
 
 from geomcore_viewer import spawn
 from geomcore_viewer.__main__ import main
-from geomcore_viewer.server import DEFAULT_PORT, Server
-from geomcore_viewer.spawn import ensure_server, probe, stop_server
+from geomcore_viewer import Viewer
+from geomcore_viewer.server import APP, DEFAULT_PORT, Server
+from geomcore_viewer.spawn import ensure_server, probe, refused_hint, stop_server
 
 
 def _free_port():
@@ -148,7 +150,7 @@ class _FakeServer:
         ("http://127.0.0.1:8799", ["--port", "8123"], 8123),
         (None, [], DEFAULT_PORT),
         ("  ", [], DEFAULT_PORT),
-        ("http://127.0.0.1", [], DEFAULT_PORT),
+        ("http://127.0.0.1", [], 80),  # no port in the URL means 80, as for the client
     ],
 )
 def test_cli_serve_port_default(monkeypatch, env, argv, expected):
@@ -180,3 +182,61 @@ def test_spawned_server_runs_from_the_home_directory(monkeypatch):
     [(cmd, kwargs)] = calls
     assert kwargs["cwd"] == os.path.expanduser("~")  # not the script's directory, which would stay busy
     assert cmd[-3:] == ["--port", "12345", "--no-browser"]
+
+
+class _Refusing(BaseHTTPRequestHandler):
+    """A geomcore-viewer seen through a tunnel that changed the port: every request gets its 403."""
+
+    def do_GET(self):
+        body = json.dumps({"error": "request is not from this server's own origin", "app": APP}).encode()
+        self.send_response(403)
+        self.send_header("Content-Type", "application/json")
+        self.send_header("Content-Length", str(len(body)))
+        self.end_headers()
+        self.wfile.write(body)
+
+    def log_message(self, *args):
+        pass
+
+
+def test_a_refusing_viewer_gets_the_tunnel_hint():
+    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Refusing)
+    threading.Thread(target=httpd.serve_forever, daemon=True).start()
+    port = httpd.server_address[1]
+    url = f"http://127.0.0.1:{port}"
+    try:
+        assert probe(url) == "refused"
+        with pytest.raises(RuntimeError, match=f"ssh -L {port}:127.0.0.1:{port} <host>"):
+            ensure_server(url)
+        with pytest.warns(RuntimeWarning, match=f"ssh -L {port}:127.0.0.1:{port} <host>"):
+            Viewer(url=url, spawn=False, open_browser=False).text((0, 0, 0), "hello")
+    finally:
+        httpd.shutdown()
+        httpd.server_close()
+
+
+def test_the_tunnel_hint_keeps_the_port():
+    assert "ssh -L 9000:127.0.0.1:9000 <host>" in refused_hint("http://127.0.0.1:9000")
+    assert "ssh -L 80:127.0.0.1:80 <host>" in refused_hint("http://127.0.0.1")
+
+
+def test_spawning_waits_at_most_three_seconds():
+    import inspect
+
+    assert inspect.signature(ensure_server).parameters["timeout"].default == 3.0
+
+
+@pytest.mark.parametrize("command", ["serve", "stop"])
+def test_cli_reports_a_malformed_environment_url(monkeypatch, capsys, command):
+    monkeypatch.setenv("GEOMCORE_VIEWER_URL", "http://127.0.0.1:87x5")
+    with pytest.raises(SystemExit) as exc:
+        main([command])
+    assert exc.value.code == 2
+    assert "GEOMCORE_VIEWER_URL='http://127.0.0.1:87x5' has a malformed port" in capsys.readouterr().err
+
+
+def test_cli_explicit_port_ignores_a_malformed_environment_url(monkeypatch, capsys):
+    monkeypatch.setenv("GEOMCORE_VIEWER_URL", "http://127.0.0.1:87x5")
+    port = _free_port()
+    main(["stop", "--port", str(port)])
+    assert f"no viewer running at http://127.0.0.1:{port}" in capsys.readouterr().out
diff --git a/python/tests/test_viewer.py b/python/tests/test_viewer.py
index 9c0c641..dfaf31d 100644
--- a/python/tests/test_viewer.py
+++ b/python/tests/test_viewer.py
@@ -342,3 +342,39 @@ def test_a_later_outage_warns_again(tmp_path):
         second.stop()
     with pytest.warns(RuntimeWarning, match="unreachable"):
         view.add(Point3D(3, 0), label="d")
+
+
+def _contrast(a, b):
+    def lum(hex_color):
+        def channel(c):
+            s = int(c, 16) / 255
+            return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
+
+        r, g, b_ = (channel(hex_color[i:i + 2]) for i in (1, 3, 5))
+        return 0.2126 * r + 0.7152 * g + 0.0722 * b_
+
+    hi, lo = sorted((lum(a), lum(b)), reverse=True)
+    return (hi + 0.05) / (lo + 0.05)
+
+
+@pytest.mark.parametrize("background", ["#f7f8fa", "#16181d"])
+def test_palette_reads_on_both_themes(background):
+    assert len(set(PALETTE)) == 8
+    for color in PALETTE:
+        assert _contrast(color, background) >= 3.0, color
+
+
+def test_many_arguments_with_several_points_keep_distinct_labels(server):
+    two = ("points", [(0.1, Point3D(0, 0), 0.2), (0.3, Point3D(1, 1), 0.4)])
+    one = ("point", (0.5, Point3D(2, 2), 0.6))
+    handles = make(server).add(two, *[one] * 10, label="P")
+    ids = [h.id for h in handles]
+    assert ids[:3] == ["P₁,₁", "P₁,₂", "P₂"]
+    assert ids[-1] == "P₁₁"
+    assert len(set(ids)) == 12
+
+
+def test_meta_reaches_the_server(server):
+    make(server).add(("points", [(0.1, Point3D(1, 0), 0.2)]), label="P")
+    [obj] = _scene(server)["objects"]
+    assert obj["meta"] == {"tag": "points", "params": [0.1, 0.2]}
PATCH
````

- [ ] **Step 2: Run them to verify they fail**

Run: `PYTHONPATH=python python3 -m pytest python/tests -q`
Expected: FAIL. Three collection errors: `cannot import name 'indexed'`, `'allowed_hosts'` and `'refused_hint'`.

- [ ] **Step 3: Implement**

Apply the source changes:

````bash
git apply <<'PATCH'
diff --git a/python/geomcore_viewer/__main__.py b/python/geomcore_viewer/__main__.py
index 6efd593..b1b0d53 100644
--- a/python/geomcore_viewer/__main__.py
+++ b/python/geomcore_viewer/__main__.py
@@ -10,16 +10,21 @@ from .spawn import stop_server
 
 
 def main(argv: list[str] | None = None) -> None:
-    port_help = "default: the port of $GEOMCORE_VIEWER_URL, else 8765"
+    port_help = "default: the port of $GEOMCORE_VIEWER_URL (80 when it names none), else 8765"
     parser = argparse.ArgumentParser(prog="geomcore-viewer")
     commands = parser.add_subparsers(dest="command", required=True)
     serve = commands.add_parser("serve", help="serve the viewer in the foreground")
     serve.add_argument("--dir", default=None, help="frontend directory (default: the bundled build)")
-    serve.add_argument("--port", type=int, default=default_port(), help=port_help)
+    serve.add_argument("--port", type=int, default=None, help=port_help)
     serve.add_argument("--no-browser", action="store_true")
     stop = commands.add_parser("stop", help="stop a running viewer server")
-    stop.add_argument("--port", type=int, default=default_port(), help=port_help)
+    stop.add_argument("--port", type=int, default=None, help=port_help)
     args = parser.parse_args(argv)
+    if args.port is None:  # resolved only now, so an explicit --port works whatever the variable holds
+        try:
+            args.port = default_port()
+        except ValueError as err:
+            parser.error(str(err))
 
     if args.command == "serve":
         server = Server(args.dir, args.port)
diff --git a/python/geomcore_viewer/adapt.py b/python/geomcore_viewer/adapt.py
index 7c5cddc..a545ba0 100644
--- a/python/geomcore_viewer/adapt.py
+++ b/python/geomcore_viewer/adapt.py
@@ -57,10 +57,19 @@ _INFINITE = {"plane": ("u", "v"), "cylinder": ("v",), "cone": ("v",), "sphere":
 _SUBSCRIPTS = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
 
 
+_SUBSCRIPT_DIGITS = frozenset("₀₁₂₃₄₅₆₇₈₉")
+
+
 def subscript(i: int) -> str:
     return str(i).translate(_SUBSCRIPTS)
 
 
+def indexed(label: str, i: int) -> str:
+    """``P`` → ``P₃``; a label that already ends in a subscript gets a comma, ``P₁`` → ``P₁,₃``,
+    so the 3rd point of ``P₁`` cannot collide with the 13th argument ``P₁₃``."""
+    return f"{label},{subscript(i)}" if label[-1:] in _SUBSCRIPT_DIGITS else f"{label}{subscript(i)}"
+
+
 # --- vectors ---------------------------------------------------------------
 def as_vec(p) -> list[float]:
     """Point3D / Point2D / Vector2D / Vector3D / sequence → ``[x, y, z]`` floats."""
@@ -251,23 +260,67 @@ def _single(obj, label: str | None, u, v) -> list[dict]:
 
 
 # --- results and containers --------------------------------------------------
-def _leaves(payload) -> list:
-    """Geometry objects anywhere inside a result payload (parameters are dropped)."""
+_NOT_NUMERIC = object()
+
+
+def _numeric(x):
+    """A parameter as JSON: a number (None when not finite), a tuple as a list; ``_NOT_NUMERIC`` otherwise."""
+    if isinstance(x, bool):
+        return _NOT_NUMERIC
+    if isinstance(x, int):
+        return x
+    if isinstance(x, float):
+        return x if math.isfinite(x) else None
+    if isinstance(x, (list, tuple)):
+        items = [_numeric(i) for i in x]
+        return _NOT_NUMERIC if any(i is _NOT_NUMERIC for i in items) else items
+    return _NOT_NUMERIC
+
+
+def _hit(item):
+    """``(geometry, params)`` for a hit tuple such as ``(t, P, s)``: exactly one geometry and
+    at least one number (or tuple of numbers); None for anything else."""
+    if not isinstance(item, tuple):
+        return None
+    geoms = [x for x in item if type(x).__name__ in GEOMETRY]
+    if len(geoms) != 1 or len(item) < 2:
+        return None
+    params = [_numeric(x) for x in item if x is not geoms[0]]
+    if any(p is _NOT_NUMERIC for p in params):
+        return None
+    return geoms[0], params
+
+
+def _leaves(payload) -> list[tuple]:
+    """``(geometry, params)`` for every geometry inside a result payload; ``params`` are the
+    numbers of its hit tuple (``(t, P, s)`` → ``[t, s]``), None for a bare geometry."""
     if payload is None:
         return []
     if type(payload).__name__ in GEOMETRY:
-        return [payload]
+        return [(payload, None)]
+    hit = _hit(payload)
+    if hit is not None:
+        return [hit]
     if isinstance(payload, (list, tuple)):
         return [leaf for item in payload for leaf in _leaves(item)]
     return []
 
 
-def _labelled(items: list, label: str | None, u, v) -> list[dict]:
-    if len(items) == 1:
-        return _single(items[0], label, u, v)
+def _labelled(items: list, label: str | None, u, v, tag: str | None = None) -> list[dict]:
+    """One part per ``(geometry, params)``, labelled ``P₁``, ``P₂`` … when there are several;
+    the result tag and the hit parameters go to ``meta`` (spec §3.3)."""
     parts: list[dict] = []
-    for i, item in enumerate(items, start=1):
-        parts += _single(item, f"{label}{subscript(i)}" if label else None, u, v)
+    for i, (item, params) in enumerate(items, start=1):
+        name = label if len(items) == 1 or not label else indexed(label, i)
+        [part] = _single(item, name, u, v)
+        meta: dict = {}
+        if tag is not None:
+            meta["tag"] = tag
+        if params is not None:
+            meta["params"] = params
+        if meta:
+            part["meta"] = meta
+        parts.append(part)
     return parts
 
 
@@ -289,7 +342,7 @@ def _result(tag: str, payload, label: str | None, u, v) -> list[dict]:
     if tag == "not_analytic":
         return [_note("no closed form — try geomcore.intersect_marching", label, "warn")]
     leaves = _leaves(payload)
-    parts = _labelled(leaves, label, u, v)
+    parts = _labelled(leaves, label, u, v, tag)
     if tag in INFO_NOTES:
         parts.append(_note(INFO_NOTES[tag], label))
     known = tag in INFO_NOTES or tag in POINT_TAGS or tag in CURVE_TAGS
diff --git a/python/geomcore_viewer/server.py b/python/geomcore_viewer/server.py
index 944b900..7e4a204 100644
--- a/python/geomcore_viewer/server.py
+++ b/python/geomcore_viewer/server.py
@@ -27,8 +27,25 @@ def default_url() -> str:
 
 
 def default_port() -> int:
-    """The port of :func:`default_url`, or ``DEFAULT_PORT`` when the URL names none."""
-    return urlparse(default_url()).port or DEFAULT_PORT
+    """The port of :func:`default_url`: 80 when the URL names none, as ``http://`` means.
+
+    Raises ValueError, naming the variable, when the port is malformed.
+    """
+    url = default_url()
+    try:
+        port = urlparse(url).port
+    except ValueError as err:
+        raise ValueError(f"{URL_ENV}={url!r} has a malformed port ({err})") from None
+    return 80 if port is None else port
+
+
+def allowed_hosts(port: int) -> set[str]:
+    """``Host`` values that name this server; browsers leave out the default port 80."""
+    hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
+    if port == 80:
+        hosts |= {"127.0.0.1", "localhost"}
+    return hosts
+
 
 _MIME = {
     ".html": "text/html",
@@ -166,12 +183,12 @@ def make_handler(frontend_dir: Path, state: _State) -> type[BaseHTTPRequestHandl
             ``Host`` (DNS rebinding) and ``Origin`` (cross-site fetch) headers
             must name this server. Answers 403 itself when they do not.
             """
-            port = self.server.server_address[1]
-            hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
+            hosts = allowed_hosts(self.server.server_address[1])
             origin = self.headers.get("Origin")
             if self.headers.get("Host") in hosts and (origin is None or origin in {f"http://{h}" for h in hosts}):
                 return True
-            self._send_json({"error": "request is not from this server's own origin"}, 403)
+            # "app" lets a client tell this refusal (e.g. through a port-changing tunnel) from another program.
+            self._send_json({"error": "request is not from this server's own origin", "app": APP}, 403)
             return False
 
         def _read_json(self) -> object:
diff --git a/python/geomcore_viewer/spawn.py b/python/geomcore_viewer/spawn.py
index babb3cd..08a9e00 100644
--- a/python/geomcore_viewer/spawn.py
+++ b/python/geomcore_viewer/spawn.py
@@ -24,15 +24,37 @@ def _timed_out(err: OSError) -> bool:
     return isinstance(reason, (TimeoutError, socket.timeout))
 
 
+def _refused(err: urllib.error.HTTPError) -> bool:
+    """A 403 from a geomcore-viewer whose Host check rejected the URL (a tunnel to another port)."""
+    if err.code != 403:
+        return False
+    try:
+        doc = json.loads(err.read())
+    except (ValueError, OSError):
+        return False
+    return isinstance(doc, dict) and doc.get("app") == APP
+
+
+def refused_hint(url: str) -> str:
+    """What to tell the user when a geomcore-viewer refuses ``url``."""
+    port = urlparse(url).port or 80
+    return (
+        f"the geomcore-viewer at {url} refused the request: it only answers to its own address, "
+        f"so an SSH tunnel must keep the port (ssh -L {port}:127.0.0.1:{port} <host>)"
+    )
+
+
 def probe(url: str, timeout: float = 0.5) -> str:
-    """``"ours"`` (a v2 geomcore-viewer answers), ``"foreign"`` (something else
-    answers), ``"unresponsive"`` (something accepts the connection but does not
-    answer within ``timeout``) or ``"none"`` (nothing listens)."""
+    """``"ours"`` (a v2 geomcore-viewer answers), ``"refused"`` (a geomcore-viewer
+    answers but rejects this URL's host, e.g. through a tunnel that changes the
+    port), ``"foreign"`` (something else answers), ``"unresponsive"`` (something
+    accepts the connection but does not answer within ``timeout``) or ``"none"``
+    (nothing listens)."""
     try:
         with urllib.request.urlopen(f"{url}/api/health", timeout=timeout) as res:
             doc = json.loads(res.read())
-    except urllib.error.HTTPError:
-        return "foreign"
+    except urllib.error.HTTPError as err:
+        return "refused" if _refused(err) else "foreign"
     except (ValueError, http.client.HTTPException):
         return "foreign"
     except OSError as err:
@@ -63,15 +85,19 @@ def _spawn(port: int) -> subprocess.Popen:
     return proc
 
 
-def ensure_server(url: str, timeout: float = 5.0) -> bool:
+def ensure_server(url: str, timeout: float = 3.0) -> bool:
     """Make sure a geomcore-viewer answers at ``url``; return True if this call started it.
 
-    Raises RuntimeError when another application holds the port, when ``url``
-    is not local, or when the started server does not answer within ``timeout``.
+    Raises RuntimeError when another application holds the port, when a
+    geomcore-viewer refuses ``url`` (a tunnel that changes the port), when
+    ``url`` is not local, or when the started server does not answer within
+    ``timeout`` (spec: ≤ 3 s).
     """
     state = probe(url)
     if state == "ours":
         return False
+    if state == "refused":
+        raise RuntimeError(refused_hint(url))
     if state == "foreign":
         raise RuntimeError(
             f"{url} answers but is not a geomcore-viewer v2 server (an older geomcore-viewer, "
diff --git a/python/geomcore_viewer/viewer.py b/python/geomcore_viewer/viewer.py
index a7601f6..71f0638 100644
--- a/python/geomcore_viewer/viewer.py
+++ b/python/geomcore_viewer/viewer.py
@@ -11,12 +11,13 @@ import webbrowser
 from pathlib import Path
 from urllib.parse import quote
 
-from .adapt import SURFACE_TYPES, as_vec, scene_extent, subscript, to_objects, with_window
+from .adapt import SURFACE_TYPES, as_vec, indexed, scene_extent, to_objects, with_window
 from .server import PROTOCOL, default_url
-from .spawn import ensure_server, probe
+from .spawn import ensure_server, probe, refused_hint
 
-# Categorical palette that stays readable on a projector, light or dark background.
-PALETTE = ("#d1495b", "#00798c", "#edae49", "#30638e", "#6a4c93", "#2a9d8f", "#e76f51", "#3d405b")
+# Categorical palette: every colour has contrast ≥ 3:1 on the viewer's light (#f7f8fa) and
+# dark (#16181d) backgrounds (spec §3.5, tests/test_viewer.py), so it reads on a projector.
+PALETTE = ("#d1495b", "#00798c", "#c47f00", "#3a7cc2", "#8a5cc2", "#5c8a00", "#b5448f", "#6b7a8f")
 STYLE_KEYS = ("color", "width", "dashed", "opacity")
 EXTRA_KEYS = frozenset({"foci", "center", "axes", "asymptotes", "directrix", "vertex", "isolines", "wire"})
 VIEWS = ("auto", "2d", "3d")
@@ -107,7 +108,7 @@ class Viewer:
             raise TypeError("add() needs at least one object")
         parts: list[dict] = []
         for i, obj in enumerate(objs, start=1):
-            part_label = label if len(objs) == 1 or label is None else f"{label}{subscript(i)}"
+            part_label = label if len(objs) == 1 or label is None else indexed(label, i)
             parts += to_objects(obj, part_label, u=u, v=v)
         return self._commit(parts, label, group, options, u, v)
 
@@ -166,6 +167,8 @@ class Viewer:
             obj["style"] = {"color": previous.get("color") or self._color(), **style}
         if extras:
             obj["extras"] = dict(extras)
+        if part.get("meta"):
+            obj["meta"] = part["meta"]
         _check_serializable(obj)
         return obj
 
@@ -260,8 +263,11 @@ class Viewer:
             return True
         if self.spawn:
             return self._spawn_or_find()
-        self._online = probe(self.url) == "ours"
-        if not self._online:
+        state = probe(self.url)
+        self._online = state == "ours"
+        if state == "refused":
+            self._warn(f"{refused_hint(self.url)}; keeping objects locally (save() still works)")
+        elif not self._online:
             self._warn(f"no geomcore-viewer at {self.url}; keeping objects locally (save() still works)")
         else:
             self._reconnected()
PATCH
````

Notes for the reviewer:
- `_hit` only accepts a tuple with exactly one geometry and numbers (or tuples of numbers) beside it. Anything else falls through to the old recursive walk, so unknown payload shapes still draw their geometry.
- `--port` defaults to `None` and the port is resolved after parsing. This way `--help` and an explicit `--port` both work even when `GEOMCORE_VIEWER_URL` is malformed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PYTHONPATH=python python3 -m pytest python/tests -q`
Expected: PASS, 117 passed and 2 skipped. With geomcore importable (`PYTHONPATH=python:../geomcore/geomcore-py`): 119 passed.

Also run `python3.9 -m py_compile python/geomcore_viewer/*.py` if a 3.9 interpreter is present (CI runs 3.9).

- [ ] **Step 5: Document meta and the host rules**

````bash
git apply <<'PATCH'
diff --git a/protocol/SCENE.md b/protocol/SCENE.md
index e5c5ff9..25053a2 100644
--- a/protocol/SCENE.md
+++ b/protocol/SCENE.md
@@ -37,7 +37,7 @@ The viewer never computes intersections or any other geometric query.
 | `source` | no | client-side type name, e.g. `Ellipse3D` |
 | `style` | no | `color` (CSS), `width` (px), `dashed`, `opacity` (0–1) |
 | `extras` | no | curves: `foci`, `center`, `axes`, `asymptotes`, `directrix`, `vertex`; surfaces: `isolines: [nu, nv]`, `wire`. Unknown extras are ignored. |
-| `meta` | no | free-form client data |
+| `meta` | no | free-form client data. The Python client sets `tag` (the intersection result's tag, e.g. `"points"`) and `params` (the numbers of the hit, e.g. `[t, s]` for `(t, P, s)`; a non-finite one is `null`); the 2D tooltip shows `params`. |
 
 `view` is `"auto"`, `"2d"` or `"3d"`. Vectors are `[x, y, z]`; a
 2-component vector is read as `[x, y, 0]`. Every `frame` carries all three
@@ -129,9 +129,12 @@ Clients ignore event types they do not know.
 Every `POST` must send `Content-Type: application/json` (anything else
 gets `415`). Any website can make a browser call `127.0.0.1`, so the server
 only answers requests from itself: the `Host` header must be
-`127.0.0.1:<port>` or `localhost:<port>`, and an `Origin` header, when
-present, must be `http://127.0.0.1:<port>` or `http://localhost:<port>`;
-otherwise `403`. It sends no CORS headers and answers no preflight, so other
+`127.0.0.1:<port>` or `localhost:<port>` (bare `127.0.0.1` or `localhost`
+too on port 80, where browsers leave the port out), and an `Origin` header,
+when present, must be `http://` followed by one of those; otherwise `403`
+with `{"error": …, "app": "geomcore-viewer"}`, so a client can tell this
+refusal from another program. An SSH tunnel must therefore keep the port:
+`ssh -L 8765:127.0.0.1:8765 <host>`. It sends no CORS headers and answers no preflight, so other
 origins can neither read nor write. Non-browser clients (Python, Rust, curl)
 send no `Origin`; they just need the JSON content type and a `Host` with the
 port.
PATCH
````

- [ ] **Step 6: Regenerate the sample scene**

Run: `GEOMCORE_VIEWER_URL=http://127.0.0.1:8798 PYTHONPATH=python:../geomcore/geomcore-py python3 examples/conics_2d.py --save frontend/public/sample-scene.json`
Expected: `saved frontend/public/sample-scene.json`. The file now uses the new palette, and the intersection points carry `"meta": {"tag": "points", "params": [...]}`. The URL points at an unused port, so nothing is probed on 8765. `--save` never spawns a server.

- [ ] **Step 7: Check the frontend still agrees**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all PASS (188 tests in 21 files); the build ends with "✓ built". Serve as in Task 8 Step 7 and hover an intersection point: the tooltip shows its hit parameters (`meta.params`).

- [ ] **Step 8: Commit**

```bash
git add python/geomcore_viewer python/tests protocol/SCENE.md frontend/public/sample-scene.json
git commit -m "python: projector-safe palette, P₁,₂ labels, hit parameters in meta, port-less URL means 80, a refused tunnel says how to fix it, 3 s spawn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Browser tests, CI and README

Spec §9 asks for e2e tests of the run swap and the 2D view. The unit tests cannot see these four things:
- the page draws the sample;
- a line still crosses the whole view after a large zoom-out;
- a re-run keeps the camera and the hidden groups;
- the keys act on the real DOM.

The tests run against the built page and the real Python server on port **8797**.

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/viewer.e2e.ts`
- Modify: `frontend/package.json` (+ lock), `.gitignore`, `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes:
  - `window.__gv` (Task 10): `store`, `ui`, `view2d`, `view3d`.
  - `View2D.camera` and `View2D.strokesOf(id)` (Task 8).
  - The header ids `#title`, `#run`, `#count` and the `#chrome` wrapper (Task 10).
  - The panel's group checkboxes (`li.group[data-group] .group-head input`) and the `.labels .label` overlay (Task 8).

- [ ] **Step 1: Add Playwright**

Run: `cd frontend && npm i -D @playwright/test@^1.64.0 && npm pkg set scripts.e2e="playwright test"`
Expected: `package.json` gains the devDependency and `"e2e": "playwright test"`.

Then download a browser with `npx playwright install chromium`. If that is impossible, as on the dev machine, set `PLAYWRIGHT_CHROMIUM` to a chromium already on disk. For example, `PLAYWRIGHT_CHROMIUM=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`. The config passes it as `executablePath`.

- [ ] **Step 2: Write the config and the tests**

Create `frontend/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

// The e2e server runs on 8797 (8765 is the default for users, 8799 is kept for manual runs).
const PORT = 8797;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  workers: 1, // the tests share one server scene
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"], // WebGL without a GPU (CI)
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, // optional: a chromium already on disk
    },
  },
  webServer: {
    command: `python3 -m geomcore_viewer serve --dir frontend/dist --port ${PORT} --no-browser`,
    cwd: "..",
    env: { ...process.env, PYTHONPATH: "python" } as Record<string, string>,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
```

Create `frontend/e2e/viewer.e2e.ts`:

```ts
import { Page, expect, test } from "@playwright/test";

interface Camera {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}
type Vec2 = [number, number];

const camera = (page: Page): Promise<Camera> =>
  page.evaluate(() => (window as unknown as { __gv: { view2d: { camera: Camera } } }).__gv.view2d.camera);

/** Screen extent of an object's strokes in the last frame, with the pane size. */
const strokeSpan = (page: Page, id: string) =>
  page.evaluate((id) => {
    const view = (window as unknown as { __gv: { view2d: { camera: Camera; strokesOf(id: string): { paths: Vec2[][] }[] } } })
      .__gv.view2d;
    const pts = view.strokesOf(id).flatMap((s) => s.paths.flat());
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const c = view.camera;
    return { n: pts.length, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), w: c.width, h: c.height };
  }, id);

const point = (id: string, x: number, y: number, group?: string) => ({
  id,
  label: id,
  geom: { type: "point", p: [x, y, 0] },
  ...(group ? { group } : {}),
});

test.beforeEach(async ({ request }) => {
  await request.post("/api/clear", { data: {} });
});

test("the sample scene renders in the plane view", async ({ page }) => {
  await page.goto("/?scene=sample-scene.json");
  await expect(page.locator("#title")).toHaveText("Conics and their intersections");
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "2d");
  await expect(page.locator("#count")).toHaveText("12 objects");
  await expect(page.locator(".labels .label", { hasText: "P₁ (2.994, -0.123)" })).toBeVisible();
  await expect(page.locator(".labels .label.extra", { hasText: "F₁" })).toHaveCount(1);
  await expect.poll(async () => (await strokeSpan(page, "L")).n).toBeGreaterThan(1);
});

test("zooming far out keeps line L spanning the view", async ({ page }) => {
  await page.goto("/?scene=sample-scene.json");
  await expect(page.locator("#count")).toHaveText("12 objects");
  const box = (await page.locator("#view2d").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 1500);
  await expect.poll(async () => (await camera(page)).scale).toBeLessThan(1);
  await expect
    .poll(async () => {
      const s = await strokeSpan(page, "L");
      return (s.minX <= 0 && s.maxX >= s.w) || (s.minY <= 0 && s.maxY >= s.h);
    })
    .toBe(true);
});

test("a re-run swaps the scene but keeps the camera and hidden groups", async ({ page, request }) => {
  await request.post("/api/objects", { data: { run: "r1", title: "first", objects: [point("A", 0, 0), point("B", 1, 0, "other")] } });
  await page.goto("/");
  await expect(page.locator("#title")).toHaveText("first");
  await expect(page.locator("#run")).toHaveText("run 1");
  const fitted = await camera(page);
  const box = (await page.locator("#view2d").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300); // the user zooms: auto-fit lets go of the camera
  await expect.poll(async () => (await camera(page)).scale).toBeLessThan(fitted.scale);
  const moved = await camera(page);

  const groupBox = page.locator('li.group[data-group="other"] .group-head input[type="checkbox"]');
  await groupBox.click();
  await expect(groupBox).not.toBeChecked();
  await expect(page.locator(".labels .label", { hasText: /^B / })).toHaveCount(0);

  await request.post("/api/objects", { data: { run: "r2", title: "second", objects: [point("C", 0.5, 0.5), point("D", 1, 1, "other")] } });
  await expect(page.locator("#title")).toHaveText("second");
  await expect(page.locator("#run")).toHaveText("run 2");
  await expect(page.locator(".labels .label", { hasText: "C (0.5, 0.5)" })).toBeVisible();
  await expect(page.locator(".labels .label", { hasText: /^D / })).toHaveCount(0);
  await expect(page.locator('li.group[data-group="other"] .group-head input[type="checkbox"]')).not.toBeChecked();
  expect(await camera(page)).toEqual(moved);
});

test("T switches the theme, P presents and Esc leaves", async ({ page }) => {
  await page.goto("/?scene=sample-scene.json");
  await expect(page.locator("#count")).toHaveText("12 objects");
  await page.keyboard.press("t");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("p");
  await expect(page.locator("#chrome")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#chrome")).toBeVisible();
  await page.keyboard.press("Control+t"); // a browser shortcut, not the viewer's T
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
```

Keep Playwright's output out of git:

````bash
git apply <<'PATCH'
diff --git a/.gitignore b/.gitignore
index b10de98..7f6d243 100644
--- a/.gitignore
+++ b/.gitignore
@@ -7,3 +7,5 @@ target/
 .DS_Store
 build/
 python/geomcore_viewer/_frontend/
+test-results/
+playwright-report/
PATCH
````

- [ ] **Step 3: Run them**

Run: `cd frontend && npm run build && npm run e2e`
Expected: `4 passed`. All four tests already pass, because Tasks 1–11 built the behaviour. To see that the swap test can fail, temporarily drop `&& !this.userMoved` from the `refit` condition in `View2D` (`frontend/src/view2d/view.ts`). The test must then fail on the camera check; restore the condition afterwards.

- [ ] **Step 4: Run them in CI**

````bash
git apply <<'PATCH'
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 89fc2fb..13cd1f0 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -13,6 +13,19 @@ jobs:
       - run: npm ci
       - run: npm test
       - run: npm run build
+  e2e:
+    runs-on: ubuntu-latest
+    defaults: { run: { working-directory: frontend } }
+    steps:
+      - uses: actions/checkout@v4
+      - uses: actions/setup-node@v4
+        with: { node-version: 22, cache: npm, cache-dependency-path: frontend/package-lock.json }
+      - uses: actions/setup-python@v5
+        with: { python-version: "3.12" }
+      - run: npm ci
+      - run: npx playwright install --with-deps chromium
+      - run: npm run build
+      - run: npm run e2e
   python:
     runs-on: ubuntu-latest
     strategy:
PATCH
````

- [ ] **Step 5: Update the README**

This adds:
- the edge-to-edge sentence;
- a "The page" section covering the keys, the panel, hover and copy;
- the port-80 and SSH-tunnel paragraph;
- the e2e command.

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index 4fc94bc..17b72a0 100644
--- a/README.md
+++ b/README.md
@@ -28,9 +28,10 @@ view.add(C.intersect_ellipse(E), label="P")   # → P₁, P₂
   inside one process (`pdb`, IPython, Jupyter) every `gv.add(x)` lands in the
   same scene. Re-adding a label updates that object instead of duplicating it.
 - **Exact.** Objects travel as analytic definitions (frame + radii); the
-  viewer evaluates them with geomcore's own parametrizations. Lines,
-  parabolas and hyperbolas are drawn across 1.5× the scene's extent (exact
-  edge-to-edge clipping comes with the Phase 2 plane view).
+  viewer evaluates them with geomcore's own parametrizations. The plane view
+  clips lines, parabolas and hyperbolas to the window in closed form, so they
+  run edge to edge at any zoom; the 3D view draws them across 1.5× the
+  scene's extent.
 - **Static too.** `view.save("scene.json")`, then open the hosted viewer with
   `?scene=<url>` or drag-drop the file onto it.
 
@@ -65,8 +66,33 @@ The server listens on `http://127.0.0.1:8765` by default. If that port is
 busy, set `GEOMCORE_VIEWER_URL=http://127.0.0.1:<other port>` (every script
 and `gv.add` picks it up; a started server listens on that port) or pass
 `gv.Viewer(url=...)`. An explicit `url=` wins over the variable. A blank
-variable counts as unset. `geomcore-viewer serve` and `stop` take their default
-port from the same variable; `--port` overrides it.
+variable counts as unset. A URL without a port means port 80, as `http://`
+says. `geomcore-viewer serve` and `stop` take their default port from the same
+variable; `--port` overrides it.
+
+The server only answers requests addressed to its own `127.0.0.1:<port>` (a
+browser safety rule), so to watch a remote machine's viewer through SSH keep
+the same port on both ends: `ssh -L 8765:127.0.0.1:8765 <host>`, then open
+`http://127.0.0.1:8765`.
+
+## The page
+
+The view shows the plane z = 0 when every object lies in it, else 3D; the
+header's 2D/3D switch (or the scene's `view`) overrides that.
+
+| Key | Does |
+|---|---|
+| `F` | fit the scene (and follow it again as it changes) |
+| `P` | presentation mode: header and panel hidden, lines and labels ×1.5 |
+| `T` | light / dark theme (remembered by the browser) |
+| `2` / `3` | plane view / 3D view |
+| `Esc` | leave presentation mode, else clear the selection |
+
+In the plane view, hover an object for its type, label, parameter `t`, and
+`(x, y)`; intersection points also show the parameters of the hit
+(`meta.params`). Click a point to copy its coordinates. Drag to pan and
+scroll to zoom. The panel's checkboxes hide objects and whole groups, and
+stay off when the script runs again. Click a row to frame that object.
 
 ## Layout
 
@@ -74,7 +100,7 @@ port from the same variable; `--port` overrides it.
 |---|---|
 | `protocol/SCENE.md` | protocol v2: the JSON every client and the viewer speak |
 | `python/geomcore_viewer/` | client (`viewer.py`), geomcore adapter (`adapt.py`), server (`server.py`, `spawn.py`) |
-| `frontend/` | Vite + TypeScript viewer (Babylon.js 3D, PixiJS 2D); `src/geom/` is the evaluator core |
+| `frontend/` | Vite + TypeScript viewer (Babylon.js 3D, PixiJS 2D); `src/geom/` is the evaluator core, `src/view2d/` the plane view |
 | `clients/rust/` | Rust client (protocol v1 until phase 4 of the v2 plan) |
 | `examples/` | `conics_2d.py`, `quadrics_3d.py` |
 
@@ -84,6 +110,7 @@ port from the same variable; `--port` overrides it.
 python3 -m venv .venv && .venv/bin/pip install pytest
 PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests -q
 cd frontend && npm ci && npm test && npm run build && cd ..
+cd frontend && npx playwright install chromium && npm run e2e && cd ..   # browser tests (port 8797)
 scripts/bundle-frontend.sh          # copy the build into the Python package
 scripts/refresh-fixtures.sh         # re-vendor geomcore's golden fixtures
 ```
PATCH
````

- [ ] **Step 6: Run everything**

Run:
```bash
PYTHONPATH=python python3 -m pytest python/tests -q
cd frontend && npx vitest run && npm run build && npm run e2e
```
Expected: pytest 117 passed and 2 skipped (119 passed with geomcore); vitest 188 passed in 21 files; build "✓ built"; e2e 4 passed.

- [ ] **Step 7: Classroom check (manual, port 8799)**

Start `PYTHONPATH=python python3 -m geomcore_viewer serve --dir frontend/dist --port 8799` in one terminal. In a second one:

```bash
GEOMCORE_VIEWER_URL=http://127.0.0.1:8799 PYTHONPATH=python:../geomcore/geomcore-py python3 examples/conics_2d.py
```

Then:
- zoom in on an intersection, untick "conics", and edit a radius in the script;
- re-run the script;
- check that the picture swaps without a blank frame, the camera stays where it was, "conics" stays hidden, and the header reads "run 2".

Press `P` and read the labels from across the room. Press `T` and check the dark theme. Stop the server with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add frontend/playwright.config.ts frontend/e2e frontend/package.json frontend/package-lock.json .gitignore .github/workflows/ci.yml README.md
git commit -m "e2e: Playwright checks the plane view, edge-to-edge lines, run swaps and keys; CI runs them; README describes the page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
