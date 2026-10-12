# geomcore-viewer v2 — Phase 3: 3D View, (u,v) Pane and pcurve — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the 3D view up to spec §5.3 and add the linked (u,v) pane of §5.4, with the `pcurve` geometry of §4.2 end to end (protocol → Python `view.pcurve` → lifted in 3D → drawn in the pane). The 3D view gets:
- constant-pixel GreasedLine curves clipped in closed form to the view box;
- surfaces tessellated by curvature, translucent when the scene has curves, with isolines and wireframe;
- screen-size point markers, DOM labels, a ground grid with an axis triad;
- perspective/orthographic and snap views;
- hover picking with `t` / `(u, v)` tooltips and the selection highlight.

**Architecture:**
- Everything 3D computes is pure TypeScript, unit-tested in node:
  - `geom/` (box clipping, world-unit sampling, surface grids, pcurve lifting);
  - `view3d/render.ts` (the per-object draw model);
  - `view3d/camera.ts`, `view3d/scene.ts` (camera math, ground);
  - `view3d/pick.ts` (projected picking, tooltips);
  - `viewuv/model.ts` (what the pane draws, seams, wrapping).
- Only `view3d/view.ts` touches Babylon, and only `viewuv/pane.ts` touches the pane's canvas.
- The two exchange hovers through a tiny `HoverLink` (`viewuv/link.ts`).
- Page state stays in `UiState`; it gains `uvPane` and the `U` key.

**Tech Stack:**
- Frontend: TypeScript 5, Vite 6, Babylon.js 8.56 (GreasedLine, thin instances), PixiJS 8 (2D, unchanged), vitest 3 (node; Babylon's `NullEngine` for camera tests), Playwright.
- Python: stdlib-only, pytest, 3.9+.

**Spec:** `docs/superpowers/specs/2026-10-10-viewer-v2-design.md §5.3, §5.4, §4.2 pcurve`. The plan also covers the Phase 3 part of §8 (docs and `examples/pcurve.py`) and the §9 e2e smoke for the quadrics and pcurve scenes.

## Global Constraints

- Python package stays **stdlib-only**, **Python 3.9+**.
- Frontend unit tests run in vitest's **node** environment. Pure modules must import without `document`/`window`. Babylon is allowed in tests only through `NullEngine`.
- Never use port **8765**: an unrelated process holds it on the dev machine. Manual runs use **8799**; the e2e server uses **8797**.
- Never modify `../geomcore`. Importing it read-only through `PYTHONPATH` is fine.
- Do not touch `clients/rust` or the server's `/api/add`: both belong to Phase 4.
- **3D line widths are in pixels**, at any distance:
  - curves 3 px;
  - surface edges and isolines 1 px;
  - extras 1.5 px;
  - points 4.5 px (extra dots 3.5 px);
  - +1.5 px when hovered or selected;
  - ×1.5 in presentation mode.
- **3D chord tolerance** is `WORLD_TOL = 5e-4` × the view box's half-size. Infinite curves are clipped in closed form to the view box (the scene's box × 1.5).
- **Surface opacity** defaults to **0.45** when the scene holds a curve, polyline or pcurve, else **1**. It applies to meshes too, and `style.opacity` wins.
- **Isolines:** `isolines: [nu, nv]`, with `true` meaning 12 × 6. `wire` is lines only, 24 × 12 isolines plus the window's edges.
- **Hover** picks within **8 px**, like the plane view.
- Keys:
  - `U` toggles the (u,v) pane;
  - `2`/`3` also match by `KeyboardEvent.code`, so they work on AZERTY.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands run from the repository root, and every `git apply` patch is relative to it.
  - Python: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests -q`. Expect 125 passed at the end; without geomcore it is 122 passed and 3 skipped.
  - Frontend: `cd frontend && npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run e2e`. Run `npm run e2e` after a build, because it serves `frontend/dist`. If Playwright's bundled chromium is missing, set `PLAYWRIGHT_CHROMIUM` to a chromium binary.
- Baseline on `main` (1a5a085): vitest 204 passed in 21 files, e2e 6 passed, pytest 120 passed.

## Review Focus

The spec does not list these five inputs, but each is likely to hurt a real user. Each line names the owning task's test.

1. **A pcurve whose surface is missing, not a surface, or arrives later.** It must not throw. It draws nothing, the panel flags it, and it draws once the surface arrives. *Tests:*
   - Task 1 `panel.test.ts › names a pcurve's surface, and warns when that surface is missing or not a surface`;
   - Task 5 `render3d.test.ts › lifts a pcurve onto its surface, and draws nothing while the surface is missing`;
   - Task 4 `test_viewer.py › test_pcurve_needs_a_surface_in_the_scene` (Python refuses early).
2. **Curves across a periodic seam.** A helix must wind past u = 2π, a (u,v) circle must stay whole across u = 0, and the pane must cut paths at seams without zero-length slivers. *Tests:*
   - Task 3 `pcurve.test.ts › lets a helix wind past the seam until it leaves the window in v`;
   - Task 3 `pcurve.test.ts › draws a (u, v) circle whole even across the seam u = 0`;
   - Task 10 `uvmodel.test.ts › leaves no zero-length piece when the path ends on a seam`.
3. **Geometry behind a perspective camera while picking.** A projected polyline must be split where it passes behind the eye, and hits on the far run must still map back to the right world point. *Test:* Task 8 `pick3d.test.ts › splits a polyline where it passes behind the camera, and still maps hits on the far run`.
4. **A clockwise (u,v) circle** (`parametrize_on` a circle that faces away from the surface). The frame's z must be −z on both sides of the wire, or the lifted circle runs backwards and `t` is wrong. *Tests:*
   - Task 1 `protocol.test.ts › accepts a clockwise (u, v) circle, whose frame z is -z`;
   - Task 4 `test_adapt.py › test_clockwise_circle2d_gets_a_downward_frame`.
5. **Non-QWERTY keyboards.** On AZERTY, `2`/`3` need Shift, and the unshifted key is `é`/`"`. *Test:* Task 9 `keys.test.ts › finds 2 and 3 by position on layouts where they need Shift (AZERTY)`.

## Rulings Recorded While Planning

Each ruling says what breaks if it is wrong.

- **The protocol is the soft side; Python is strict.**
  - The viewer keeps a pcurve whose surface is missing, draws nothing for it and flags it in the panel. Its surface may arrive in a later upsert.
  - `view.pcurve` refuses a surface that is not already in the scene.
  - *If wrong:* a strict viewer would reject objects that stream in surface-last; a soft Python client would hide typos.
- **pcurves add nothing to the view box.**
  - Their surface already bounds them, and the window would otherwise depend on the curve that is clipped to it (circular).
  - *If wrong:* a polyline pcurve outside the surface window is cut off. That is acceptable, because the window is the surface's.
- **Lift clipping rule.**
  - A (u,v) line or circle is clipped to the window only in the directions that do not wrap: a helix winds round until it leaves the v window.
  - When those directions leave it unbounded, it is clipped to the whole window, one turn. That case is the line v = 3 given by `Circle3D.parametrize_on(cylinder)`.
  - A polyline is drawn whole, and `range` is ignored.
  - *If wrong:* infinite pcurves draw nothing or loop forever. Both cases are tested.
- **`curveRange` is removed.**
  - 3D curves are clipped in closed form to the box (`clipCurveBox`), like the plane view's `clipCurve2D`, and sampled adaptively in world units.
  - *If wrong:* 3D lines fall back to the Phase 1 uniform 256 segments, with visible corners on large circles.
- **Normalized texture coordinates.**
  - The mesh carries (u,v) normalized to [0,1] over its window, and picking maps them back through the grid's window (`surfaceUv`).
  - *If wrong:* Babylon's UV picking returns raw values only for small windows, and hovering a surface shows a wrong (u,v).
- **Isolines are at cell centres** (u₀ + (i + ½)·Δ), not on the window's edges.
  - The edges are drawn separately by `wire`, so isolines never double up with them.
  - *If wrong:* the isoline counts in `[nu, nv]` would be off by one per direction.
- **`wire` is lines only** (no fill). `isolines` keeps the fill.
  - *If wrong:* wireframes hide what is behind them.
- **GreasedLine uses the STANDARD material type, with `sizeAttenuation: true` and width = 2 × pixels**, measured in Babylon 8.56.
  - MATERIAL_TYPE_SIMPLE disposes a shared colour texture with its material and blanks every later line.
  - `visibility` is a length fraction, not an opacity, so translucency goes through `material.alpha`.
  - *If wrong:* lines vanish after the first rebuild, or come out at half or double width.
- **The grid is a backdrop.**
  - Its LineSystem materials get `disableDepthWrite = true` in rendering group 0.
  - Every object and the axes go in group 1, with group 1's depth clear turned off.
  - Surfaces get `zOffset = 1`.
  - *If wrong:* curves lying on z = 0 speckle through the grid. `zOffset` alone did not fix that.
- **3D dashes are in world units:** 3 % / 2 % of the view box's half-size.
  - *If wrong:* the dash pattern swims as the camera moves.
- **The (u,v) pane is an inset of the 3D view only.**
  - It shows when the scene has a pcurve or a surface is selected, and `U` hides or shows it.
  - Its subject is the selected surface, else the selected pcurve's surface, else the first pcurve's surface.
  - *If wrong:* a second full view would need its own layout and keys. That cost is deferred until users ask.
- **Fit is deferred while the 3D pane is hidden** (`fitPending`). This closes the Phase 2 backlog item.
  - *If wrong:* a fit computed on a 0 × 0 canvas has a stale aspect.
- **The (u,v) circle frame z is computed as `x × (P(π/2) − o)` in Python**, not assumed +z.
  - *If wrong:* clockwise circles lift backwards. See Review Focus 4.
- **e2e scenes are files POSTed to `/api/objects`** (`frontend/e2e/scenes/*.json`, written by the examples with `--save`).
  - The tests therefore need no geomcore.
  - *If wrong:* CI needs geomcore installed.
- **geomcore's `docs/viewer.md`** should gain a `pcurve` example. It is left to the user because this plan must not modify `../geomcore`.

## File Structure

```
frontend/src/
  protocol.ts             MOD  parse `pcurve` (surface id + (u,v) line/circle/polyline in z = 0)
  geom/types.ts           MOD  PcurveGeom, UvCurve, isPcurve
  geom/pcurve.ts          NEW  pcurveSurface, pcurveRanges, uvAt, liftPcurve
  geom/clip.ts            MOD  clipCurveBox (3D closed-form clipping), shared range logic with clipCurve2D
  geom/curves.ts          MOD  curveRange removed
  geom/sample.ts          MOD  sampleAdaptive/segmentDistance/dashPolyline generic over 2D and 3D
  geom/surfaces.ts        MOD  periods
  geom/tessellate.ts      MOD  WORLD_TOL, curvePieces, arcSegments, surfaceGrid, tessellateSurface(grid), isoLines, windowEdges
  ui/panel.ts             MOD  pcurve detail and missing-surface warning
  ui/keys.ts, ui/state.ts MOD  U → uvpane, Digit2/Digit3 by code; UiState.uvPane
  view2d/pick.ts          MOD  Hit.line (which polyline was hit)
  camera.ts               DEL  → view3d/camera.ts
  view3d.ts               DEL  → view3d/view.ts
  view3d/render.ts        NEW  objectDraw3D: the per-object draw model (lines, surface, markers, texts, pickables)
  view3d/camera.ts        NEW  cameraScale, SNAPS, fitRadius, orthoExtents, pixelSize
  view3d/scene.ts         NEW  ground: grid lines and axis triad
  view3d/pick.ts          NEW  pickProjected, surfaceUv, describeHit3D
  view3d/view.ts          NEW  View3D (Babylon): meshes, toolbar, labels, hover, highlight, uv cursor
  viewuv/link.ts          NEW  HoverLink
  viewuv/model.ts         NEW  uvSubject, wrapAxis, uvModel, toPane/fromPane, hoverText
  viewuv/pane.ts          NEW  UvPane (canvas inset)
  main.ts, style.css, index.html  MOD wiring
frontend/test/            NEW  pcurve, render3d, camera3d, scene3d, pick3d, link, uvmodel; MOD protocol, panel, clip, eval, sample, tessellate, keys, state; DEL camera
frontend/e2e/view3d.e2e.ts       NEW  quadrics render, toolbar, 3D hover, (u,v) pane, linked hover, surface selection
frontend/e2e/scenes/*.json       NEW  pcurve, quadrics_3d (generated by the examples)
python/geomcore_viewer/adapt.py  MOD  clockwise Circle2D frames, uv_curve
python/geomcore_viewer/viewer.py MOD  Viewer.pcurve
python/tests/                    MOD  test_adapt, test_viewer
examples/pcurve.py               NEW  ring, helix and zigzag on a cylinder
examples/quadrics_3d.py          MOD  --save
README.md, protocol/SCENE.md     MOD  docs
```

---

### Task 1: Protocol: the `pcurve` geometry

`pcurve` stops being reserved. A pcurve has two parts:
- the id of a surface object;
- a (u, v) curve: a `line`, a `circle` or a `polyline` lying in z = 0, where x is u and y is v. 2-component vectors are padded, as for other 2D input.

The parser accepts a clockwise (u,v) circle, whose frame's z is −z. It rejects:
- a missing surface id;
- other curve types;
- curves that leave z = 0.

The panel shows "pcurve on Y". It warns ("no surface Y") while the surface is missing or is not a surface; the warning is styled as a problem.

**Files:**
- Create: `frontend/src/geom/pcurve.ts`
- Modify: `frontend/src/geom/types.ts`, `frontend/src/protocol.ts`, `frontend/src/style.css`, `frontend/src/ui/panel.ts`, `frontend/test/panel.test.ts`, `frontend/test/protocol.test.ts`

**Interfaces:**
- Produces (`geom/types.ts`): `type UvCurve = line | circle | polyline`; `interface PcurveGeom { type: "pcurve"; surface: string; curve: UvCurve }`; `Geom` now includes `PcurveGeom`; `isPcurve(g)`.
- Produces (`geom/pcurve.ts`): `pcurveSurface(g: PcurveGeom, lookup: (id) => Geom | undefined): SurfaceGeom | null`.
- Changes: `ObjectRow` (panel) gains `warn: boolean`: the detail is a problem.

- [ ] **Step 1: Write the failing tests**

Patch `frontend/test/panel.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/panel.test.ts b/frontend/test/panel.test.ts
index 65ab03c..e3534e5 100644
--- a/frontend/test/panel.test.ts
+++ b/frontend/test/panel.test.ts
@@ -53,6 +53,21 @@ describe("panelModel", () => {
     expect(intersections.rows[0]).toMatchObject({ visible: false, shown: false, selected: false });
   });
 
+  it("names a pcurve's surface, and warns when that surface is missing or not a surface", () => {
+    const uv = { type: "line", o: [0, 0, 0], d: [1, 0, 0] };
+    const store = storeOf([
+      obj("Y", { type: "cylinder", frame, r: 2 }, { label: "cyl" }),
+      obj("ok", { type: "pcurve", surface: "Y", curve: uv }),
+      obj("lost", { type: "pcurve", surface: "gone", curve: uv }),
+      obj("odd", { type: "pcurve", surface: "ok", curve: uv }),
+    ]);
+    const rows = panelModel(store, new UiState(null)).groups.flatMap((g) => g.rows);
+    expect(rows.find((r) => r.id === "ok")).toMatchObject({ detail: "pcurve on cyl", warn: false });
+    expect(rows.find((r) => r.id === "lost")).toMatchObject({ detail: "no surface gone", warn: true });
+    expect(rows.find((r) => r.id === "odd")).toMatchObject({ detail: "no surface ok", warn: true });
+    expect(rows.find((r) => r.id === "Y")).toMatchObject({ detail: "cylinder", warn: false });
+  });
+
   it("drops the ungrouped section when every object has a group", () => {
     const model = panelModel(storeOf([scene[0]]), new UiState(null));
     expect(model.groups.map((g) => g.name)).toEqual(["conics"]);
PATCH
````

Patch `frontend/test/protocol.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/protocol.test.ts b/frontend/test/protocol.test.ts
index 9fdb8a1..f62a2cb 100644
--- a/frontend/test/protocol.test.ts
+++ b/frontend/test/protocol.test.ts
@@ -25,11 +25,34 @@ describe("parseObject", () => {
     [{ id: "a", geom: { type: "points", positions: [] } }, "a", "points.positions must not be empty"],
     [{ id: "a", geom: { type: "mesh", vertices: [[0, 0, 0]], indices: [] } }, "a", "mesh.indices must be a non-empty multiple of 3"],
     [{ id: "a", geom: { type: "constructor" } }, "a", 'unknown type "constructor"'],
+    [{ id: "a", geom: { type: "pcurve", curve: { type: "line", o: [0, 0], d: [1, 0] } } }, "a", "pcurve.surface must be an object id"],
+    [{ id: "a", geom: { type: "pcurve", surface: "Y", curve: { type: "ellipse", frame, a: 2, b: 1 } } }, "a", "pcurve.curve must be a line, circle or polyline"],
+    [{ id: "a", geom: { type: "pcurve", surface: "Y" } }, "a", "pcurve.curve must be a line, circle or polyline"],
+    [{ id: "a", geom: { type: "pcurve", surface: "Y", curve: { type: "circle", frame, r: 0 } } }, "a", "pcurve.circle.r must be positive"],
+    [{ id: "a", geom: { type: "pcurve", surface: "Y", curve: { type: "line", o: [0, 0, 1], d: [1, 0, 0] } } }, "a", "pcurve.curve must lie in z = 0 (x is u, y is v)"],
   ])("rejects %j", (raw, id, message) => {
     expect(parseObject(raw)).toEqual({ problem: { id, message } });
   });
 });
 
+describe("pcurve", () => {
+  it("accepts a (u, v) line, circle or polyline and pads 2D vectors", () => {
+    const line = parseObject({ id: "c", geom: { type: "pcurve", surface: "Y", curve: { type: "line", o: [0, 3], d: [1, 0], range: [0, 6] } } });
+    expect(line).toEqual({
+      object: { id: "c", geom: { type: "pcurve", surface: "Y", curve: { type: "line", o: [0, 3, 0], d: [1, 0, 0], range: [0, 6] } } },
+    });
+    const circle = parseObject({ id: "d", geom: { type: "pcurve", surface: "P", curve: { type: "circle", frame, r: 1 } } });
+    expect("object" in circle && circle.object.geom).toMatchObject({ type: "pcurve", curve: { type: "circle", r: 1 } });
+    const poly = parseObject({ id: "e", geom: { type: "pcurve", surface: "P", curve: { type: "polyline", points: [[0, 0], [1, 2]] } } });
+    expect("object" in poly && poly.object.geom).toEqual({ type: "pcurve", surface: "P", curve: { type: "polyline", points: [[0, 0, 0], [1, 2, 0]] } });
+  });
+
+  it("accepts a clockwise (u, v) circle, whose frame z is -z", () => {
+    const cw = { ...frame, y: [0, -1, 0], z: [0, 0, -1] };
+    expect("object" in parseObject({ id: "c", geom: { type: "pcurve", surface: "Y", curve: { type: "circle", frame: cw, r: 1 } } })).toBe(true);
+  });
+});
+
 describe("parseDoc", () => {
   it("migrates v1 entities", () => {
     const { doc, problems } = parseDoc({
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/panel.test.ts test/protocol.test.ts)
````

Expected: `Test Files 2 failed (2)`, `Tests 8 failed | 22 passed (30)`: the parser still rejects `pcurve`, and the panel has no pcurve detail.

- [ ] **Step 3: Implement**

Create `frontend/src/geom/pcurve.ts`:

````ts
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
````

Patch `frontend/src/geom/types.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/types.ts b/frontend/src/geom/types.ts
index d76833e..ece3f28 100644
--- a/frontend/src/geom/types.ts
+++ b/frontend/src/geom/types.ts
@@ -30,10 +30,22 @@ export type MarkerGeom =
   | { type: "text"; at: Vec3; text: string }
   | { type: "note"; text: string; level?: "info" | "warn" };
 
-export type Geom = CurveGeom | SurfaceGeom | MarkerGeom;
+/** A curve in a surface's (u, v) plane: a line, circle or polyline in z = 0, x read as u and y as v. */
+export type UvCurve = Extract<CurveGeom, { type: "line" | "circle" }> | Extract<MarkerGeom, { type: "polyline" }>;
+
+/** A curve given by the parameters of the surface it lies on (protocol `pcurve`), drawn at S(curve(t)). */
+export interface PcurveGeom {
+  type: "pcurve";
+  /** The surface's object id. */
+  surface: string;
+  curve: UvCurve;
+}
+
+export type Geom = CurveGeom | SurfaceGeom | MarkerGeom | PcurveGeom;
 
 export const CURVE_TYPES: ReadonlySet<string> = new Set(["line", "circle", "ellipse", "parabola", "hyperbola"]);
 export const SURFACE_TYPES: ReadonlySet<string> = new Set(["plane", "cylinder", "cone", "sphere", "torus"]);
 
 export const isCurve = (g: Geom): g is CurveGeom => CURVE_TYPES.has(g.type);
 export const isSurface = (g: Geom): g is SurfaceGeom => SURFACE_TYPES.has(g.type);
+export const isPcurve = (g: Geom): g is PcurveGeom => g.type === "pcurve";
PATCH
````

Patch `frontend/src/protocol.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/protocol.ts b/frontend/src/protocol.ts
index db87a5b..9f9854d 100644
--- a/frontend/src/protocol.ts
+++ b/frontend/src/protocol.ts
@@ -1,5 +1,6 @@
 // Scene protocol v2: types, validation and v1 migration. Mirrors protocol/SCENE.md.
-import { CURVE_TYPES, Geom, SURFACE_TYPES } from "./geom/types";
+import { inPlaneZ0 } from "./geom/planar";
+import { CURVE_TYPES, Geom, SURFACE_TYPES, UvCurve } from "./geom/types";
 import type { Vec3 } from "./geom/vec";
 
 export const PROTOCOL = 2;
@@ -66,6 +67,7 @@ const FIELDS: Record<string, Record<string, FieldKind>> = {
   note: { text: "str" },
 };
 const POSITIVE = ["r", "a", "b", "R"];
+const UV_CURVES: ReadonlySet<string> = new Set(["line", "circle", "polyline"]);
 const VIEWS: ReadonlySet<string> = new Set(["auto", "2d", "3d"]);
 
 const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
@@ -110,6 +112,48 @@ function validWindow(w: unknown): boolean {
   return r !== undefined && (r.u === undefined || isRange(r.u)) && (r.v === undefined || isRange(r.v));
 }
 
+/** Validate one geometry (its `type` is a string): the normalized geometry, or why it is rejected. */
+function parseGeom(g: Record<string, unknown>): Geom | string {
+  const type = g.type as string;
+  if (type === "pcurve") return parsePcurve(g);
+  const fields = Object.prototype.hasOwnProperty.call(FIELDS, type) ? FIELDS[type] : undefined;
+  if (!fields) return `unknown type "${type}"`;
+  const geom: Record<string, unknown> = { ...g };
+  for (const [key, kind] of Object.entries(fields)) {
+    const value = normalize(g[key], kind);
+    if (value === null) return `${type}.${key} is missing or malformed`;
+    geom[key] = value;
+  }
+  for (const key of POSITIVE) if (key in fields && (geom[key] as number) <= 0) return `${type}.${key} must be positive`;
+  if (type === "parabola" && geom.f === 0) return "parabola.f must be non-zero";
+  if (type === "line" && Math.hypot(...(geom.d as Vec3)) === 0) return "line.d must be non-zero";
+  if (type === "polyline" && (geom.points as Vec3[]).length < 2) return "polyline.points needs at least 2 points";
+  if (type === "points" && (geom.positions as Vec3[]).length === 0) return "points.positions must not be empty";
+  if (type === "mesh") {
+    if ((geom.indices as number[]).length === 0) return "mesh.indices must be a non-empty multiple of 3";
+    const n = (geom.vertices as Vec3[]).length;
+    const idx = geom.indices as number[];
+    if (idx.length % 3 !== 0 || idx.some((i) => i >= n)) return "mesh.indices must be triangles indexing vertices";
+  }
+  if (SURFACE_TYPES.has(type) && g.window !== undefined && !validWindow(g.window)) {
+    return `${type}.window must be {u?: [a, b], v?: [a, b]}`;
+  }
+  if (CURVE_TYPES.has(type) && g.range !== undefined && !isRange(g.range)) return `${type}.range must be [t0, t1]`;
+  return geom as unknown as Geom;
+}
+
+/** A pcurve: its surface's object id, and a line, circle or polyline in z = 0 holding (u, v). */
+function parsePcurve(g: Record<string, unknown>): Geom | string {
+  const surface = str(g.surface);
+  if (surface === undefined) return "pcurve.surface must be an object id";
+  const c = record(g.curve);
+  if (!c || typeof c.type !== "string" || !UV_CURVES.has(c.type)) return "pcurve.curve must be a line, circle or polyline";
+  const curve = parseGeom(c);
+  if (typeof curve === "string") return `pcurve.${curve}`;
+  if (!inPlaneZ0(curve)) return "pcurve.curve must lie in z = 0 (x is u, y is v)";
+  return { type: "pcurve", surface, curve: curve as UvCurve };
+}
+
 /** Validate one object (v1 entities are migrated first). Never throws. */
 export function parseObject(raw: unknown): { object: SceneObject } | { problem: Problem } {
   const r = record(raw);
@@ -120,33 +164,9 @@ export function parseObject(raw: unknown): { object: SceneObject } | { problem:
   if (id === "?") return fail("missing string id");
   const g = record(r.geom);
   if (!g || typeof g.type !== "string") return fail("missing geom.type");
-  const fields = Object.prototype.hasOwnProperty.call(FIELDS, g.type) ? FIELDS[g.type] : undefined;
-  if (!fields) return fail(`unknown type "${g.type}"`);
-  const geom: Record<string, unknown> = { ...g };
-  for (const [key, kind] of Object.entries(fields)) {
-    const value = normalize(g[key], kind);
-    if (value === null) return fail(`${g.type}.${key} is missing or malformed`);
-    geom[key] = value;
-  }
-  for (const key of POSITIVE) if (key in fields && (geom[key] as number) <= 0) return fail(`${g.type}.${key} must be positive`);
-  if (g.type === "parabola" && geom.f === 0) return fail("parabola.f must be non-zero");
-  if (g.type === "line" && Math.hypot(...(geom.d as Vec3)) === 0) return fail("line.d must be non-zero");
-  if (g.type === "polyline" && (geom.points as Vec3[]).length < 2) return fail("polyline.points needs at least 2 points");
-  if (g.type === "points" && (geom.positions as Vec3[]).length === 0) return fail("points.positions must not be empty");
-  if (g.type === "mesh") {
-    if ((geom.indices as number[]).length === 0) return fail("mesh.indices must be a non-empty multiple of 3");
-    const n = (geom.vertices as Vec3[]).length;
-    const idx = geom.indices as number[];
-    if (idx.length % 3 !== 0 || idx.some((i) => i >= n)) return fail("mesh.indices must be triangles indexing vertices");
-  }
-  if (SURFACE_TYPES.has(g.type) && g.window !== undefined && !validWindow(g.window)) {
-    return fail(`${g.type}.window must be {u?: [a, b], v?: [a, b]}`);
-  }
-  if (CURVE_TYPES.has(g.type) && g.range !== undefined) {
-    const range = g.range;
-    if (!Array.isArray(range) || range.length !== 2 || !range.every(finite)) return fail(`${g.type}.range must be [t0, t1]`);
-  }
-  const object: SceneObject = { id, geom: geom as unknown as Geom };
+  const geom = parseGeom(g);
+  if (typeof geom === "string") return fail(geom);
+  const object: SceneObject = { id, geom };
   const label = str(r.label);
   if (label) object.label = label;
   const group = str(r.group);
PATCH
````

Patch `frontend/src/style.css` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/style.css b/frontend/src/style.css
index aa2d8c7..1da851c 100644
--- a/frontend/src/style.css
+++ b/frontend/src/style.css
@@ -68,6 +68,7 @@ aside li.object.hidden .name, aside li.object.hidden .swatch { opacity: 0.4; }
 aside .swatch { flex: none; width: 0.8em; height: 0.8em; border-radius: 2px; }
 aside .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
 aside .detail { margin-left: auto; color: var(--muted); font-size: 0.75rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
+aside .detail.warn { color: var(--warn); }
 aside li.group { margin-top: 0.4rem; }
 aside .group-head { display: flex; gap: 0.35rem; align-items: center; font-weight: 600; padding: 0.15rem 0; }
 aside .group > ul { padding-left: 1.1rem; }
PATCH
````

Patch `frontend/src/ui/panel.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/ui/panel.ts b/frontend/src/ui/panel.ts
index b4275cb..2b98ef1 100644
--- a/frontend/src/ui/panel.ts
+++ b/frontend/src/ui/panel.ts
@@ -1,4 +1,5 @@
 import { FrameScheduler } from "../frame";
+import { pcurveSurface } from "../geom/pcurve";
 import type { Problem, SceneObject } from "../protocol";
 import type { Store } from "../store";
 import { colorOf } from "./colors";
@@ -9,8 +10,10 @@ export interface ObjectRow {
   kind: "object";
   id: string;
   label: string;
-  /** Coordinates for a point, "N points", else the geometry type. */
+  /** Coordinates for a point, "N points", a pcurve's surface, else the geometry type. */
   detail: string;
+  /** The detail is a problem (a pcurve whose surface is missing). */
+  warn: boolean;
   color: string;
   /** The object's own checkbox. */
   visible: boolean;
@@ -39,11 +42,16 @@ export interface PanelModel {
   problems: Problem[];
 }
 
-function detailOf(o: SceneObject): string {
+function detailOf(o: SceneObject, objects: Map<string, SceneObject>): { detail: string; warn: boolean } {
   const g = o.geom;
-  if (g.type === "point") return fmtPoint(g.p);
-  if (g.type === "points") return `${g.positions.length} points`;
-  return g.type;
+  if (g.type === "point") return { detail: fmtPoint(g.p), warn: false };
+  if (g.type === "points") return { detail: `${g.positions.length} points`, warn: false };
+  if (g.type === "pcurve") {
+    if (!pcurveSurface(g, (id) => objects.get(id)?.geom)) return { detail: `no surface ${g.surface}`, warn: true };
+    const surface = objects.get(g.surface)!;
+    return { detail: `pcurve on ${surface.label ?? surface.id}`, warn: false };
+  }
+  return { detail: g.type, warn: false };
 }
 
 /** What the panel shows, from the scene and the UI state (pure, so it is unit-tested). */
@@ -65,7 +73,7 @@ export function panelModel(store: Store, ui: UiState): PanelModel {
       kind: "object",
       id: o.id,
       label: o.label ?? o.id,
-      detail: detailOf(o),
+      ...detailOf(o, store.objects),
       color: colorOf(o),
       visible: !ui.hiddenIds.has(o.id),
       shown: ui.isVisible(o),
@@ -107,7 +115,7 @@ export function mountPanel(store: Store, ui: UiState, list: HTMLElement): void {
       checkbox(row.visible, `show ${row.label}`, (on) => ui.setObjectVisible(row.id, on)),
       swatch,
       el("span", "name", row.label),
-      el("span", "detail", row.detail),
+      el("span", row.warn ? "detail warn" : "detail", row.detail),
     );
     li.addEventListener("click", () => ui.select(ui.selected === row.id ? null : row.id));
     return li;
PATCH
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/panel.test.ts test/protocol.test.ts)
(cd frontend && npx vitest run && npx tsc --noEmit)
````

Expected: 30 passed (30); vitest 212 passed in 21 files; `tsc` prints nothing.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/src/geom/pcurve.ts frontend/src/geom/types.ts frontend/src/protocol.ts frontend/src/style.css frontend/src/ui/panel.ts frontend/test/panel.test.ts frontend/test/protocol.test.ts
git commit -m "protocol: pcurve (a surface id and a (u, v) line, circle or polyline) parses; the panel names its surface or warns that it is missing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 2: Closed-form 3D clipping and world-unit sampling

Phase 1 drew every 3D curve with 256 uniform segments over `curveRange`, a conservative parameter interval that contains the view box. This task removes `curveRange`:
- `clipCurveBox` finds, in closed form, the parameter intervals where a curve is inside the axis-aligned view box. It is the 3D sibling of `clipCurve2D`, and both share the root-finding.
- `curvePieces` samples each interval adaptively to `WORLD_TOL × halfSize(box)`.
- `sampleAdaptive` and `segmentDistance` become generic over the point dimension.

The old 3D view switches to `curvePieces` (one line changed) so it keeps building.

**Files:**
- Modify: `frontend/src/geom/clip.ts`, `frontend/src/geom/curves.ts`, `frontend/src/geom/sample.ts`, `frontend/src/geom/tessellate.ts`, `frontend/src/view3d.ts`, `frontend/test/clip.test.ts`, `frontend/test/eval.test.ts`, `frontend/test/sample.test.ts`, `frontend/test/tessellate.test.ts`

**Interfaces:**
- Produces:
  - `clipCurveBox(g: CurveGeom, box: Box): Range[]`;
  - `interface Sampled<P extends number[] = Vec2> { pts: P[]; ts: number[] }`;
  - `sampleAdaptive<P>(f: (t) => P, t0, t1, tol, maxPoints?)`;
  - `segmentDistance(p, a, b)` over any dimension;
  - `WORLD_TOL = 5e-4`;
  - `curvePieces(g, box, tol?): Sampled<Vec3>[]`.
- Removes: `curveRange`, `tessellateCurve`.

- [ ] **Step 1: Write the failing tests**

Patch `frontend/test/clip.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/clip.test.ts b/frontend/test/clip.test.ts
index 681554d..c3ff3c5 100644
--- a/frontend/test/clip.test.ts
+++ b/frontend/test/clip.test.ts
@@ -1,8 +1,8 @@
 import { describe, expect, it } from "vitest";
-import { Rect, clipCurve2D, expandRect, quadraticRoots } from "../src/geom/clip";
+import { Rect, clipCurve2D, clipCurveBox, expandRect, quadraticRoots } from "../src/geom/clip";
 import { evalCurve } from "../src/geom/curves";
 import type { CurveGeom, Range } from "../src/geom/types";
-import type { Frame, Vec3 } from "../src/geom/vec";
+import type { Box, Frame, Vec3 } from "../src/geom/vec";
 
 const TAU = 2 * Math.PI;
 const R = (xmin: number, xmax: number, ymin: number, ymax: number): Rect => ({ xmin, xmax, ymin, ymax });
@@ -141,3 +141,28 @@ describe("clipCurve2D", () => {
     }
   });
 });
+
+describe("clipCurveBox", () => {
+  const box: Box = { min: [-1, -2, -3], max: [1, 2, 3] };
+  const tilted: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0.6, 0.8], z: [0, -0.8, 0.6] };
+
+  it("clips an infinite line to the box faces it crosses", () => {
+    expectRanges(clipCurveBox({ type: "line", o: [0, 0, 0], d: [0, 0, 1] }, box), [[-3, 3]]);
+    expectRanges(clipCurveBox({ type: "line", o: [0, 0, 0], d: [1, 1, 1] }, box), [[-1, 1]]);
+  });
+
+  it("returns nothing for a line that passes above the box", () => {
+    expect(clipCurveBox({ type: "line", o: [0, 0, 4], d: [1, 0, 0] }, box)).toEqual([]);
+  });
+
+  it("cuts a tilted circle where it leaves through the x faces", () => {
+    // P(t) = (2 cos t, 1.2 sin t, 1.6 sin t): inside |x| ≤ 1 only, so around t = ±π/2.
+    const ranges = clipCurveBox({ type: "circle", frame: tilted, r: 2 }, box);
+    expectRanges(ranges, [[Math.PI / 3, (2 * Math.PI) / 3], [(4 * Math.PI) / 3, (5 * Math.PI) / 3]]);
+  });
+
+  it("clips a parabola standing in a vertical plane by its height", () => {
+    const g: CurveGeom = { type: "parabola", frame: { o: [0, 0, -3], x: [0, 0, 1], y: [1, 0, 0], z: [0, 1, 0] }, f: 0.25 };
+    expectRanges(clipCurveBox(g, { min: [-10, -1, -3], max: [10, 1, 1] }), [[-2, 2]]); // z = t² − 3 ≤ 1
+  });
+});
PATCH
````

Patch `frontend/test/eval.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/eval.test.ts b/frontend/test/eval.test.ts
index af14b8e..89061a2 100644
--- a/frontend/test/eval.test.ts
+++ b/frontend/test/eval.test.ts
@@ -1,10 +1,10 @@
 import { describe, expect, it } from "vitest";
 import curves from "./fixtures/curves_analytic.json";
 import surfaces from "./fixtures/surfaces_analytic.json";
-import { curveRange, evalCurve } from "../src/geom/curves";
+import { evalCurve } from "../src/geom/curves";
 import { evalSurface, surfaceWindow } from "../src/geom/surfaces";
 import type { CurveGeom, SurfaceGeom } from "../src/geom/types";
-import { Box, Frame, Vec3, norm, sub } from "../src/geom/vec";
+import { Frame, Vec3, norm, sub } from "../src/geom/vec";
 
 type FxFrame = { origin: Vec3; x_dir: Vec3; y_dir: Vec3; z_dir: Vec3 };
 type CurveSample = { u: number; point: Vec3 };
@@ -48,30 +48,6 @@ describe("evalSurface matches geomcore goldens", () => {
 });
 
 const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
-const unitBox: Box = { min: [-1, -1, -1], max: [1, 1, 1] };
-const inBox = (p: Vec3, b: Box) => p.every((c, i) => c >= b.min[i] && c <= b.max[i]);
-
-describe("curveRange", () => {
-  it("covers a box far from a line's origin", () => {
-    const [t0, t1] = curveRange({ type: "line", o: [100, 0, 0], d: [1, 0, 0] }, unitBox);
-    expect(t0).toBeLessThanOrEqual(-101);
-    expect(t1).toBeGreaterThanOrEqual(-99);
-  });
-
-  it.each<CurveGeom>([
-    { type: "parabola", frame: world, f: 0.25 },
-    { type: "hyperbola", frame: { ...world, o: [-1.5, 0, 0] }, a: 1, b: 0.5 },
-  ])("leaves the box just outside its range (%#)", (g) => {
-    const [t0, t1] = curveRange(g, unitBox);
-    expect(inBox(evalCurve(g, t1 * 1.01 + 1e-6), unitBox)).toBe(false);
-    expect(inBox(evalCurve(g, t0 * 1.01 - 1e-6), unitBox)).toBe(false);
-  });
-
-  it("uses full periods and explicit ranges", () => {
-    expect(curveRange({ type: "circle", frame: world, r: 1 }, unitBox)).toEqual([0, 2 * Math.PI]);
-    expect(curveRange({ type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [2, 3] }, unitBox)).toEqual([2, 3]);
-  });
-});
 
 describe("surfaceWindow", () => {
   it("fills full periods and flags assumed infinite directions", () => {
PATCH
````

Patch `frontend/test/sample.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/sample.test.ts b/frontend/test/sample.test.ts
index 08d5944..89af9f9 100644
--- a/frontend/test/sample.test.ts
+++ b/frontend/test/sample.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import { dashPolyline, sampleAdaptive, segmentDistance } from "../src/geom/sample";
-import type { Vec2 } from "../src/geom/vec";
+import type { Vec2, Vec3 } from "../src/geom/vec";
 
 const TAU = 2 * Math.PI;
 const circle = (r: number) => (t: number): Vec2 => [r * Math.cos(t), r * Math.sin(t)];
@@ -11,6 +11,10 @@ describe("segmentDistance", () => {
     expect(segmentDistance([13, 4], [0, 0], [10, 0])).toBe(5);
     expect(segmentDistance([1, 1], [0, 0], [0, 0])).toBeCloseTo(Math.SQRT2, 12);
   });
+
+  it("works in 3D", () => {
+    expect(segmentDistance([5, 3, 4], [0, 0, 0], [10, 0, 0])).toBe(5);
+  });
 });
 
 describe("sampleAdaptive", () => {
@@ -47,6 +51,18 @@ describe("sampleAdaptive", () => {
   });
 });
 
+describe("sampleAdaptive in world units", () => {
+  it("keeps a 3D helix within the tolerance", () => {
+    const f = (t: number): Vec3 => [Math.cos(t), Math.sin(t), 0.2 * t];
+    const { pts, ts } = sampleAdaptive(f, 0, 4 * TAU, 1e-3);
+    for (let i = 0; i + 1 < pts.length; i++) {
+      const p = f((ts[i] + ts[i + 1]) / 2);
+      expect(segmentDistance(p, pts[i], pts[i + 1])).toBeLessThanOrEqual(1e-3 + 1e-12);
+    }
+    expect(pts[pts.length - 1]).toEqual(f(4 * TAU));
+  });
+});
+
 describe("dashPolyline", () => {
   it("cuts a straight line into dashes of the given length", () => {
     const dashes = dashPolyline([[0, 0], [100, 0]], 6, 4);
PATCH
````

Patch `frontend/test/tessellate.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/tessellate.test.ts b/frontend/test/tessellate.test.ts
index 854eb45..ca9c69b 100644
--- a/frontend/test/tessellate.test.ts
+++ b/frontend/test/tessellate.test.ts
@@ -1,5 +1,7 @@
 import { describe, expect, it } from "vitest";
-import { arrowPolylines, tessellateCurve, tessellateSurface } from "../src/geom/tessellate";
+import { segmentDistance } from "../src/geom/sample";
+import { arrowPolylines, curvePieces, tessellateSurface } from "../src/geom/tessellate";
+import { evalCurve } from "../src/geom/curves";
 import { halfSize, sameBox, sceneBounds, viewBox } from "../src/geom/bounds";
 import { inPlaneZ0 } from "../src/geom/planar";
 import type { Geom } from "../src/geom/types";
@@ -8,18 +10,28 @@ import { Frame } from "../src/geom/vec";
 const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
 const tilted: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };
 
-describe("tessellateCurve", () => {
-  it("samples a closed circle from t=0 to 2π", () => {
-    const pts = tessellateCurve({ type: "circle", frame: world, r: 2 }, viewBox([]), 8);
-    expect(pts).toHaveLength(9);
-    expect(pts[0][0]).toBeCloseTo(2);
-    expect(pts[8][0]).toBeCloseTo(2);
+describe("curvePieces", () => {
+  it("draws a closed circle once round, from t = 0 to 2π, within the tolerance", () => {
+    const g = { type: "circle", frame: world, r: 2 } as const;
+    const [piece, ...rest] = curvePieces(g, viewBox([]));
+    expect(rest).toEqual([]);
+    expect(piece.ts[0]).toBe(0);
+    expect(piece.ts[piece.ts.length - 1]).toBeCloseTo(2 * Math.PI, 12);
+    const tol = 5e-4 * 5; // WORLD_TOL × the half-size of the ±5 box
+    for (let i = 0; i + 1 < piece.pts.length; i++) {
+      const p = evalCurve(g, (piece.ts[i] + piece.ts[i + 1]) / 2);
+      expect(segmentDistance(p, piece.pts[i], piece.pts[i + 1])).toBeLessThanOrEqual(tol + 1e-12);
+    }
   });
 
-  it("extends a line across the whole view box", () => {
-    const pts = tessellateCurve({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }, viewBox([]), 4);
-    expect(pts[0][0]).toBeLessThanOrEqual(-5);
-    expect(pts[4][0]).toBeGreaterThanOrEqual(5);
+  it("runs an infinite line from face to face of the view box", () => {
+    const [piece] = curvePieces({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }, viewBox([]));
+    expect(piece.pts[0][0]).toBeCloseTo(-5, 9);
+    expect(piece.pts[piece.pts.length - 1][0]).toBeCloseTo(5, 9);
+  });
+
+  it("gives nothing for a line outside the box", () => {
+    expect(curvePieces({ type: "line", o: [0, 0, 9], d: [1, 0, 0] }, viewBox([]))).toEqual([]);
   });
 });
 
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/clip.test.ts test/eval.test.ts test/sample.test.ts test/tessellate.test.ts)
````

Expected: `Test Files 3 failed | 1 passed (4)`, `Tests 8 failed | 61 passed (69)`: `clipCurveBox` and `curvePieces` are not functions, and `segmentDistance` is 2D only.

- [ ] **Step 3: Implement**

Patch `frontend/src/geom/clip.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/clip.ts b/frontend/src/geom/clip.ts
index ca5d4ec..deb9a26 100644
--- a/frontend/src/geom/clip.ts
+++ b/frontend/src/geom/clip.ts
@@ -1,6 +1,6 @@
 import { evalCurve } from "./curves";
 import type { CurveGeom, Range } from "./types";
-import type { Vec3 } from "./vec";
+import type { Box, Vec3 } from "./vec";
 
 const TAU = 2 * Math.PI;
 
@@ -42,8 +42,10 @@ function trigRoots(A: number, B: number, m: number, lo: number, hi: number): num
   return out;
 }
 
-/** Parameters where coordinate k (0 = x, 1 = y) of the curve equals c. */
-function crossings(g: CurveGeom, k: 0 | 1, c: number, lo: number, hi: number): number[] {
+type Axis = 0 | 1 | 2;
+
+/** Parameters where coordinate k (0 = x, 1 = y, 2 = z) of the curve equals c. */
+function crossings(g: CurveGeom, k: Axis, c: number, lo: number, hi: number): number[] {
   switch (g.type) {
     case "line":
       return g.d[k] === 0 ? [] : [(c - g.o[k]) / g.d[k]];
@@ -73,33 +75,45 @@ function domain(g: CurveGeom): Range {
   return closed ? [0, TAU] : [-Infinity, Infinity];
 }
 
-const inside = (r: Rect, p: Vec3): boolean => p[0] >= r.xmin && p[0] <= r.xmax && p[1] >= r.ymin && p[1] <= r.ymax;
+/** The region lo ≤ P[axis] ≤ hi; a rectangle is two slabs, a box three. */
+type Slab = [axis: Axis, lo: number, hi: number];
 
 /**
- * Parameter intervals of `g` whose points lie inside `rect`, increasing and disjoint.
- * The curve can only enter or leave the rectangle where it crosses one of its four edge
- * lines, so between consecutive crossings it is entirely in or out and a midpoint test
+ * Parameter intervals of `g` whose points lie inside every slab, increasing and disjoint.
+ * The curve can only enter or leave the region where it crosses one of the slabs' bounding
+ * planes, so between consecutive crossings it is entirely in or out and a midpoint test
  * decides. The unbounded pieces of an infinite curve, before the first crossing and after
  * the last one, are outside.
  */
-export function clipCurve2D(g: CurveGeom, rect: Rect): Range[] {
+function clipToSlabs(g: CurveGeom, slabs: Slab[]): Range[] {
   const [lo, hi] = domain(g);
   const cuts = new Set<number>();
-  for (const k of [0, 1] as const) {
-    for (const c of k === 0 ? [rect.xmin, rect.xmax] : [rect.ymin, rect.ymax]) {
+  for (const [k, a, b] of slabs) {
+    for (const c of [a, b]) {
       for (const t of crossings(g, k, c, lo, hi)) if (Number.isFinite(t) && t > lo && t < hi) cuts.add(t);
     }
   }
+  const inside = (p: Vec3) => slabs.every(([k, a, b]) => p[k] >= a && p[k] <= b);
   const bounds = [lo, ...[...cuts].sort((a, b) => a - b), hi];
   const out: Range[] = [];
   for (let i = 0; i + 1 < bounds.length; i++) {
     const a = bounds[i];
     const b = bounds[i + 1];
     if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
-    if (!inside(rect, evalCurve(g, (a + b) / 2))) continue;
+    if (!inside(evalCurve(g, (a + b) / 2))) continue;
     const last = out[out.length - 1];
     if (last && last[1] === a) last[1] = b;
     else out.push([a, b]);
   }
   return out;
 }
+
+/** Parameter intervals of `g` whose points lie inside `rect` (x and y only), increasing and disjoint. */
+export function clipCurve2D(g: CurveGeom, rect: Rect): Range[] {
+  return clipToSlabs(g, [[0, rect.xmin, rect.xmax], [1, rect.ymin, rect.ymax]]);
+}
+
+/** Parameter intervals of `g` whose points lie inside the 3D `box`, increasing and disjoint. */
+export function clipCurveBox(g: CurveGeom, box: Box): Range[] {
+  return clipToSlabs(g, [0, 1, 2].map((k) => [k as Axis, box.min[k], box.max[k]]));
+}
PATCH
````

Patch `frontend/src/geom/curves.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/curves.ts b/frontend/src/geom/curves.ts
index c44e01e..9e38b46 100644
--- a/frontend/src/geom/curves.ts
+++ b/frontend/src/geom/curves.ts
@@ -1,7 +1,5 @@
-import type { CurveGeom, Range } from "./types";
-import { Box, Vec3, add, dot, inFrame, norm, scale, sub } from "./vec";
-
-const TAU = 2 * Math.PI;
+import type { CurveGeom } from "./types";
+import { Vec3, add, inFrame, scale } from "./vec";
 
 /** Point at parameter `t` — formulas identical to geomcore (protocol/SCENE.md). */
 export function evalCurve(g: CurveGeom, t: number): Vec3 {
@@ -18,26 +16,3 @@ export function evalCurve(g: CurveGeom, t: number): Vec3 {
       return inFrame(g.frame, g.a * Math.cosh(t), g.b * Math.sinh(t));
   }
 }
-
-/**
- * Parameter interval to draw: the explicit `range`, one full period for
- * closed curves, or — for infinite curves — an interval guaranteed to
- * contain every parameter whose point lies in `box` (the box sits inside a
- * ball of radius `reach` around the curve origin, and each bound below
- * inverts a lower bound on |P(t) − o|).
- */
-export function curveRange(g: CurveGeom, box: Box): Range {
-  if (g.range) return g.range;
-  if (g.type === "circle" || g.type === "ellipse") return [0, TAU];
-  const center = scale(add(box.min, box.max), 0.5);
-  const radius = norm(sub(box.max, box.min)) / 2;
-  if (g.type === "line") {
-    const speed = norm(g.d);
-    const tc = dot(sub(center, g.o), g.d) / (speed * speed);
-    return [tc - radius / speed, tc + radius / speed];
-  }
-  const reach = norm(sub(center, g.frame.o)) + radius;
-  if (g.type === "parabola") return [-reach, reach]; // |P − o| ≥ |t|
-  const t = Math.asinh(reach / Math.max(g.a, g.b)); // |P − o| ≥ max(a, b)·sinh|t|
-  return [-t, t];
-}
PATCH
````

Patch `frontend/src/geom/sample.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/sample.ts b/frontend/src/geom/sample.ts
index 5aa74db..810b61f 100644
--- a/frontend/src/geom/sample.ts
+++ b/frontend/src/geom/sample.ts
@@ -1,7 +1,8 @@
 import type { Vec2 } from "./vec";
 
-export interface Sampled {
-  pts: Vec2[];
+/** A sampled curve, in screen pixels (Vec2, the default) or world units (Vec3). */
+export interface Sampled<P extends number[] = Vec2> {
+  pts: P[];
   /** The parameter of every point (for tooltips: hover → t). */
   ts: number[];
 }
@@ -9,26 +10,41 @@ export interface Sampled {
 const SEED_SEGMENTS = 16;
 const MAX_DEPTH = 20;
 
-/** Distance from `p` to the segment [a, b]. */
-export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
-  const dx = b[0] - a[0];
-  const dy = b[1] - a[1];
-  const len2 = dx * dx + dy * dy;
-  const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
-  return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy);
+/** Distance from `p` to the segment [a, b], in 2D or 3D. */
+export function segmentDistance(p: number[], a: number[], b: number[]): number {
+  let len2 = 0;
+  let along = 0;
+  for (let i = 0; i < p.length; i++) {
+    const d = b[i] - a[i];
+    len2 += d * d;
+    along += (p[i] - a[i]) * d;
+  }
+  const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, along / len2));
+  let dist2 = 0;
+  for (let i = 0; i < p.length; i++) {
+    const e = p[i] - a[i] - s * (b[i] - a[i]);
+    dist2 += e * e;
+  }
+  return Math.sqrt(dist2);
 }
 
 /**
- * Screen-space polyline of `f` over [t0, t1]: 16 even segments, each halved until the
- * curve's midpoint is within `tol` pixels of the chord, with at most `maxPoints` points in
- * all (spec §5.2: chord error ≤ 0.25 px, segments capped). Conics have no inflection, so
- * the midpoint test bounds the whole arc.
+ * Polyline of `f` over [t0, t1]: 16 even segments, each halved until the curve's midpoint
+ * is within `tol` of the chord, with at most `maxPoints` points in all. The plane view
+ * samples in screen pixels (spec §5.2: chord error ≤ 0.25 px, segments capped), the 3D view
+ * in world units. Conics have no inflection, so the midpoint test bounds the whole arc.
  */
-export function sampleAdaptive(f: (t: number) => Vec2, t0: number, t1: number, tol = 0.25, maxPoints = 4096): Sampled {
-  const pts: Vec2[] = [f(t0)];
+export function sampleAdaptive<P extends number[] = Vec2>(
+  f: (t: number) => P,
+  t0: number,
+  t1: number,
+  tol = 0.25,
+  maxPoints = 4096,
+): Sampled<P> {
+  const pts: P[] = [f(t0)];
   const ts: number[] = [t0];
   let budget = maxPoints - SEED_SEGMENTS - 1;
-  const refine = (a: number, pa: Vec2, b: number, pb: Vec2, depth: number): void => {
+  const refine = (a: number, pa: P, b: number, pb: P, depth: number): void => {
     const m = (a + b) / 2;
     const pm = f(m);
     if (depth < MAX_DEPTH && budget > 0 && segmentDistance(pm, pa, pb) > tol) {
PATCH
````

Patch `frontend/src/geom/tessellate.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/tessellate.ts b/frontend/src/geom/tessellate.ts
index a30bc32..e7d8dd6 100644
--- a/frontend/src/geom/tessellate.ts
+++ b/frontend/src/geom/tessellate.ts
@@ -1,8 +1,14 @@
-import { curveRange, evalCurve } from "./curves";
+import { halfSize } from "./bounds";
+import { clipCurveBox } from "./clip";
+import { evalCurve } from "./curves";
+import { Sampled, sampleAdaptive } from "./sample";
 import { evalSurface, surfaceWindow } from "./surfaces";
 import type { CurveGeom, SurfaceGeom } from "./types";
 import { Box, Vec3, add, cross, norm, scale, sub } from "./vec";
 
+/** Chord tolerance of the 3D view, as a fraction of the view box's half-size (≈ 0.4 px when the scene fills the pane). */
+export const WORLD_TOL = 5e-4;
+
 export interface TriMesh {
   positions: number[];
   indices: number[];
@@ -10,12 +16,9 @@ export interface TriMesh {
   assumed: boolean;
 }
 
-/** Polyline through the curve, uniform in t over `curveRange(g, box)`. */
-export function tessellateCurve(g: CurveGeom, box: Box, segments = 256): Vec3[] {
-  const [t0, t1] = curveRange(g, box);
-  const points: Vec3[] = [];
-  for (let i = 0; i <= segments; i++) points.push(evalCurve(g, t0 + ((t1 - t0) * i) / segments));
-  return points;
+/** The curve's pieces inside `box` (spec §5.3: the view box is the scene's ×1.5), clipped in closed form and sampled to `tol`. */
+export function curvePieces(g: CurveGeom, box: Box, tol = WORLD_TOL * halfSize(box)): Sampled<Vec3>[] {
+  return clipCurveBox(g, box).map(([a, b]) => sampleAdaptive((t) => evalCurve(g, t), a, b, tol));
 }
 
 /** Grid triangulation of the surface over its window (same layout as the Python sampler). */
PATCH
````

Patch `frontend/src/view3d.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/view3d.ts b/frontend/src/view3d.ts
index 060e653..9d94128 100644
--- a/frontend/src/view3d.ts
+++ b/frontend/src/view3d.ts
@@ -2,7 +2,7 @@ import * as BABYLON from "@babylonjs/core";
 import { cameraScale } from "./camera";
 import { Changes, FrameScheduler } from "./frame";
 import { halfSize, sameBox, sceneBounds, viewBox } from "./geom/bounds";
-import { arrowPolylines, tessellateCurve, tessellateSurface } from "./geom/tessellate";
+import { arrowPolylines, curvePieces, tessellateSurface } from "./geom/tessellate";
 import { isCurve, isSurface } from "./geom/types";
 import type { Box, Vec3 } from "./geom/vec";
 import type { SceneObject } from "./protocol";
@@ -192,7 +192,7 @@ export class View3D {
   private build(o: SceneObject): BABYLON.AbstractMesh[] {
     const g = o.geom;
     const color = BABYLON.Color3.FromHexString(colorOf(o));
-    if (isCurve(g)) return this.lines(o.id, [tessellateCurve(g, this.box)], color);
+    if (isCurve(g)) return this.lines(o.id, curvePieces(g, this.box).map((s) => s.pts), color);
     if (g.type === "polyline") return this.lines(o.id, [g.points], color);
     if (g.type === "arrow") return this.lines(o.id, arrowPolylines(g.at, g.vec), color);
     if (isSurface(g)) {
PATCH
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/clip.test.ts test/eval.test.ts test/sample.test.ts test/tessellate.test.ts)
(cd frontend && npx vitest run && npx tsc --noEmit)
````

Expected: 69 passed (69); vitest 215 passed in 21 files; `tsc` prints nothing.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/src/geom/clip.ts frontend/src/geom/curves.ts frontend/src/geom/sample.ts frontend/src/geom/tessellate.ts frontend/src/view3d.ts frontend/test/clip.test.ts frontend/test/eval.test.ts frontend/test/sample.test.ts frontend/test/tessellate.test.ts
git commit -m "geom: 3D curves are clipped to the view box in closed form and sampled to a world tolerance (curveRange removed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 3: Surface grids by curvature, isolines and lifting pcurves

**Surfaces.** A surface's grid is now sized by curvature: `arcSegments` keeps every chord's sagitta within the tolerance, with at least 16 segments a turn and at most 256. A straight direction gets one segment.

`surfaceGrid` describes the window and the counts. Two consumers read it:
- `tessellateSurface` emits normalized (u, v) per vertex for picking;
- `isoLines`/`windowEdges` draw isolines at cell centres and the window outline, leaving out edges that collapse to a pole.

**pcurves.** `liftPcurve` lifts a pcurve to S(q(t)) using the clipping rule from the Rulings. `periods` tells which surface directions wrap.

**Files:**
- Create: `frontend/test/pcurve.test.ts`
- Modify: `frontend/src/geom/pcurve.ts`, `frontend/src/geom/surfaces.ts`, `frontend/src/geom/tessellate.ts`, `frontend/src/view3d.ts`, `frontend/test/tessellate.test.ts`

**Interfaces:**
- Produces (`geom/surfaces.ts`): `periods(g: SurfaceGeom): { u: number | null; v: number | null }`.
- Produces (`geom/tessellate.ts`):
  - `MAX_SEGMENTS = 256`, `MIN_PER_TURN = 16`;
  - `arcSegments(span, radius, tol)`;
  - `interface SurfaceGrid { u: Range; v: Range; nu: number; nv: number; assumed: boolean }`;
  - `surfaceGrid(g, fallbackHalf, tol)`;
  - `tessellateSurface(g, grid): TriMesh`, where `TriMesh` gains `uvs`;
  - `isoLines(g, grid, nu, nv): Vec3[][]`;
  - `windowEdges(g, grid): Vec3[][]`.
- Produces (`geom/pcurve.ts`): `liftPcurve(g, s, box, tol?): Sampled<Vec3>[]`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/pcurve.test.ts`:

````ts
import { describe, expect, it } from "vitest";
import { liftPcurve, pcurveSurface } from "../src/geom/pcurve";
import { evalSurface } from "../src/geom/surfaces";
import type { Geom, PcurveGeom, SurfaceGeom } from "../src/geom/types";
import { Box, Frame } from "../src/geom/vec";

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const box: Box = { min: [-5, -5, -5], max: [5, 5, 5] };
const cylinder: SurfaceGeom = { type: "cylinder", frame: world, r: 2, window: { v: [-3.5, 3.5] } };
const on = (curve: PcurveGeom["curve"]): PcurveGeom => ({ type: "pcurve", surface: "Y", curve });

describe("pcurveSurface", () => {
  it("finds the surface by id, and nothing for a missing id or a non-surface", () => {
    const objects = new Map<string, Geom>([["Y", cylinder], ["P", { type: "point", p: [0, 0, 0] }]]);
    const lookup = (id: string) => objects.get(id);
    expect(pcurveSurface(on({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }), lookup)).toBe(cylinder);
    expect(pcurveSurface({ ...on({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }), surface: "P" }, lookup)).toBeNull();
    expect(pcurveSurface({ ...on({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }), surface: "gone" }, lookup)).toBeNull();
  });
});

describe("liftPcurve", () => {
  it("lifts the (u, v) line v = 3 to one turn of the circle at height 3", () => {
    // What Circle3D.parametrize_on(Cylinder) gives: u = t, v = 3, an infinite line in (u, v).
    const [piece, ...rest] = liftPcurve(on({ type: "line", o: [0, 3, 0], d: [1, 0, 0] }), cylinder, box);
    expect(rest).toEqual([]);
    expect(piece.ts[0]).toBeCloseTo(0, 12);
    expect(piece.ts[piece.ts.length - 1]).toBeCloseTo(2 * Math.PI, 12);
    for (const p of piece.pts) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(2, 9);
      expect(p[2]).toBeCloseTo(3, 9);
    }
  });

  it("lets a helix wind past the seam until it leaves the window in v", () => {
    const [piece] = liftPcurve(on({ type: "line", o: [0, 0, 0], d: [1, 0.2, 0] }), cylinder, box);
    expect(piece.ts[0]).toBeCloseTo(-17.5, 9);
    expect(piece.ts[piece.ts.length - 1]).toBeCloseTo(17.5, 9);
  });

  it("draws a (u, v) circle whole even across the seam u = 0", () => {
    const [piece] = liftPcurve(on({ type: "circle", frame: world, r: 0.5 }), cylinder, box);
    expect(piece.ts[0]).toBe(0);
    expect(piece.ts[piece.ts.length - 1]).toBeCloseTo(2 * Math.PI, 12);
  });

  it("lifts a polyline segment by segment, its parameter running over the vertex indices", () => {
    const [piece] = liftPcurve(on({ type: "polyline", points: [[0, 0, 0], [Math.PI, 1, 0], [Math.PI, 2, 0]] }), cylinder, box);
    expect(piece.pts[0]).toEqual(evalSurface(cylinder, 0, 0));
    expect(piece.pts[piece.pts.length - 1]).toEqual(evalSurface(cylinder, Math.PI, 2));
    expect(piece.ts[0]).toBe(0);
    expect(piece.ts[piece.ts.length - 1]).toBe(2);
    expect(piece.ts).toContain(1);
  });

  it("draws nothing for a (u, v) line that misses the window", () => {
    expect(liftPcurve(on({ type: "line", o: [0, 9, 0], d: [1, 0, 0] }), cylinder, box)).toEqual([]);
  });
});
````

Patch `frontend/test/tessellate.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/tessellate.test.ts b/frontend/test/tessellate.test.ts
index ca9c69b..05e9d47 100644
--- a/frontend/test/tessellate.test.ts
+++ b/frontend/test/tessellate.test.ts
@@ -1,11 +1,12 @@
 import { describe, expect, it } from "vitest";
 import { segmentDistance } from "../src/geom/sample";
-import { arrowPolylines, curvePieces, tessellateSurface } from "../src/geom/tessellate";
+import { arcSegments, arrowPolylines, curvePieces, isoLines, surfaceGrid, tessellateSurface, windowEdges } from "../src/geom/tessellate";
+import { evalSurface } from "../src/geom/surfaces";
 import { evalCurve } from "../src/geom/curves";
 import { halfSize, sameBox, sceneBounds, viewBox } from "../src/geom/bounds";
 import { inPlaneZ0 } from "../src/geom/planar";
 import type { Geom } from "../src/geom/types";
-import { Frame } from "../src/geom/vec";
+import { Frame, Vec3 } from "../src/geom/vec";
 
 const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
 const tilted: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };
@@ -35,13 +36,84 @@ describe("curvePieces", () => {
   });
 });
 
+describe("arcSegments", () => {
+  it("keeps the sagitta of every chord within the tolerance", () => {
+    const n = arcSegments(2 * Math.PI, 3, 1e-3);
+    expect(3 * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(1e-3);
+    expect(3 * (1 - Math.cos(Math.PI / (n - 1)))).toBeGreaterThan(1e-3);
+  });
+
+  it("keeps at least 16 segments a turn, at most 256, and handles a zero radius", () => {
+    expect(arcSegments(2 * Math.PI, 1e-6, 1e-3)).toBe(16);
+    expect(arcSegments(Math.PI, 1e-6, 1e-3)).toBe(8);
+    expect(arcSegments(2 * Math.PI, 1e6, 1e-3)).toBe(256);
+    expect(arcSegments(2 * Math.PI, 0, 1e-3)).toBe(16);
+  });
+});
+
+describe("surfaceGrid", () => {
+  it("gives straight directions one segment and curved ones a curvature-based count", () => {
+    expect(surfaceGrid({ type: "plane", frame: world, window: { u: [-1, 1], v: [-2, 2] } }, 5, 1e-3)).toEqual({
+      u: [-1, 1], v: [-2, 2], nu: 1, nv: 1, assumed: false,
+    });
+    const cyl = surfaceGrid({ type: "cylinder", frame: world, r: 2, window: { v: [-1, 1] } }, 5, 1e-3);
+    expect(cyl).toMatchObject({ nu: arcSegments(2 * Math.PI, 2, 1e-3), nv: 1 });
+    const cone = surfaceGrid({ type: "cone", frame: world, semi_angle: Math.PI / 6, ref_radius: 1, window: { v: [-1, 4] } }, 5, 1e-3);
+    expect(cone.nu).toBe(arcSegments(2 * Math.PI, 3, 1e-3)); // the widest ring, at v = 4
+    const torus = surfaceGrid({ type: "torus", frame: world, R: 3, r: 1 }, 5, 1e-3);
+    expect(torus).toMatchObject({ nu: arcSegments(2 * Math.PI, 4, 1e-3), nv: arcSegments(2 * Math.PI, 1, 1e-3) });
+    expect(surfaceGrid({ type: "plane", frame: world }, 5, 1e-3)).toMatchObject({ u: [-5, 5], assumed: true });
+  });
+});
+
 describe("tessellateSurface", () => {
-  it("builds an (nu+1)×(nv+1) grid of triangles", () => {
-    const mesh = tessellateSurface({ type: "sphere", frame: world, r: 1 }, 5, 4, 2);
+  it("builds an (nu+1)×(nv+1) grid of triangles with normalized (u, v) per vertex", () => {
+    const g = { type: "sphere", frame: world, r: 1 } as const;
+    const mesh = tessellateSurface(g, { u: [0, 2 * Math.PI], v: [-Math.PI / 2, Math.PI / 2], nu: 4, nv: 2, assumed: false });
     expect(mesh.positions).toHaveLength(5 * 3 * 3);
+    expect(mesh.uvs).toHaveLength(5 * 3 * 2);
     expect(mesh.indices).toHaveLength(4 * 2 * 6);
-    expect(mesh.assumed).toBe(false);
-    expect(tessellateSurface({ type: "plane", frame: world }, 5, 2, 2).assumed).toBe(true);
+    expect(mesh.uvs.slice(0, 2)).toEqual([0, 0]);
+    expect(mesh.uvs.slice(-2)).toEqual([1, 1]);
+    expect(mesh.positions.slice(3 * 7, 3 * 8)).toEqual(evalSurface(g, Math.PI, 0)); // vertex (i = 2, j = 1)
+  });
+
+  it("stays within the tolerance of a sphere along its widest grid row", () => {
+    const g = { type: "sphere", frame: world, r: 3 } as const;
+    const grid = surfaceGrid(g, 5, 1e-3);
+    const mesh = tessellateSurface(g, grid);
+    const j = Math.floor(grid.nv / 2); // the row next to the equator
+    const v = -Math.PI / 2 + (Math.PI * j) / grid.nv;
+    for (let i = 0; i < grid.nu; i++) {
+      const a = mesh.positions.slice(3 * (j * (grid.nu + 1) + i), 3 * (j * (grid.nu + 1) + i) + 3) as Vec3;
+      const b = mesh.positions.slice(3 * (j * (grid.nu + 1) + i + 1), 3 * (j * (grid.nu + 1) + i + 1) + 3) as Vec3;
+      const mid = evalSurface(g, ((i + 0.5) / grid.nu) * 2 * Math.PI, v);
+      expect(segmentDistance(mid, a, b)).toBeLessThanOrEqual(1e-3 + 1e-12);
+    }
+  });
+});
+
+describe("isoLines and windowEdges", () => {
+  const sphere = { type: "sphere", frame: world, r: 2 } as const;
+  const grid = surfaceGrid(sphere, 5, 1e-3);
+
+  it("draws nu lines of constant u and nv of constant v, centred in their cells", () => {
+    const lines = isoLines(sphere, grid, 4, 2);
+    expect(lines).toHaveLength(6);
+    expect(lines[0]).toHaveLength(grid.nv + 1);
+    for (const p of lines[0].slice(1, -1)) expect(Math.atan2(p[1], p[0])).toBeCloseTo(Math.PI / 4, 9);
+    expect(lines[4]).toHaveLength(grid.nu + 1);
+    for (const p of lines[4]) expect(p[2]).toBeCloseTo(2 * Math.sin(-Math.PI / 4), 9); // v = −π/4
+  });
+
+  it("outlines the window and leaves out edges that collapse to a pole", () => {
+    expect(windowEdges(sphere, grid)).toHaveLength(2); // the seam at u = 0 and u = 2π; the poles are points
+    expect(windowEdges({ type: "plane", frame: world, window: { u: [0, 1], v: [0, 1] } }, surfaceGrid({ type: "plane", frame: world, window: { u: [0, 1], v: [0, 1] } }, 5, 1e-3))).toEqual([
+      [[0, 0, 0], [0, 1, 0]],
+      [[1, 0, 0], [1, 1, 0]],
+      [[0, 0, 0], [1, 0, 0]],
+      [[0, 1, 0], [1, 1, 0]],
+    ]);
   });
 });
 
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/pcurve.test.ts test/tessellate.test.ts)
````

Expected: `Test Files 2 failed (2)`, `Tests 5 failed | 1 passed (6)` in `pcurve.test.ts`, and `tessellate.test.ts` fails to load (`surfaceGrid is not a function`).

- [ ] **Step 3: Implement**

Patch `frontend/src/geom/pcurve.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/pcurve.ts b/frontend/src/geom/pcurve.ts
index c6d02c1..da62d5d 100644
--- a/frontend/src/geom/pcurve.ts
+++ b/frontend/src/geom/pcurve.ts
@@ -1,4 +1,11 @@
-import { Geom, PcurveGeom, SurfaceGeom, isSurface } from "./types";
+import { halfSize } from "./bounds";
+import { Rect, clipCurve2D } from "./clip";
+import { evalCurve } from "./curves";
+import { Sampled, sampleAdaptive } from "./sample";
+import { evalSurface, periods, surfaceWindow } from "./surfaces";
+import { WORLD_TOL } from "./tessellate";
+import { Geom, PcurveGeom, Range, SurfaceGeom, isSurface } from "./types";
+import type { Box, Vec3 } from "./vec";
 
 /**
  * The surface a pcurve lies on, or null when its id names no object or one that is not a
@@ -9,3 +16,48 @@ export function pcurveSurface(g: PcurveGeom, lookup: (id: string) => Geom | unde
   const s = lookup(g.surface);
   return s && isSurface(s) ? s : null;
 }
+
+/**
+ * Parameter intervals of a (u, v) line or circle to lift. The curve is clipped to the
+ * surface's window in the directions that do not wrap around, so a helix winds past the
+ * seam until it leaves the window in v; a curve those leave unbounded (the line v = 3 that
+ * `Circle3D.parametrize_on(cylinder)` gives) is clipped to the whole window, one turn.
+ */
+function uvRanges(g: PcurveGeom["curve"] & { type: "line" | "circle" }, s: SurfaceGeom, u: Range, v: Range): Range[] {
+  const period = periods(s);
+  const open: Rect = {
+    xmin: period.u ? -Infinity : u[0],
+    xmax: period.u ? Infinity : u[1],
+    ymin: period.v ? -Infinity : v[0],
+    ymax: period.v ? Infinity : v[1],
+  };
+  const ranges = clipCurve2D(g, open);
+  return ranges.length ? ranges : clipCurve2D(g, { xmin: u[0], xmax: u[1], ymin: v[0], ymax: v[1] });
+}
+
+/**
+ * The pcurve in 3D, S(q(t)) (spec §4.2), sampled to `tol` in world units. Each piece carries
+ * the pcurve's parameter: t for a (u, v) line or circle, i + s along the polyline's
+ * segment i.
+ */
+export function liftPcurve(g: PcurveGeom, s: SurfaceGeom, box: Box, tol = WORLD_TOL * halfSize(box)): Sampled<Vec3>[] {
+  const c = g.curve;
+  if (c.type === "polyline") {
+    const pts: Vec3[] = [];
+    const ts: number[] = [];
+    for (let i = 0; i + 1 < c.points.length; i++) {
+      const [a, b] = [c.points[i], c.points[i + 1]];
+      const piece = sampleAdaptive((t) => evalSurface(s, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), 0, 1, tol);
+      const from = i === 0 ? 0 : 1; // segment i starts where segment i − 1 ended
+      pts.push(...piece.pts.slice(from));
+      ts.push(...piece.ts.slice(from).map((t) => i + t));
+    }
+    return [{ pts, ts }];
+  }
+  const { u, v } = surfaceWindow(s, halfSize(box));
+  const lift = (t: number): Vec3 => {
+    const q = evalCurve(c, t);
+    return evalSurface(s, q[0], q[1]);
+  };
+  return uvRanges(c, s, u, v).map(([a, b]) => sampleAdaptive(lift, a, b, tol));
+}
PATCH
````

Patch `frontend/src/geom/surfaces.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/surfaces.ts b/frontend/src/geom/surfaces.ts
index 9949b5c..e900341 100644
--- a/frontend/src/geom/surfaces.ts
+++ b/frontend/src/geom/surfaces.ts
@@ -40,6 +40,20 @@ export function naturalWindow(g: SurfaceGeom): { u: Range | null; v: Range | nul
   }
 }
 
+/** The period of each parameter direction that wraps around (2π), null for one that does not. */
+export function periods(g: SurfaceGeom): { u: number | null; v: number | null } {
+  switch (g.type) {
+    case "plane":
+      return { u: null, v: null };
+    case "cylinder":
+    case "cone":
+    case "sphere":
+      return { u: TAU, v: null };
+    case "torus":
+      return { u: TAU, v: TAU };
+  }
+}
+
 /** Window to tessellate: explicit, else natural, else ±fallbackHalf (`assumed` = a fallback was used). */
 export function surfaceWindow(g: SurfaceGeom, fallbackHalf: number): { u: Range; v: Range; assumed: boolean } {
   const natural = naturalWindow(g);
PATCH
````

Patch `frontend/src/geom/tessellate.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/tessellate.ts b/frontend/src/geom/tessellate.ts
index e7d8dd6..251e4b5 100644
--- a/frontend/src/geom/tessellate.ts
+++ b/frontend/src/geom/tessellate.ts
@@ -3,31 +3,91 @@ import { clipCurveBox } from "./clip";
 import { evalCurve } from "./curves";
 import { Sampled, sampleAdaptive } from "./sample";
 import { evalSurface, surfaceWindow } from "./surfaces";
-import type { CurveGeom, SurfaceGeom } from "./types";
+import type { CurveGeom, Range, SurfaceGeom } from "./types";
 import { Box, Vec3, add, cross, norm, scale, sub } from "./vec";
 
 /** Chord tolerance of the 3D view, as a fraction of the view box's half-size (≈ 0.4 px when the scene fills the pane). */
 export const WORLD_TOL = 5e-4;
+/** Most segments along one parameter direction of a surface. */
+export const MAX_SEGMENTS = 256;
+/** Fewest segments per full turn of a curved direction, however coarse the tolerance. */
+export const MIN_PER_TURN = 16;
 
-export interface TriMesh {
-  positions: number[];
-  indices: number[];
-  /** True when an infinite direction had no window and fell back to ±fallbackHalf. */
-  assumed: boolean;
-}
+const TAU = 2 * Math.PI;
 
 /** The curve's pieces inside `box` (spec §5.3: the view box is the scene's ×1.5), clipped in closed form and sampled to `tol`. */
 export function curvePieces(g: CurveGeom, box: Box, tol = WORLD_TOL * halfSize(box)): Sampled<Vec3>[] {
   return clipCurveBox(g, box).map(([a, b]) => sampleAdaptive((t) => evalCurve(g, t), a, b, tol));
 }
 
-/** Grid triangulation of the surface over its window (same layout as the Python sampler). */
-export function tessellateSurface(g: SurfaceGeom, fallbackHalf: number, nu = 64, nv = 32): TriMesh {
+/** Segments for an arc of `span` radians on a circle of `radius`, each chord's sagitta ≤ `tol`. */
+export function arcSegments(span: number, radius: number, tol: number): number {
+  const step = 2 * Math.acos(Math.max(-1, 1 - tol / radius));
+  const turns = Math.abs(span) / TAU;
+  return Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(Math.abs(span) / step), Math.ceil(turns * MIN_PER_TURN)));
+}
+
+/** A surface's parameter window and how finely it is cut (spec §5.3: curvature-based density). */
+export interface SurfaceGrid {
+  u: Range;
+  v: Range;
+  nu: number;
+  nv: number;
+  /** True when an infinite direction had no window and fell back to ±fallbackHalf. */
+  assumed: boolean;
+}
+
+/**
+ * The window to draw (explicit, natural, else ±fallbackHalf) and the segments per direction:
+ * a straight direction (plane u and v, cylinder and cone v) needs one, a curved one as many
+ * as keep the chord within `tol` of its widest circle.
+ */
+export function surfaceGrid(g: SurfaceGeom, fallbackHalf: number, tol: number): SurfaceGrid {
   const { u, v, assumed } = surfaceWindow(g, fallbackHalf);
+  const du = u[1] - u[0];
+  const dv = v[1] - v[0];
+  let nu = 1;
+  let nv = 1;
+  switch (g.type) {
+    case "cylinder":
+      nu = arcSegments(du, g.r, tol);
+      break;
+    case "cone": {
+      const ring = (t: number) => Math.abs(g.ref_radius + t * Math.sin(g.semi_angle));
+      nu = arcSegments(du, Math.max(ring(v[0]), ring(v[1])), tol);
+      break;
+    }
+    case "sphere":
+      nu = arcSegments(du, g.r, tol);
+      nv = arcSegments(dv, g.r, tol);
+      break;
+    case "torus":
+      nu = arcSegments(du, g.R + g.r, tol);
+      nv = arcSegments(dv, g.r, tol);
+      break;
+  }
+  return { u, v, nu, nv, assumed };
+}
+
+export interface TriMesh {
+  positions: number[];
+  indices: number[];
+  /** Each vertex's (u, v), normalized to [0, 1] across the window (picking interpolates them). */
+  uvs: number[];
+}
+
+const at = (r: Range, s: number): number => r[0] + (r[1] - r[0]) * s;
+
+/** Grid triangulation of the surface: (nu + 1) × (nv + 1) vertices, row by row in v. */
+export function tessellateSurface(g: SurfaceGeom, grid: SurfaceGrid): TriMesh {
+  const { nu, nv } = grid;
   const positions: number[] = [];
+  const uvs: number[] = [];
   for (let j = 0; j <= nv; j++) {
-    const vj = v[0] + ((v[1] - v[0]) * j) / nv;
-    for (let i = 0; i <= nu; i++) positions.push(...evalSurface(g, u[0] + ((u[1] - u[0]) * i) / nu, vj));
+    for (let i = 0; i <= nu; i++) {
+      positions.push(...evalSurface(g, at(grid.u, i / nu), at(grid.v, j / nv)));
+      uvs.push(i / nu, j / nv);
+    }
   }
   const indices: number[] = [];
   for (let j = 0; j < nv; j++) {
@@ -37,7 +97,28 @@ export function tessellateSurface(g: SurfaceGeom, fallbackHalf: number, nu = 64,
       indices.push(a, c, a + 1, a + 1, c, c + 1);
     }
   }
-  return { positions, indices, assumed };
+  return { positions, indices, uvs };
+}
+
+/** Curve of constant u (sampled at the grid's v steps), or of constant v. */
+function isoU(g: SurfaceGeom, grid: SurfaceGrid, u: number): Vec3[] {
+  return Array.from({ length: grid.nv + 1 }, (_, j) => evalSurface(g, u, at(grid.v, j / grid.nv)));
+}
+function isoV(g: SurfaceGeom, grid: SurfaceGrid, v: number): Vec3[] {
+  return Array.from({ length: grid.nu + 1 }, (_, i) => evalSurface(g, at(grid.u, i / grid.nu), v));
+}
+
+/** `isolines: [nu, nv]` (spec §4.2): nu curves of constant u, then nv of constant v, each in the middle of its cell. */
+export function isoLines(g: SurfaceGeom, grid: SurfaceGrid, nu: number, nv: number): Vec3[][] {
+  const us = Array.from({ length: nu }, (_, i) => at(grid.u, (i + 0.5) / nu));
+  const vs = Array.from({ length: nv }, (_, j) => at(grid.v, (j + 0.5) / nv));
+  return [...us.map((u) => isoU(g, grid, u)), ...vs.map((v) => isoV(g, grid, v))];
+}
+
+/** The window's four edges (u = u0, u1, then v = v0, v1), leaving out edges that collapse to a point (a sphere's poles). */
+export function windowEdges(g: SurfaceGeom, grid: SurfaceGrid): Vec3[][] {
+  const edges = [isoU(g, grid, grid.u[0]), isoU(g, grid, grid.u[1]), isoV(g, grid, grid.v[0]), isoV(g, grid, grid.v[1])];
+  return edges.filter((line) => line.some((p) => norm(sub(p, line[0])) > 1e-12 * Math.max(1, norm(line[0]))));
 }
 
 /** Shaft plus two head strokes (15 % of the length), in a plane containing the arrow. */
PATCH
````

Patch `frontend/src/view3d.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/view3d.ts b/frontend/src/view3d.ts
index 9d94128..1d68f44 100644
--- a/frontend/src/view3d.ts
+++ b/frontend/src/view3d.ts
@@ -2,7 +2,7 @@ import * as BABYLON from "@babylonjs/core";
 import { cameraScale } from "./camera";
 import { Changes, FrameScheduler } from "./frame";
 import { halfSize, sameBox, sceneBounds, viewBox } from "./geom/bounds";
-import { arrowPolylines, curvePieces, tessellateSurface } from "./geom/tessellate";
+import { WORLD_TOL, arrowPolylines, curvePieces, surfaceGrid, tessellateSurface } from "./geom/tessellate";
 import { isCurve, isSurface } from "./geom/types";
 import type { Box, Vec3 } from "./geom/vec";
 import type { SceneObject } from "./protocol";
@@ -196,7 +196,8 @@ export class View3D {
     if (g.type === "polyline") return this.lines(o.id, [g.points], color);
     if (g.type === "arrow") return this.lines(o.id, arrowPolylines(g.at, g.vec), color);
     if (isSurface(g)) {
-      const mesh = tessellateSurface(g, halfSize(this.box));
+      const half = halfSize(this.box);
+      const mesh = tessellateSurface(g, surfaceGrid(g, half, WORLD_TOL * half));
       return [this.surface(o, mesh.positions, mesh.indices, color)];
     }
     if (g.type === "mesh") return [this.surface(o, g.vertices.flat(), g.indices, color)];
PATCH
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/pcurve.test.ts test/tessellate.test.ts)
(cd frontend && npx vitest run && npx tsc --noEmit)
````

Expected: 27 passed (27); vitest 227 passed in 22 files; `tsc` prints nothing.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/src/geom/pcurve.ts frontend/src/geom/surfaces.ts frontend/src/geom/tessellate.ts frontend/src/view3d.ts frontend/test/pcurve.test.ts frontend/test/tessellate.test.ts
git commit -m "geom: surfaces tessellate by curvature with normalized (u, v), isolines and window edges; pcurves lift onto their surface across seams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 4: Python: `view.pcurve` and the example scenes

**Adapter.**
- `adapt.uv_curve` turns a geomcore `Line2D`/`Circle2D` (what `curve.parametrize_on(surface)` returns) or a sequence of (u, v) pairs into the pcurve's curve.
- It raises `TypeError` for any other geometry, for points off z = 0, and for fewer than two points.
- `Circle2D` frames now take z = x × (P(π/2) − o), so clockwise circles keep their direction.

**Viewer.** `Viewer.pcurve(curve, on, *, label, group, **options)` takes the surface as a `Handle` or an id. It raises `ValueError` unless that surface is already in the scene.

**Examples.**
- `examples/pcurve.py` puts three pcurves on a cylinder window: a ring from `Circle3D.parametrize_on`, an unbounded helix line, and a dashed zigzag.
- `examples/pcurve.py` and `examples/quadrics_3d.py` gain `--save <file>`.
- The two saved scenes become the e2e fixtures.

**Files:**
- Create: `examples/pcurve.py`, `frontend/e2e/scenes/pcurve.json`, `frontend/e2e/scenes/quadrics_3d.json`
- Modify: `examples/quadrics_3d.py`, `python/geomcore_viewer/adapt.py`, `python/geomcore_viewer/viewer.py`, `python/tests/test_adapt.py`, `python/tests/test_viewer.py`

**Interfaces:**
- Produces:
  - `adapt.UV_CURVES = {"Line2D", "Circle2D"}`;
  - `adapt.uv_curve(curve) -> dict`;
  - `Viewer.pcurve(curve, on, *, label=None, group=None, **options) -> Handle`.
- Produces the fixture files `frontend/e2e/scenes/pcurve.json` and `frontend/e2e/scenes/quadrics_3d.json`. Their `run` ids differ on every save, which is harmless.

- [ ] **Step 1: Write the failing tests**

Patch `python/tests/test_adapt.py` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/python/tests/test_adapt.py b/python/tests/test_adapt.py
index 2d53060..a39820a 100644
--- a/python/tests/test_adapt.py
+++ b/python/tests/test_adapt.py
@@ -11,6 +11,7 @@ from geomcore_viewer.adapt import (
     scene_extent,
     subscript,
     to_objects,
+    uv_curve,
     with_window,
 )
 
@@ -249,3 +250,36 @@ def test_indexed_labels_never_collide():
     assert indexed("P", 12) == "P₁₂"
     assert indexed("P₁", 2) == "P₁,₂"
     assert indexed("Q₁₀", 1) == "Q₁₀,₁"
+
+
+def test_clockwise_circle2d_gets_a_downward_frame():
+    clockwise = {"type": "circle", "frame": {"o": [1.0, 2.0, 0.0], "x": [1.0, 0.0, 0.0], "y": [0.0, -1.0, 0.0],
+                                            "z": [0.0, 0.0, -1.0]}, "r": 0.5}
+    [part] = to_objects(fake("Circle2D", clockwise, center=Point3D(1.0, 2.0), radius=0.5))
+    assert_frame(part["geom"]["frame"], clockwise["frame"])
+
+
+def test_uv_curves():
+    line = fake("Line2D", {"type": "line", "o": [0.0, 3.0, 0.0], "d": [1.0, 0.0, 0.0]},
+                origin=Point3D(0.0, 3.0), direction=Vector3D(1.0, 0.0))
+    assert uv_curve(line) == {"type": "line", "o": [0.0, 3.0, 0.0], "d": [1.0, 0.0, 0.0]}
+    assert uv_curve([(0, 0), (math.pi, 1.5)]) == {"type": "polyline", "points": [[0.0, 0.0, 0.0], [math.pi, 1.5, 0.0]]}
+    with pytest.raises(TypeError, match=r"\(u, v\)"):
+        uv_curve([(0, 0, 1), (1, 1, 1)])
+    with pytest.raises(TypeError, match="at least 2"):
+        uv_curve([(0, 0)])
+    with pytest.raises(TypeError, match="Line2D"):
+        uv_curve(fake("Line3D", {"type": "line", "o": [0.0, 0.0, 0.0], "d": [1.0, 0.0, 0.0]}))
+
+
+def test_real_geomcore_parametrize_on_gives_a_uv_curve():
+    pytest.importorskip("geomcore")
+    from geomcore import Point3D as P, Vector3D as V
+    from geomcore.curves import Circle3D
+    from geomcore.surfaces import Cylinder, Plane
+
+    Y = Cylinder(P(0, 0, 0), V.z(), 2.0)
+    q = Circle3D(P(0, 0, 1.5), V.z(), 2.0).parametrize_on(Y)
+    assert uv_curve(q) == {"type": "line", "o": [0.0, 1.5, 0.0], "d": [1.0, 0.0, 0.0]}
+    flipped = Circle3D(P(1, 1, 0), V(0, 0, -1), 0.5).parametrize_on(Plane(P(0, 0, 0), V.z()))
+    assert uv_curve(flipped)["frame"]["z"] == pytest.approx([0.0, 0.0, -1.0])
PATCH
````

Patch `python/tests/test_viewer.py` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/python/tests/test_viewer.py b/python/tests/test_viewer.py
index dfaf31d..12a9336 100644
--- a/python/tests/test_viewer.py
+++ b/python/tests/test_viewer.py
@@ -378,3 +378,27 @@ def test_meta_reaches_the_server(server):
     make(server).add(("points", [(0.1, Point3D(1, 0), 0.2)]), label="P")
     [obj] = _scene(server)["objects"]
     assert obj["meta"] == {"tag": "points", "params": [0.1, 0.2]}
+
+
+def test_pcurve_lies_on_a_surface_already_added(server):
+    view = make(server)
+    plane = view.add(Plane(), label="pl", u=(0, 4), v=(0, 2))
+    on_handle = view.pcurve([(0, 0), (4, 2)], on=plane, label="diag", dashed=True)
+    view.pcurve([(1, 0), (1, 2)], on="pl", label="mid")
+    objects = {o["id"]: o for o in _scene(server)["objects"]}
+    assert on_handle.id == "diag"
+    assert objects["diag"]["geom"] == {
+        "type": "pcurve", "surface": "pl", "curve": {"type": "polyline", "points": [[0.0, 0.0, 0.0], [4.0, 2.0, 0.0]]},
+    }
+    assert objects["diag"]["style"] == {"color": PALETTE[1], "dashed": True}
+    assert objects["mid"]["geom"]["surface"] == "pl"
+
+
+def test_pcurve_needs_a_surface_in_the_scene(server):
+    view = make(server)
+    point = view.add(Point3D(0, 0), label="A")
+    with pytest.raises(ValueError, match="'A' is not a surface"):
+        view.pcurve([(0, 0), (1, 1)], on=point)
+    with pytest.raises(ValueError, match="'nope' is not a surface"):
+        view.pcurve([(0, 0), (1, 1)], on="nope")
+    assert _ids(server) == ["A"]
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_adapt.py python/tests/test_viewer.py -q
````

Expected: collection error: `ImportError: cannot import name 'uv_curve'` (1 error).

- [ ] **Step 3: Implement**

Create `examples/pcurve.py`:

````python
"""Curves given in a surface's (u, v) parameters — drawn on the surface and in the (u,v) pane.

Run:   python examples/pcurve.py            (press U in the 3D view to toggle the (u,v) pane)
Save:  python examples/pcurve.py --save frontend/e2e/scenes/pcurve.json
Needs geomcore (pip install geomcore, or PYTHONPATH=../geomcore/geomcore-py).
"""

from __future__ import annotations

import argparse
import math

from geomcore import Point2D, Point3D, Vector2D, Vector3D
from geomcore.curves import Circle3D, Line2D
from geomcore.surfaces import Cylinder

import geomcore_viewer as gv

parser = argparse.ArgumentParser()
parser.add_argument("--save", help="write the scene to this JSON file instead of opening the viewer")
args = parser.parse_args()

view = gv.Viewer("Curves on a cylinder", spawn=args.save is None)

Y = Cylinder(Point3D.origin(), Vector3D.z(), 2.0)
cyl = view.add(Y, label="Y", v=(-1.0, 4.0))

# A circle of the cylinder, handed over as its (u, v) image: the line v = 1.5.
ring = Circle3D(Point3D(0.0, 0.0, 1.5), Vector3D.z(), 2.0)
view.pcurve(ring.parametrize_on(Y), on=cyl, label="ring")

# A helix: the line v = u / 4 in (u, v). Unbounded, it is drawn where it crosses the window v ∈ [-1, 4].
view.pcurve(Line2D(Point2D(0.0, 0.0), Vector2D(1.0, 0.25)), on=cyl, label="helix")

# A hand-made (u, v) polyline: a zig-zag around the lower part.
zigzag = [(k * math.pi / 4, 0.0 if k % 2 == 0 else -0.8) for k in range(9)]
view.pcurve(zigzag, on=cyl, label="zigzag", dashed=True)

if args.save:
    print(f"saved {view.save(args.save)}")
````

Patch `examples/quadrics_3d.py` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/examples/quadrics_3d.py b/examples/quadrics_3d.py
index 7ac800e..f48cdad 100644
--- a/examples/quadrics_3d.py
+++ b/examples/quadrics_3d.py
@@ -1,16 +1,24 @@
 """Sphere ∩ cylinder and plane ∩ cone — intersection curves in 3D.
 
-Run:  python examples/quadrics_3d.py   (needs geomcore)
+Run:   python examples/quadrics_3d.py
+Save:  python examples/quadrics_3d.py --save frontend/e2e/scenes/quadrics_3d.json
+Needs geomcore (pip install geomcore, or PYTHONPATH=../geomcore/geomcore-py).
 """
 
 from __future__ import annotations
 
+import argparse
+
 from geomcore import Frame3D, Point3D, Vector3D
 from geomcore.surfaces import Cone, Cylinder, Plane, Sphere
 
 import geomcore_viewer as gv
 
-view = gv.Viewer("Quadric intersections")
+parser = argparse.ArgumentParser()
+parser.add_argument("--save", help="write the scene to this JSON file instead of opening the viewer")
+args = parser.parse_args()
+
+view = gv.Viewer("Quadric intersections", spawn=args.save is None)
 
 S = Sphere(Point3D.origin(), 3.0)
 Y = Cylinder(Point3D.origin(), Vector3D.z(), 2.0)
@@ -23,3 +31,6 @@ P = Plane(Point3D(9.0, 0.0, 1.0), Vector3D.z())
 view.add(K, label="K", opacity=0.4, v=(-4.0, 4.0), group="plane ∩ cone")
 view.add(P, label="Π", opacity=0.3, u=(-4.0, 4.0), v=(-4.0, 4.0), group="plane ∩ cone")
 view.add(P.intersect_cone(K), label="ΠK", group="plane ∩ cone")
+
+if args.save:
+    print(f"saved {view.save(args.save)}")
PATCH
````

Patch `python/geomcore_viewer/adapt.py` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/python/geomcore_viewer/adapt.py b/python/geomcore_viewer/adapt.py
index a545ba0..d633b0c 100644
--- a/python/geomcore_viewer/adapt.py
+++ b/python/geomcore_viewer/adapt.py
@@ -181,8 +181,10 @@ def _curve_geom(obj, name: str) -> dict:
         return {"type": "line", "o": as_vec(obj.origin()), "d": as_vec(obj.direction())}
     if name in ("Circle3D", "Circle2D"):
         o = as_vec(obj.center())
-        z = as_vec(obj.normal()) if name == "Circle3D" else [0.0, 0.0, 1.0]
-        return {"type": "circle", "frame": _frame(o, _sub(P(0.0), o), z), "r": float(obj.radius())}
+        x = _sub(P(0.0), o)
+        # A (u, v) circle may run clockwise (parametrize_on a circle facing away): its frame's z is then −z.
+        z = as_vec(obj.normal()) if name == "Circle3D" else _cross(x, _sub(P(math.pi / 2), o))
+        return {"type": "circle", "frame": _frame(o, x, z), "r": float(obj.radius())}
     if name == "Ellipse3D":
         o = as_vec(obj.center())
         x, y = _sub(P(0.0), o), _sub(P(math.pi / 2), o)
@@ -259,6 +261,27 @@ def _single(obj, label: str | None, u, v) -> list[dict]:
     return [{"label": label, "geom": geom, "source": name}]
 
 
+UV_CURVES = frozenset({"Line2D", "Circle2D"})
+
+
+def uv_curve(curve) -> dict:
+    """A pcurve's curve as protocol geometry in z = 0 (x is u, y is v): a geomcore ``Line2D`` or
+    ``Circle2D`` (what ``curve.parametrize_on(surface)`` returns), or a sequence of ``(u, v)``
+    pairs, which becomes a polyline."""
+    name = type(curve).__name__
+    if name in UV_CURVES:
+        [part] = _single(curve, None, None, None)
+        return part["geom"]
+    if name in GEOMETRY:
+        raise TypeError(f"a pcurve takes a Line2D, a Circle2D or (u, v) pairs, not a {name}")
+    points = [as_vec(p) for p in curve]
+    if any(p[2] != 0.0 for p in points):
+        raise TypeError("a pcurve's points are (u, v) pairs")
+    if len(points) < 2:
+        raise TypeError("a pcurve polyline needs at least 2 (u, v) points")
+    return {"type": "polyline", "points": points}
+
+
 # --- results and containers --------------------------------------------------
 _NOT_NUMERIC = object()
 
PATCH
````

Patch `python/geomcore_viewer/viewer.py` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/python/geomcore_viewer/viewer.py b/python/geomcore_viewer/viewer.py
index 71f0638..3a30e7f 100644
--- a/python/geomcore_viewer/viewer.py
+++ b/python/geomcore_viewer/viewer.py
@@ -11,7 +11,7 @@ import webbrowser
 from pathlib import Path
 from urllib.parse import quote
 
-from .adapt import SURFACE_TYPES, as_vec, indexed, scene_extent, to_objects, with_window
+from .adapt import SURFACE_TYPES, as_vec, indexed, scene_extent, to_objects, uv_curve, with_window
 from .server import PROTOCOL, default_url
 from .spawn import ensure_server, probe, refused_hint
 
@@ -112,6 +112,18 @@ class Viewer:
             parts += to_objects(obj, part_label, u=u, v=v)
         return self._commit(parts, label, group, options, u, v)
 
+    def pcurve(self, curve, on, *, label: str | None = None, group: str | None = None, **options):
+        """Show a curve given in a surface's (u, v) parameters: a geomcore ``Line2D`` or
+        ``Circle2D`` (e.g. ``circle.parametrize_on(surface)``) or a sequence of ``(u, v)``
+        pairs. ``on`` is the surface, already added: its :class:`Handle` or id. The page
+        draws the curve on the surface in 3D and in the (u,v) pane.
+        """
+        surface = on.id if isinstance(on, Handle) else on
+        if self.objects.get(surface, {}).get("geom", {}).get("type") not in SURFACE_TYPES:
+            raise ValueError(f"pcurve: {surface!r} is not a surface in this scene (add the surface first)")
+        geom = {"type": "pcurve", "surface": surface, "curve": uv_curve(curve)}
+        return self._commit([{"label": label, "geom": geom}], label, group, options)
+
     def polyline(self, points, *, label: str | None = None, group: str | None = None, **options):
         geom = {"type": "polyline", "points": [as_vec(p) for p in points]}
         return self._commit([{"label": label, "geom": geom}], label, group, options)
PATCH
````

- [ ] **Step 4: Save the example scenes for the e2e tests**

Run:

````bash
mkdir -p frontend/e2e/scenes
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python examples/pcurve.py --save frontend/e2e/scenes/pcurve.json
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python examples/quadrics_3d.py --save frontend/e2e/scenes/quadrics_3d.json
````

Expected: `saved frontend/e2e/scenes/pcurve.json` and `saved frontend/e2e/scenes/quadrics_3d.json`. Neither run opens a browser or starts a server. The pcurve scene holds 4 objects (Y, ring, helix, zigzag) and the quadrics scene 7.

- [ ] **Step 5: Run the tests to verify they pass**

Run:

````bash
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_adapt.py python/tests/test_viewer.py -q
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests -q
````

Expected: 72 passed; full suite 125 passed (122 passed and 3 skipped without geomcore on the path).

- [ ] **Step 6: Commit**

````bash
git add -A examples/pcurve.py examples/quadrics_3d.py frontend/e2e/scenes/pcurve.json frontend/e2e/scenes/quadrics_3d.json python/geomcore_viewer/adapt.py python/geomcore_viewer/viewer.py python/tests/test_adapt.py python/tests/test_viewer.py
git commit -m "python: view.pcurve(curve, on=surface) for Line2D, Circle2D or (u, v) pairs; clockwise Circle2D frames; examples/pcurve.py; --save writes the e2e scenes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 5: The 3D draw model

`objectDraw3D` is everything the Babylon view needs for one object, computed without Babylon:
- **lines:** world polylines with a pixel width; dashed in world units; extras lighter-weight;
- **surface:** mesh, grid and alpha, or none for `wire`;
- **markers:** dots with a pixel size;
- **texts:** labels with a kind for placement order;
- **pickables:** polylines with their curve parameter, plus dots.

The rules it applies:
- Curves get their label 30 % along their longest piece; surfaces at their window's centre.
- pcurves are lifted, and draw nothing while their surface is missing.
- `hasCurves`/`surfaceAlpha` implement the 0.45 default, and `isolineCounts` reads the `isolines`/`wire` extras.
- `screenPx` turns a nominal width into on-screen pixels: presentation ×1.5, highlight +1.5.
- `dashPolyline` becomes generic over the dimension so 3D lines can be dashed.

**Files:**
- Create: `frontend/src/view3d/render.ts`, `frontend/test/render3d.test.ts`
- Modify: `frontend/src/geom/sample.ts`, `frontend/test/sample.test.ts`

**Interfaces:**
- Produces (`view3d/render.ts`):
  - Constants: `LINE_PX`, `EDGE_PX`, `EXTRA_PX`, `POINT_PX`, `EXTRA_DOT_PX`, `HIGHLIGHT_PX`, `SURFACE_ALPHA_WITH_CURVES`, `ISOLINES`, `WIRE_ISOLINES`, `DASH`.
  - Types:
    - `Lines3D { id; extra; paths: Vec3[][]; color; px; alpha }`;
    - `Surface3D { id; mesh: TriMesh; grid: SurfaceGrid | null; color; alpha }`;
    - `Markers3D { id; at: Vec3[]; color; px; alpha; extra }`;
    - `Text3D { key; id; text; at: Vec3; color: string | null; kind }`;
    - `Pickable3D { id; polylines: { pts: Vec3[]; ts: number[] | null }[]; dots: Vec3[] }`;
    - `ObjectDraw3D { id; lines; surface; markers; texts; pick }`;
    - `Context3D { box; lookup; withCurves }`.
  - Functions: `hasCurves`, `surfaceAlpha`, `isolineCounts`, `screenPx(px, widthScale, lit)`, `objectDraw3D(o, ctx)`.
- Changes (`geom/sample.ts`): `dashPolyline<P extends number[]>`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/render3d.test.ts`:

````ts
import { describe, expect, it } from "vitest";
import { viewBox } from "../src/geom/bounds";
import { evalSurface } from "../src/geom/surfaces";
import type { Geom } from "../src/geom/types";
import type { Frame } from "../src/geom/vec";
import type { SceneObject } from "../src/protocol";
import {
  Context3D,
  ISOLINES,
  SURFACE_ALPHA_WITH_CURVES,
  WIRE_ISOLINES,
  hasCurves,
  isolineCounts,
  objectDraw3D,
  screenPx,
  surfaceAlpha,
} from "../src/view3d/render";

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const obj = (id: string, geom: Geom, extra: Partial<SceneObject> = {}): SceneObject => ({ id, geom, ...extra });
const cylinder = obj("Y", { type: "cylinder", frame: world, r: 2, window: { v: [-1, 4] } });
const circle = obj("C", { type: "circle", frame: world, r: 1 });

function ctx(objects: SceneObject[]): Context3D {
  const byId = new Map(objects.map((o) => [o.id, o.geom]));
  return { box: viewBox(objects.map((o) => o.geom)), lookup: (id) => byId.get(id), withCurves: hasCurves(objects) };
}

describe("surface opacity", () => {
  it("defaults to 0.45 when the scene has a curve, polyline or pcurve, else to 1", () => {
    expect(hasCurves([cylinder])).toBe(false);
    expect(hasCurves([cylinder, circle])).toBe(true);
    expect(hasCurves([obj("L", { type: "polyline", points: [[0, 0, 0], [1, 0, 0]] })])).toBe(true);
    expect(hasCurves([obj("q", { type: "pcurve", surface: "Y", curve: { type: "polyline", points: [[0, 0, 0], [1, 0, 0]] } })])).toBe(true);
    expect(hasCurves([obj("P", { type: "point", p: [0, 0, 0] })])).toBe(false);
    expect(surfaceAlpha(cylinder, false)).toBe(1);
    expect(surfaceAlpha(cylinder, true)).toBe(SURFACE_ALPHA_WITH_CURVES);
  });

  it("lets an explicit style.opacity win, clamped to [0, 1]", () => {
    expect(surfaceAlpha({ ...cylinder, style: { opacity: 0.8 } }, true)).toBe(0.8);
    expect(surfaceAlpha({ ...cylinder, style: { opacity: 3 } }, true)).toBe(1);
    expect(surfaceAlpha({ ...cylinder, style: { opacity: 0 } }, false)).toBe(0);
  });

  it("applies to the surface's mesh", () => {
    expect(objectDraw3D(cylinder, ctx([cylinder, circle])).surface?.alpha).toBe(SURFACE_ALPHA_WITH_CURVES);
    expect(objectDraw3D(cylinder, ctx([cylinder])).surface?.alpha).toBe(1);
  });
});

describe("isolines and wire", () => {
  it("reads [nu, nv], true, or wire's default", () => {
    expect(isolineCounts(undefined)).toBeNull();
    expect(isolineCounts({ isolines: [4, 2] })).toEqual([4, 2]);
    expect(isolineCounts({ isolines: true })).toEqual(ISOLINES);
    expect(isolineCounts({ wire: true })).toEqual(WIRE_ISOLINES);
    expect(isolineCounts({ isolines: [4, 2], wire: true })).toEqual([4, 2]);
    expect(isolineCounts({ isolines: [1.5, 2] })).toBeNull();
    expect(isolineCounts({ isolines: false })).toBeNull();
  });

  it("draws nu + nv isolines on the surface, keeping the fill", () => {
    const d = objectDraw3D({ ...cylinder, extras: { isolines: [4, 2] } }, ctx([cylinder]));
    expect(d.surface).not.toBeNull();
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].paths).toHaveLength(6);
    expect(d.lines[0].px).toBe(1);
    const [u0, u1] = [0, 2 * Math.PI];
    const first = d.lines[0].paths[0][0]; // the first constant-u line, at the middle of the first of 4 cells, from v = -1
    const want = evalSurface(cylinder.geom as never, u0 + (u1 - u0) / 8, -1);
    first.forEach((x, i) => expect(x).toBeCloseTo(want[i], 12));
  });

  it("draws a wireframe as lines only: its isolines and the window's edges", () => {
    const d = objectDraw3D({ ...cylinder, extras: { wire: true } }, ctx([cylinder]));
    expect(d.surface).toBeNull();
    const paths = d.lines.flatMap((l) => l.paths);
    expect(paths).toHaveLength(WIRE_ISOLINES[0] + WIRE_ISOLINES[1] + 4);
  });
});

describe("objectDraw3D", () => {
  it("draws a curve inside the view box with its parameters for picking, labelled 30 % along", () => {
    const d = objectDraw3D(circle, ctx([circle]));
    expect(d.lines[0].px).toBe(3);
    expect(d.pick.polylines[0].ts![0]).toBe(0);
    const pts = d.lines[0].paths[0];
    expect(d.texts).toEqual([{ key: "c:C", id: "C", text: "C", at: pts[Math.floor((pts.length - 1) * 0.3)], color: null, kind: "curve" }]);
  });

  it("dashes a dashed curve in world units", () => {
    const d = objectDraw3D({ ...circle, style: { dashed: true } }, ctx([circle]));
    expect(d.lines[0].paths.length).toBeGreaterThan(20);
    expect(d.pick.polylines).toHaveLength(1); // hover still follows the whole curve
  });

  it("lifts a pcurve onto its surface, and draws nothing while the surface is missing", () => {
    const ring = obj("ring", { type: "pcurve", surface: "Y", curve: { type: "line", o: [0, 1.5, 0], d: [1, 0, 0] } });
    const d = objectDraw3D(ring, ctx([cylinder, ring]));
    for (const p of d.lines[0].paths[0]) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(2, 9);
      expect(p[2]).toBeCloseTo(1.5, 12);
    }
    expect(d.texts[0].key).toBe("c:ring");
    const lost = objectDraw3D(ring, ctx([ring]));
    expect(lost.lines).toEqual([]);
    expect(lost.texts).toEqual([]);
  });

  it("gives a point a marker, a dot to pick and a coordinate label", () => {
    const d = objectDraw3D(obj("P", { type: "point", p: [1, 2, 3] }), ctx([]));
    expect(d.markers).toEqual([{ id: "P", at: [[1, 2, 3]], color: "#3a7cc2", px: 4.5, alpha: 1, extra: false }]);
    expect(d.pick.dots).toEqual([[1, 2, 3]]);
    expect(d.texts[0].text).toBe("P (1, 2, 3)");
  });

  it("draws curve extras dashed and lighter-weight, with named markers", () => {
    const e = obj("E", { type: "ellipse", frame: world, a: 3, b: 2 }, { extras: { foci: true, axes: true } });
    const d = objectDraw3D(e, ctx([e]));
    const extra = d.lines.find((l) => l.extra)!;
    expect(extra.px).toBe(1.5);
    expect(extra.paths.length).toBeGreaterThan(2);
    expect(d.markers[0].extra).toBe(true);
    expect(d.texts.filter((t) => t.kind === "extra").map((t) => t.text)).toEqual(["F₁", "F₂"]);
  });

  it("labels a surface at the middle of its window", () => {
    const d = objectDraw3D(cylinder, ctx([cylinder]));
    const want = evalSurface(cylinder.geom as never, Math.PI, 1.5);
    d.texts[0].at.forEach((x, i) => expect(x).toBeCloseTo(want[i], 12));
  });
});

describe("screenPx", () => {
  it("scales for presentation and adds the highlight", () => {
    expect(screenPx(3, 1, false)).toBe(3);
    expect(screenPx(3, 1.5, false)).toBe(4.5);
    expect(screenPx(3, 1.5, true)).toBe(6);
  });
});
````

Patch `frontend/test/sample.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/sample.test.ts b/frontend/test/sample.test.ts
index 89af9f9..85d512a 100644
--- a/frontend/test/sample.test.ts
+++ b/frontend/test/sample.test.ts
@@ -85,4 +85,12 @@ describe("dashPolyline", () => {
   it("gives nothing for a single point", () => {
     expect(dashPolyline([[1, 1]], 6, 4)).toEqual([]);
   });
+
+  it("dashes a 3D polyline by its length in space", () => {
+    const dashes = dashPolyline<[number, number, number]>([[0, 0, 0], [0, 3, 4]], 1, 1.5);
+    expect(dashes).toHaveLength(2);
+    const close = (p: number[], q: number[]) => p.forEach((x, i) => expect(x).toBeCloseTo(q[i], 12));
+    close(dashes[0][1], [0, 0.6, 0.8]); // 1 along the 3-4-5 segment
+    close(dashes[1][0], [0, 1.5, 2]); // the second dash starts 1 + 1.5 along
+  });
 });
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/render3d.test.ts test/sample.test.ts)
````

Expected: `render3d.test.ts` cannot load `../src/view3d/render`, and `sample.test.ts › dashes a 3D polyline by its length in space` fails (`Tests 1 failed | 11 passed (12)`).

- [ ] **Step 3: Implement**

Create `frontend/src/view3d/render.ts`:

````ts
import { halfSize } from "../geom/bounds";
import { curveExtras } from "../geom/extras";
import { liftPcurve, pcurveSurface } from "../geom/pcurve";
import { Sampled, dashPolyline } from "../geom/sample";
import { evalSurface } from "../geom/surfaces";
import {
  SurfaceGrid,
  TriMesh,
  WORLD_TOL,
  arrowPolylines,
  curvePieces,
  isoLines,
  surfaceGrid,
  tessellateSurface,
  windowEdges,
} from "../geom/tessellate";
import { Geom, isCurve, isPcurve, isSurface } from "../geom/types";
import type { Box, Vec3 } from "../geom/vec";
import type { SceneObject } from "../protocol";
import { colorOf } from "../ui/colors";
import { fmtPoint } from "../ui/format";
import type { TextKind } from "../view2d/render";

/** Spec §5.3: curves are 3 px wide whatever the zoom. */
export const LINE_PX = 3;
/** Isolines and a wireframe's window edges. */
export const EDGE_PX = 1;
export const EXTRA_PX = 1.5;
/** Marker radii, like the plane view's dots. */
export const POINT_PX = 4.5;
export const EXTRA_DOT_PX = 3.5;
export const HIGHLIGHT_PX = 1.5;
/** Spec §5.3: surfaces default to this opacity when the scene has curves, so the curves on them show. */
export const SURFACE_ALPHA_WITH_CURVES = 0.45;
/** `isolines: true`, and the lines of `wire` when it has no `isolines` of its own. */
export const ISOLINES: [number, number] = [12, 6];
export const WIRE_ISOLINES: [number, number] = [24, 12];
/** 3D dashes are cut in world units: this fraction of the view box's half-size drawn, then skipped. */
export const DASH: [number, number] = [0.03, 0.02];

export interface Lines3D {
  id: string;
  extra: boolean;
  paths: Vec3[][];
  color: string;
  /** Width in CSS pixels before presentation scaling and highlight. */
  px: number;
  alpha: number;
}

export interface Surface3D {
  id: string;
  mesh: TriMesh;
  /** The analytic surface's grid (picking maps the mesh's normalized uvs back through it); null for a mesh. */
  grid: SurfaceGrid | null;
  color: string;
  alpha: number;
}

export interface Markers3D {
  id: string;
  at: Vec3[];
  color: string;
  /** Radius in CSS pixels before presentation scaling and highlight. */
  px: number;
  alpha: number;
  extra: boolean;
}

export interface Text3D {
  key: string;
  id: string;
  text: string;
  at: Vec3;
  /** null: the theme's text colour. */
  color: string | null;
  kind: TextKind;
}

/** What hover can hit, in world space: polylines (with their parameters, for curves and pcurves) and dots. */
export interface Pickable3D {
  id: string;
  polylines: { pts: Vec3[]; ts: number[] | null }[];
  dots: Vec3[];
}

/** One object's share of the 3D scene. */
export interface ObjectDraw3D {
  id: string;
  lines: Lines3D[];
  surface: Surface3D | null;
  markers: Markers3D[];
  texts: Text3D[];
  pick: Pickable3D;
}

export interface Context3D {
  /** The view box (spec §5.3: the scene's ×1.5): infinite curves are clipped to it, windowless surfaces sized by it. */
  box: Box;
  /** Other objects' geometry by id (a pcurve's surface). */
  lookup: (id: string) => Geom | undefined;
  /** The scene has a curve, polyline or pcurve (default surface opacity). */
  withCurves: boolean;
}

const labelOf = (o: SceneObject): string => o.label ?? o.id;

/** True when surfaces default to see-through: some curve, polyline or pcurve is in the scene. */
export function hasCurves(objects: Iterable<SceneObject>): boolean {
  for (const o of objects) if (isCurve(o.geom) || isPcurve(o.geom) || o.geom.type === "polyline") return true;
  return false;
}

/** A surface's opacity: `style.opacity` when given (clamped), else 0.45 among curves and 1 alone. */
export function surfaceAlpha(o: SceneObject, withCurves: boolean): number {
  const given = o.style?.opacity;
  if (given !== undefined) return Math.min(Math.max(given, 0), 1);
  return withCurves ? SURFACE_ALPHA_WITH_CURVES : 1;
}

/** Isoline counts from the `isolines` and `wire` extras: `[nu, nv]`, `true` for the default, else none. */
export function isolineCounts(extras: Record<string, unknown> | undefined): [number, number] | null {
  const iso = extras?.isolines;
  if (Array.isArray(iso) && iso.length === 2 && iso.every((n) => Number.isInteger(n) && n >= 0)) return [iso[0], iso[1]];
  if (iso === true) return ISOLINES;
  return extras?.wire ? WIRE_ISOLINES : null;
}

/** Width or radius on screen: the base pixels × presentation scale, plus the highlight when hovered or selected. */
export const screenPx = (px: number, widthScale: number, lit: boolean): number => px * widthScale + (lit ? HIGHLIGHT_PX : 0);

/** Where a curve's label goes: 30 % along its longest piece. */
function curveAnchor(pieces: Vec3[][]): Vec3 | null {
  let best: Vec3[] = [];
  for (const p of pieces) if (p.length > best.length) best = p;
  return best.length ? best[Math.floor((best.length - 1) * 0.3)] : null;
}

/**
 * The 3D view's share of one object (spec §5.3): line pieces, a surface mesh, markers,
 * labels and what hover can pick, all in world units. Pure, so the view's content is
 * testable without WebGL; widths stay in pixels for the view to scale.
 */
export function objectDraw3D(o: SceneObject, ctx: Context3D): ObjectDraw3D {
  const out: ObjectDraw3D = { id: o.id, lines: [], surface: null, markers: [], texts: [], pick: { id: o.id, polylines: [], dots: [] } };
  const g = o.geom;
  const color = colorOf(o);
  const alpha = Math.min(Math.max(o.style?.opacity ?? 1, 0), 1);
  const half = halfSize(ctx.box);
  const tol = WORLD_TOL * half;
  const dash = (paths: Vec3[][]): Vec3[][] => paths.flatMap((p) => dashPolyline(p, DASH[0] * half, DASH[1] * half));
  const stroke = (paths: Vec3[][], extra = false, px = extra ? EXTRA_PX : (o.style?.width ?? LINE_PX)) => {
    const drawn = paths.filter((p) => p.length >= 2);
    if (drawn.length) out.lines.push({ id: o.id, extra, paths: extra || o.style?.dashed ? dash(drawn) : drawn, color, px, alpha });
  };
  const curve = (pieces: Sampled<Vec3>[]) => {
    const paths = pieces.map((s) => s.pts);
    stroke(paths);
    out.pick.polylines.push(...pieces.map((s) => ({ pts: s.pts, ts: s.ts })));
    const at = curveAnchor(paths);
    if (at) out.texts.push({ key: `c:${o.id}`, id: o.id, text: labelOf(o), at, color: null, kind: "curve" });
  };

  if (isCurve(g)) {
    curve(curvePieces(g, ctx.box, tol));
    if (o.extras) {
      const extras = curveExtras(g, o.extras);
      stroke(extras.lines.flatMap((l) => curvePieces(l, ctx.box, tol).map((s) => s.pts)), true);
      if (extras.points.length) {
        out.markers.push({ id: o.id, at: extras.points.map((x) => x.p), color, px: EXTRA_DOT_PX, alpha, extra: true });
        for (const x of extras.points) out.texts.push({ key: `x:${o.id}:${x.name}`, id: o.id, text: x.name, at: x.p, color: null, kind: "extra" });
      }
    }
  } else if (isPcurve(g)) {
    const s = pcurveSurface(g, ctx.lookup);
    if (s) curve(liftPcurve(g, s, ctx.box, tol));
  } else if (isSurface(g)) {
    const grid = surfaceGrid(g, half, tol);
    out.surface = { id: o.id, mesh: tessellateSurface(g, grid), grid, color, alpha: surfaceAlpha(o, ctx.withCurves) };
    const counts = isolineCounts(o.extras);
    if (counts) stroke(isoLines(g, grid, counts[0], counts[1]), false, EDGE_PX);
    if (o.extras?.wire) {
      stroke(windowEdges(g, grid), false, EDGE_PX);
      out.surface = null; // a wireframe is its lines only
    }
    const mid = evalSurface(g, (grid.u[0] + grid.u[1]) / 2, (grid.v[0] + grid.v[1]) / 2);
    out.texts.push({ key: `s:${o.id}`, id: o.id, text: labelOf(o), at: mid, color: null, kind: "curve" });
  } else if (g.type === "mesh") {
    const mesh = { positions: g.vertices.flat(), indices: g.indices, uvs: [] };
    out.surface = { id: o.id, mesh, grid: null, color, alpha: surfaceAlpha(o, ctx.withCurves) };
  } else if (g.type === "polyline" || g.type === "arrow") {
    const lines = g.type === "polyline" ? [g.points] : arrowPolylines(g.at, g.vec);
    stroke(lines);
    out.pick.polylines = lines.map((pts) => ({ pts, ts: null }));
  } else if (g.type === "point") {
    out.markers.push({ id: o.id, at: [g.p], color, px: POINT_PX, alpha, extra: false });
    out.pick.dots.push(g.p);
    out.texts.push({ key: `p:${o.id}`, id: o.id, text: `${labelOf(o)} ${fmtPoint(g.p)}`, at: g.p, color: null, kind: "point" });
  } else if (g.type === "points") {
    out.markers.push({ id: o.id, at: g.positions, color, px: g.size ?? 3, alpha, extra: false });
    out.pick.dots.push(...g.positions);
    if (g.positions.length) out.texts.push({ key: `p:${o.id}`, id: o.id, text: labelOf(o), at: g.positions[0], color: null, kind: "point" });
  } else if (g.type === "text") {
    out.texts.push({ key: `t:${o.id}`, id: o.id, text: g.text, at: g.at, color: o.style?.color ? color : null, kind: "text" });
  }
  return out;
}
````

Patch `frontend/src/geom/sample.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/sample.ts b/frontend/src/geom/sample.ts
index 810b61f..652f66b 100644
--- a/frontend/src/geom/sample.ts
+++ b/frontend/src/geom/sample.ts
@@ -64,26 +64,28 @@ export function sampleAdaptive<P extends number[] = Vec2>(
   return { pts, ts };
 }
 
+const dist = (a: number[], b: number[]): number => Math.hypot(...a.map((x, i) => b[i] - x));
+
 /**
- * Dashes along a polyline: `dash` pixels drawn, `gap` skipped, repeating across corners.
- * Returns the line solid when it would take more than `maxDashes` dashes.
+ * Dashes along a polyline, in 2D (pixels) or 3D (world units): `dash` drawn, `gap` skipped,
+ * repeating across corners. Returns the line solid when it would take more than `maxDashes` dashes.
  */
-export function dashPolyline(pts: Vec2[], dash: number, gap: number, maxDashes = 5000): Vec2[][] {
+export function dashPolyline<P extends number[] = Vec2>(pts: P[], dash: number, gap: number, maxDashes = 5000): P[][] {
   if (pts.length < 2) return [];
   let total = 0;
-  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
+  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
   if (!(dash > 0 && gap > 0) || total / (dash + gap) > maxDashes) return [pts];
-  const out: Vec2[][] = [];
+  const out: P[][] = [];
   let on = true;
-  let left = dash; // pixels left in the current dash or gap
-  let current: Vec2[] = [pts[0]];
+  let left = dash; // length left in the current dash or gap
+  let current: P[] = [pts[0]];
   for (let i = 1; i < pts.length; i++) {
     let a = pts[i - 1];
     const b = pts[i];
-    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
+    let seg = dist(a, b);
     while (seg > left) {
       const s = left / seg;
-      const cut: Vec2 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
+      const cut = a.map((x, k) => x + (b[k] - x) * s) as P;
       if (on) {
         current.push(cut);
         out.push(current);
PATCH
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/render3d.test.ts test/sample.test.ts)
(cd frontend && npx vitest run && npx tsc --noEmit)
````

Expected: 25 passed (25); vitest 241 passed in 23 files; `tsc` prints nothing.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/src/geom/sample.ts frontend/src/view3d/render.ts frontend/test/render3d.test.ts frontend/test/sample.test.ts
git commit -m "3d: a pure per-object draw model (pixel widths, world dashes, 0.45 surface default, isolines and wire, lifted pcurves, labels, pickables)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 6: 3D camera math and the ground

**Camera.** `src/camera.ts` moves to `src/view3d/camera.ts` and grows:
- the snap views (`SNAPS`). Top is α = π/2, β = 0, looking down z with x right and y up like the plane view; iso sits on the (1, −1, 1) diagonal;
- `fitRadius`: three half-diagonals, more in a narrow pane;
- `orthoExtents`: an orthographic frustum matching what the perspective camera shows at its target;
- `pixelSize`: the world length of one pixel at a depth, used for screen-size markers.

These are tested against Babylon's `NullEngine`.

**Ground.** `view3d/scene.ts` builds the ground grid on z = 0 across the view box, with a 1-2-5 major step of about ten cells and minor lines between the majors only. It also builds the axis triad, two major steps long: x red, y green, z blue.

**Files:**
- Create: `frontend/src/view3d/camera.ts`, `frontend/src/view3d/scene.ts`, `frontend/test/camera3d.test.ts`, `frontend/test/scene3d.test.ts`
- Modify: `frontend/src/view3d.ts`
- Delete: `frontend/src/camera.ts`, `frontend/test/camera.test.ts`

**Interfaces:**
- Produces (`view3d/camera.ts`):
  - `cameraScale(radius)` (moved);
  - `type Snap = "top" | "front" | "right" | "iso"`;
  - `SNAPS: Record<Snap, { alpha; beta }>`;
  - `fitRadius(box, aspect)`;
  - `orthoExtents(radius, fov, aspect) → { orthoTop, orthoBottom, orthoLeft, orthoRight }`;
  - `interface PixelGauge { ortho; fov; orthoHeight; heightPx }`;
  - `pixelSize(g, depth)`.
- Produces (`view3d/scene.ts`): `AXIS_COLORS`; `interface Ground { major; minor; majorStep; axes }`; `ground(box)`.
- Removes: `src/camera.ts`, `test/camera.test.ts`. The `cameraScale` tests move to `camera3d.test.ts`.

- [ ] **Step 1: Write the failing tests (and retire the old camera test)**

Create `frontend/test/camera3d.test.ts`:

````ts
import { ArcRotateCamera, Camera, Matrix, NullEngine, Scene, Vector3, Viewport } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import type { Vec3 } from "../src/geom/vec";
import { SNAPS, Snap, cameraScale, fitRadius, orthoExtents, pixelSize } from "../src/view3d/camera";

const W = 400;
const H = 300;

/** A z-up, right-handed Babylon scene without WebGL, like the view's. */
function rig() {
  const engine = new NullEngine({ renderWidth: W, renderHeight: H, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const cam = new ArcRotateCamera("cam", 0, 1, 10, Vector3.Zero(), scene);
  cam.upVector = new Vector3(0, 0, 1);
  cam.lowerBetaLimit = 0;
  const project = (p: Vec3): [number, number] => {
    scene.updateTransformMatrix(true);
    const s = Vector3.Project(new Vector3(...p), Matrix.Identity(), scene.getTransformMatrix(), new Viewport(0, 0, W, H));
    return [s.x, s.y];
  };
  return { cam, project };
}

function snapTo(cam: ArcRotateCamera, snap: Snap): void {
  cam.alpha = SNAPS[snap].alpha;
  cam.beta = SNAPS[snap].beta;
}

describe("cameraScale", () => {
  it("keeps Babylon's default feel at a radius of 10", () => {
    const s = cameraScale(10);
    expect(s.wheelPrecision).toBeCloseTo(3);
    expect(s.panningSensibility).toBeCloseTo(1000);
  });

  it("scales the clip planes and input feel with the scene", () => {
    const small = cameraScale(0.01);
    const large = cameraScale(1000);
    expect(small.minZ).toBeCloseTo(1e-5);
    expect(small.maxZ).toBeCloseTo(1);
    expect(large.maxZ).toBeCloseTo(1e5);
    expect(small.wheelPrecision).toBeGreaterThan(large.wheelPrecision);
    expect(small.panningSensibility).toBeGreaterThan(large.panningSensibility);
  });
});

describe("snap views", () => {
  /** Screen direction of a world axis from the origin: [right, up] in pixels. */
  const screenDir = (snap: Snap, axis: Vec3): [number, number] => {
    const { cam, project } = rig();
    snapTo(cam, snap);
    const [ox, oy] = project([0, 0, 0]);
    const [x, y] = project(axis);
    return [x - ox, oy - y];
  };
  // Babylon nudges β = 0 off the pole by 1e-4 rad: the view axis then shows as a few thousandths of a pixel.
  const right = (d: [number, number]) => d[0] > 10 && Math.abs(d[1]) < 0.01;
  const up = (d: [number, number]) => d[1] > 10 && Math.abs(d[0]) < 0.01;
  const away = (d: [number, number]) => Math.hypot(...d) < 0.01;

  it("top looks down z with x right and y up, like the plane view", () => {
    expect(right(screenDir("top", [1, 0, 0]))).toBe(true);
    expect(up(screenDir("top", [0, 1, 0]))).toBe(true);
    expect(away(screenDir("top", [0, 0, 1]))).toBe(true);
  });

  it("front shows x right and z up", () => {
    expect(right(screenDir("front", [1, 0, 0]))).toBe(true);
    expect(up(screenDir("front", [0, 0, 1]))).toBe(true);
    expect(away(screenDir("front", [0, 1, 0]))).toBe(true);
  });

  it("right shows y right and z up", () => {
    expect(right(screenDir("right", [0, 1, 0]))).toBe(true);
    expect(up(screenDir("right", [0, 0, 1]))).toBe(true);
    expect(away(screenDir("right", [1, 0, 0]))).toBe(true);
  });

  it("iso sits on the (1, −1, 1) diagonal with z up", () => {
    const { cam } = rig();
    snapTo(cam, "iso");
    cam.getViewMatrix(true); // the camera's position follows its angles when the view matrix is rebuilt
    const p = cam.position.normalizeToNew();
    [p.x, p.y, p.z].forEach((c, i) => expect(c).toBeCloseTo([1, -1, 1][i] / Math.sqrt(3), 9));
    expect(screenDir("iso", [0, 0, 1])[1]).toBeGreaterThan(10);
  });
});

describe("orthographic camera", () => {
  it("shows at the target what the perspective camera shows there", () => {
    const { cam, project } = rig();
    snapTo(cam, "front");
    const edge: Vec3 = [0, 0, 10 * Math.tan(cam.fov / 2)]; // the top of the perspective view at the target
    expect(project(edge)[1]).toBeCloseTo(0, 4);
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    Object.assign(cam, orthoExtents(cam.radius, cam.fov, W / H));
    expect(project(edge)[1]).toBeCloseTo(0, 4);
    expect(project([10 * Math.tan(cam.fov / 2) * (W / H), 0, 0])[0]).toBeCloseTo(W, 4);
  });
});

describe("pixelSize", () => {
  it("is the world length that projects to one pixel, in perspective and orthographic", () => {
    const { cam, project } = rig();
    snapTo(cam, "front");
    const at = (z: number, depth: number): Vec3 => [0, depth - 10, z]; // the camera is at y = -10, looking along +y
    for (const depth of [5, 10, 20]) {
      const s = pixelSize({ ortho: false, fov: cam.fov, orthoHeight: 0, heightPx: H }, depth);
      expect(project(at(0, depth))[1] - project(at(s, depth))[1]).toBeCloseTo(1, 6);
    }
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    const ex = orthoExtents(cam.radius, cam.fov, W / H);
    Object.assign(cam, ex);
    const s = pixelSize({ ortho: true, fov: cam.fov, orthoHeight: ex.orthoTop - ex.orthoBottom, heightPx: H }, 123);
    expect(project([0, 0, 0])[1] - project([0, 0, s])[1]).toBeCloseTo(1, 6);
  });
});

describe("fitRadius", () => {
  it("backs off three half-diagonals, more in a narrow pane", () => {
    const box = { min: [0, 0, 0] as Vec3, max: [2, 2, 1] as Vec3 };
    expect(fitRadius(box, 2)).toBeCloseTo(4.5, 12);
    expect(fitRadius(box, 0.5)).toBeCloseTo(9, 12);
    expect(fitRadius({ min: [1, 1, 1], max: [1, 1, 1] }, 1)).toBeCloseTo(3e-6, 18);
  });
});
````

Create `frontend/test/scene3d.test.ts`:

````ts
import { describe, expect, it } from "vitest";
import type { Box } from "../src/geom/vec";
import { ground } from "../src/view3d/scene";

describe("ground", () => {
  const box: Box = { min: [-7.5, -7.5, -7.5], max: [7.5, 7.5, 7.5] };

  it("rules z = 0 across the view box with a 1-2-5 major step, about ten cells", () => {
    const g = ground(box);
    expect(g.majorStep).toBe(2); // niceStep(7.5 / 5)
    const xs = g.major.filter((l) => l[0][0] === l[1][0]).map((l) => l[0][0]);
    expect(xs).toEqual([-6, -4, -2, 0, 2, 4, 6]);
    for (const l of g.major) {
      expect(l.every((p) => p[2] === 0)).toBe(true);
    }
    expect(g.major.find((l) => l[0][1] === l[1][1])).toEqual([[-7.5, -6, 0], [7.5, -6, 0]]);
  });

  it("puts minor lines between the major ones only (a 2 step splits in 4)", () => {
    const xs = ground(box).minor.filter((l) => l[0][0] === l[1][0]).map((l) => l[0][0]);
    expect(xs).toContain(-0.5);
    expect(xs).not.toContain(0);
    expect(xs).not.toContain(2);
    expect(xs).toHaveLength(31 - 7); // the 31 multiples of 0.5 in [-7.5, 7.5], less the 7 majors
  });

  it("draws the axis triad two major steps long, x red, y green, z blue", () => {
    const { axes } = ground(box);
    expect(axes.map((a) => [a.name, a.to])).toEqual([["x", [4, 0, 0]], ["y", [0, 4, 0]], ["z", [0, 0, 4]]]);
    expect(new Set(axes.map((a) => a.color)).size).toBe(3);
  });

  it("follows the scene's scale", () => {
    expect(ground({ min: [0, 0, 0], max: [0.03, 0.03, 0.03] }).majorStep).toBe(0.005);
  });
});
````

Delete `frontend/test/camera.test.ts`:

````bash
git rm -q frontend/test/camera.test.ts
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/camera3d.test.ts test/scene3d.test.ts)
````

Expected: `Test Files 2 failed (2)`, no tests: `../src/view3d/camera` and `../src/view3d/scene` do not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/view3d/camera.ts`:

````ts
import type { Box } from "../geom/vec";

/** Babylon's default feel (wheelPrecision 3, panningSensibility 1000) at a camera radius of 10. */
const WHEEL_FEEL = 30;
const PAN_FEEL = 10000;

/**
 * Clip planes and input sensitivity for a scene that fits a camera at `radius`.
 * Babylon's defaults (clip 1 .. 10000) would hide scenes much smaller or larger than ~10 units.
 */
export function cameraScale(radius: number) {
  return {
    minZ: radius / 1000,
    maxZ: radius * 100,
    wheelPrecision: WHEEL_FEEL / radius,
    panningSensibility: PAN_FEEL / radius,
  };
}

export type Snap = "top" | "front" | "right" | "iso";

/**
 * Snap views (spec §5.3) as ArcRotate angles for a z-up, right-handed scene, where the
 * camera sits at target + r (cos α sin β, −sin α sin β, cos β). Top looks down −z with x
 * right and y up, like the plane view; front looks along +y (x right, z up); right along −x
 * (y right, z up); iso from (1, −1, 1). Top needs the camera's lowerBetaLimit at 0.
 */
export const SNAPS: Record<Snap, { alpha: number; beta: number }> = {
  top: { alpha: Math.PI / 2, beta: 0 },
  front: { alpha: Math.PI / 2, beta: Math.PI / 2 },
  right: { alpha: 0, beta: Math.PI / 2 },
  iso: { alpha: Math.PI / 4, beta: Math.acos(1 / Math.sqrt(3)) },
};

/** Distance at which the camera frames `box` (the field of view is vertical, so a narrow pane backs off). */
export function fitRadius(box: Box, aspect: number): number {
  const halfDiagonal = Math.hypot(...box.max.map((m, i) => m - box.min[i])) / 2;
  return (Math.max(halfDiagonal, 1e-6) * 3) / Math.min(1, aspect || 1);
}

/** Orthographic extents that show at the target what the perspective camera at `radius` shows there. */
export function orthoExtents(radius: number, fov: number, aspect: number) {
  const half = radius * Math.tan(fov / 2);
  return { orthoTop: half, orthoBottom: -half, orthoLeft: -half * aspect, orthoRight: half * aspect };
}

export interface PixelGauge {
  ortho: boolean;
  /** Vertical field of view (perspective). */
  fov: number;
  /** orthoTop − orthoBottom (orthographic). */
  orthoHeight: number;
  /** The pane's height in CSS pixels. */
  heightPx: number;
}

/** World length of one CSS pixel at `depth` along the view direction (screen-size markers). */
export function pixelSize(g: PixelGauge, depth: number): number {
  const visible = g.ortho ? g.orthoHeight : 2 * Math.max(depth, 0) * Math.tan(g.fov / 2);
  return visible / Math.max(g.heightPx, 1);
}
````

Create `frontend/src/view3d/scene.ts`:

````ts
import { halfSize } from "../geom/bounds";
import type { Box, Vec3 } from "../geom/vec";
import { gridSpacing, ticks } from "../view2d/plane";

/** The axis triad's colours: x red, y green, z blue. */
export const AXIS_COLORS = { x: "#d64545", y: "#3c9a4a", z: "#3b6fd4" } as const;

export interface Ground {
  /** Grid lines on z = 0 across the view box, major every `major`, minor between them. */
  major: Vec3[][];
  minor: Vec3[][];
  majorStep: number;
  /** The axis triad from the origin, two major steps long, each with its letter at the tip. */
  axes: { name: "x" | "y" | "z"; to: Vec3; color: string }[];
}

/** Spec §5.3: a ground grid on z = 0 under the scene, about ten major cells across the view box, and the axis triad. */
export function ground(box: Box): Ground {
  const { major, minor } = gridSpacing(1, halfSize(box) / 5);
  const [x0, x1] = [box.min[0], box.max[0]];
  const [y0, y1] = [box.min[1], box.max[1]];
  const lines = (step: number, skip: number | null): Vec3[][] => {
    const keep = (v: number) => skip === null || Math.abs(v / skip - Math.round(v / skip)) > 1e-9;
    return [
      ...ticks(x0, x1, step).filter(keep).map((x): Vec3[] => [[x, y0, 0], [x, y1, 0]]),
      ...ticks(y0, y1, step).filter(keep).map((y): Vec3[] => [[x0, y, 0], [x1, y, 0]]),
    ];
  };
  const len = 2 * major;
  return {
    major: lines(major, null),
    minor: lines(minor, major),
    majorStep: major,
    axes: [
      { name: "x", to: [len, 0, 0], color: AXIS_COLORS.x },
      { name: "y", to: [0, len, 0], color: AXIS_COLORS.y },
      { name: "z", to: [0, 0, len], color: AXIS_COLORS.z },
    ],
  };
}
````

Patch `frontend/src/view3d.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/view3d.ts b/frontend/src/view3d.ts
index 1d68f44..83d2fc3 100644
--- a/frontend/src/view3d.ts
+++ b/frontend/src/view3d.ts
@@ -1,5 +1,5 @@
 import * as BABYLON from "@babylonjs/core";
-import { cameraScale } from "./camera";
+import { cameraScale } from "./view3d/camera";
 import { Changes, FrameScheduler } from "./frame";
 import { halfSize, sameBox, sceneBounds, viewBox } from "./geom/bounds";
 import { WORLD_TOL, arrowPolylines, curvePieces, surfaceGrid, tessellateSurface } from "./geom/tessellate";
PATCH
````

Delete `frontend/src/camera.ts`:

````bash
git rm -q frontend/src/camera.ts
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/camera3d.test.ts test/scene3d.test.ts)
(cd frontend && npx vitest run && npx tsc --noEmit)
````

Expected: 13 passed (13); vitest 252 passed in 24 files; `tsc` prints nothing.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/src/view3d.ts frontend/src/view3d/camera.ts frontend/src/view3d/scene.ts frontend/test/camera3d.test.ts frontend/test/scene3d.test.ts
git commit -m "3d: snap views, fit radius, orthographic extents and pixel size (tested on NullEngine); ground grid and axis triad

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 7: The Babylon 3D view

This task replaces `src/view3d.ts` with `src/view3d/view.ts`, which renders the draw model.

**Rendering:**
- Curves are GreasedLines: STANDARD material, `sizeAttenuation`, width = 2 × pixels. Widths are re-set when the presentation scale changes.
- Surfaces are StandardMaterial meshes with alpha and `zOffset`.
- Markers are thin-instanced spheres, rescaled every frame to their pixel size.
- The grid is a backdrop: rendering group 0, no depth write. Objects and axes go in group 1.

**Behaviour:**
- The toolbar switches perspective/orthographic and snaps the camera.
- A fit waits for a shown, laid-out pane (`fitPending`).
- Changes are coalesced per frame. The view rebuilds everything on a reset, a view-box change or a change in whether the scene has curves. pcurves rebuild when their surface changes.

Hover, labels and the (u,v) link come in Tasks 8 and 11. The e2e tests post the quadrics scene and check:
- the cylinder and cone colours on screen;
- the toolbar's snap and projection.

**Files:**
- Create: `frontend/e2e/view3d.e2e.ts`, `frontend/src/view3d/view.ts`
- Modify: `frontend/index.html`, `frontend/src/main.ts`, `frontend/src/style.css`
- Delete: `frontend/src/view3d.ts`

**Interfaces:**
- Produces (`view3d/view.ts`):
  - `class View3D` with `constructor(store, ui, host)`, which creates `canvas#canvas3d` in `host`;
  - `readonly scene`, `camera`, `canvas`;
  - `get cameraState(): { alpha; beta; radius; target; ortho }`;
  - `setActive(active)`, `fitRequested()`, `setSnap(snap)`, `setOrtho(ortho)`.
- DOM:
  - `#view3d` is the 3D host (index.html);
  - `.toolbar3d` holds `button[data-projection]` (text `persp`/`ortho`) and `button[data-snap=top|front|right|iso]`.

- [ ] **Step 1: Write the failing e2e tests**

Create `frontend/e2e/view3d.e2e.ts`:

````ts
import { readFileSync } from "node:fs";
import { APIRequestContext, Page, expect, test } from "@playwright/test";

/** Post a scene saved by an example script (`--save frontend/e2e/scenes/<name>.json`) to the server. */
async function postScene(request: APIRequestContext, name: string): Promise<void> {
  const doc = JSON.parse(readFileSync(new URL(`./scenes/${name}.json`, import.meta.url), "utf8"));
  const res = await request.post("/api/objects", { data: doc });
  expect(res.ok()).toBe(true);
}

/** Pixels of the 3D canvas within 40 (per channel) of `hex`, after two frames. */
const pixelsLike = (page: Page, hex: string) =>
  page.evaluate(async (hex) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const src = document.getElementById("canvas3d") as HTMLCanvasElement;
    const c = document.createElement("canvas");
    [c.width, c.height] = [src.width, src.height];
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (want.every((w, k) => Math.abs(px[i + k] - w) <= 40)) n++;
    return n;
  }, hex);

type CameraState = { alpha: number; beta: number; radius: number; ortho: boolean };
const camera3d = (page: Page): Promise<CameraState> =>
  page.evaluate(() => (window as unknown as { __gv: { view3d: { cameraState: CameraState } } }).__gv.view3d.cameraState);

test.beforeEach(async ({ request }) => {
  await request.post("/api/clear", { data: {} });
});

test("the quadrics scene renders in 3D with its intersection curves", async ({ page, request }) => {
  await postScene(request, "quadrics_3d");
  await page.goto("/");
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "3d");
  await expect(page.locator("#count")).toHaveText("7 objects");
  await expect.poll(() => pixelsLike(page, "#c47f00")).toBeGreaterThan(100); // SY₁, 3 px wide
  await expect.poll(() => pixelsLike(page, "#b5448f")).toBeGreaterThan(100); // ΠK
});

test("the 3D toolbar snaps the camera and switches to orthographic", async ({ page, request }) => {
  await postScene(request, "quadrics_3d");
  await page.goto("/");
  await expect(page.locator("#count")).toHaveText("7 objects");
  await page.locator(".toolbar3d [data-snap=top]").click();
  expect((await camera3d(page)).beta).toBeLessThan(1e-3);
  await page.locator(".toolbar3d [data-snap=front]").click();
  expect((await camera3d(page)).beta).toBeCloseTo(Math.PI / 2, 6);
  await page.locator(".toolbar3d [data-projection]").click();
  await expect(page.locator(".toolbar3d [data-projection]")).toHaveText("ortho");
  expect((await camera3d(page)).ortho).toBe(true);
  await expect.poll(() => pixelsLike(page, "#c47f00")).toBeGreaterThan(100);
});
````

- [ ] **Step 2: Run the e2e tests to verify they fail**

Run:

````bash
(cd frontend && npm run build && npm run e2e -- view3d)
````

Expected: `2 failed`: the old view has no toolbar (the click on `[data-snap=top]` times out), and the quadrics colours are not found on `#canvas3d`.

- [ ] **Step 3: Implement**

Create `frontend/src/view3d/view.ts`:

````ts
import * as BABYLON from "@babylonjs/core";
import { Changes, FrameScheduler } from "../frame";
import { sameBox, sceneBounds, viewBox } from "../geom/bounds";
import { isPcurve } from "../geom/types";
import type { Box, Vec3 } from "../geom/vec";
import type { SceneObject } from "../protocol";
import type { Store } from "../store";
import type { UiEvent, UiState } from "../ui/state";
import { PALETTES, Palette, mixHex } from "../ui/theme";
import { EXTRA_MIX } from "../view2d/render";
import { SNAPS, Snap, cameraScale, fitRadius, orthoExtents, pixelSize } from "./camera";
import { Lines3D, Markers3D, ObjectDraw3D, hasCurves, objectDraw3D, screenPx } from "./render";
import { ground } from "./scene";

const v3 = (p: Vec3) => new BABYLON.Vector3(p[0], p[1], p[2]);
const color3 = (hex: string) => BABYLON.Color3.FromHexString(hex);
/** GreasedLine's width is twice what it covers on screen (measured: width 6 draws 3 px). */
const GREASED_PER_PX = 2;
const AXIS_PX = 2;

/** One object's Babylon meshes, kept with what they were built from (highlight and marker sizes change per frame). */
interface Built {
  draw: ObjectDraw3D;
  meshes: BABYLON.AbstractMesh[];
  lines: { mesh: BABYLON.GreasedLineBaseMesh; part: Lines3D }[];
  markers: { mesh: BABYLON.Mesh; part: Markers3D; matrices: Float32Array }[];
  surface: BABYLON.StandardMaterial | null;
}

/**
 * The 3D view (spec §5.3), z up and right-handed like geomcore: constant-pixel GreasedLine
 * curves, tessellated surfaces, screen-size markers, a ground grid and axis triad, and a
 * toolbar for perspective/orthographic and the snap views. Renders only while shown.
 */
export class View3D {
  readonly scene: BABYLON.Scene;
  readonly camera: BABYLON.ArcRotateCamera;
  readonly canvas: HTMLCanvasElement;
  private engine: BABYLON.Engine;
  private built = new Map<string, Built>();
  private groundMeshes: BABYLON.AbstractMesh[] = [];
  private box: Box = viewBox([]);
  private withCurves = false;
  private ortho = false;
  private userMoved = false;
  private active = false;
  /** A "fit" waiting for a shown, laid-out pane (a hidden canvas would give a stale aspect). */
  private fitPending = true;
  private framePending = false;
  private changes = new Changes();
  private frame = new FrameScheduler(() => this.flush());
  private toolbar: HTMLDivElement;

  constructor(
    private store: Store,
    private ui: UiState,
    private host: HTMLElement,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "canvas3d";
    host.appendChild(this.canvas);
    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: false });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.camera = new BABYLON.ArcRotateCamera("cam", SNAPS.iso.alpha, SNAPS.iso.beta, 10, BABYLON.Vector3.Zero(), this.scene);
    this.camera.upVector = new BABYLON.Vector3(0, 0, 1);
    this.camera.lowerBetaLimit = 0; // the top view looks straight down
    this.camera.attachControl(this.canvas, true);
    // Once the user has orbited, panned or zoomed, auto-fit leaves the camera alone until "fit".
    this.canvas.addEventListener("pointermove", (ev) => {
      if (ev.buttons) this.userMoved = true;
    });
    this.canvas.addEventListener("wheel", () => (this.userMoved = true), { passive: true });
    this.canvas.addEventListener("keydown", (ev) => {
      if (ev.key.startsWith("Arrow")) this.userMoved = true; // the camera's keyboard input
    });
    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0.3, 0.5, 1), this.scene);
    // The grid is a backdrop: drawn first (group 0) without writing depth, then the scene
    // (group 1) over it, so curves lying on z = 0 are not speckled by the lines they cross.
    this.scene.setRenderingAutoClearDepthStencil(1, false, false, false);
    this.scene.onBeforeRenderObservable.add(() => this.beforeRender());
    this.toolbar = this.makeToolbar();
    store.onChange((ev) => {
      if (ev.type === "meta") return;
      this.changes.note(ev);
      this.frame.request();
    });
    ui.onChange((ev) => this.uiChanged(ev));
    new ResizeObserver(() => {
      if (!this.active) return;
      this.resize();
      this.frame.request();
    }).observe(host);
    this.applyTheme();
    this.rebuild();
  }

  /** Debug and e2e access: the camera's position and projection. */
  get cameraState(): { alpha: number; beta: number; radius: number; target: Vec3; ortho: boolean } {
    const t = this.camera.target;
    return { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, target: [t.x, t.y, t.z], ortho: this.ortho };
  }

  /** Render (and apply pending changes) only while the 3D view is the one shown. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.resize();
      this.engine.runRenderLoop(() => this.scene.render());
      this.frame.request();
    } else {
      this.engine.stopRenderLoop();
    }
  }

  /** The "fit" button or key (or turning auto-fit on): frame the scene and follow it again, once the pane is shown. */
  fitRequested(): void {
    this.userMoved = false;
    this.fitPending = true;
    this.frame.request();
  }

  setSnap(snap: Snap): void {
    this.camera.alpha = SNAPS[snap].alpha;
    this.camera.beta = SNAPS[snap].beta;
  }

  setOrtho(ortho: boolean): void {
    this.ortho = ortho;
    this.camera.mode = ortho ? BABYLON.Camera.ORTHOGRAPHIC_CAMERA : BABYLON.Camera.PERSPECTIVE_CAMERA;
    this.toolbar.querySelector("[data-projection]")!.textContent = ortho ? "ortho" : "persp";
  }

  private makeToolbar(): HTMLDivElement {
    const bar = document.createElement("div");
    bar.className = "toolbar3d";
    const button = (text: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.title = title;
      b.addEventListener("click", onClick);
      bar.appendChild(b);
      return b;
    };
    button("persp", "Perspective or orthographic", () => this.setOrtho(!this.ortho)).dataset.projection = "";
    for (const snap of ["top", "front", "right", "iso"] as Snap[]) button(snap, `${snap} view`, () => this.setSnap(snap)).dataset.snap = snap;
    this.host.appendChild(bar);
    return bar;
  }

  private get palette(): Palette {
    return PALETTES[this.ui.theme];
  }

  private get widthScale(): number {
    return this.ui.presenting ? 1.5 : 1;
  }

  private resize(): void {
    this.engine.resize();
    const resolution = new BABYLON.Vector2(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    for (const b of this.built.values()) for (const l of b.lines) l.mesh.greasedLineMaterial!.resolution = resolution;
    for (const m of this.groundMeshes) {
      const line = m as BABYLON.GreasedLineBaseMesh;
      if (line.greasedLineMaterial) line.greasedLineMaterial.resolution = resolution;
    }
  }

  /** Babylon's own size never reads 0 (resize() falls back to a default), so ask the element. */
  private laidOut(): boolean {
    return this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0;
  }

  /** Store changes folded since the last frame. While hidden they keep accumulating. */
  private flush(): void {
    if (!this.active || !this.laidOut()) return;
    const { reset, ids } = this.changes.take();
    const objects = [...this.store.objects.values()];
    const box = viewBox(objects.map((o) => o.geom));
    const withCurves = hasCurves(objects);
    // Infinite curves, default surface windows and default opacity depend on the whole scene: rebuild when they move.
    if (reset || !sameBox(box, this.box) || withCurves !== this.withCurves) {
      this.rebuild();
    } else {
      const touched = new Set(ids);
      for (const o of objects) if (isPcurve(o.geom) && touched.has(o.geom.surface)) touched.add(o.id); // a pcurve follows its surface
      for (const id of touched) {
        const o = this.store.objects.get(id);
        if (o) this.show(o);
        else this.drop(id);
      }
    }
    if (this.fitPending || (this.ui.autoFit && !this.userMoved)) {
      this.fit();
      this.fitPending = false;
    } else {
      this.applyScale();
    }
    if (this.framePending) {
      this.framePending = false;
      this.frameSelected();
    }
  }

  private uiChanged(ev: UiEvent): void {
    if (ev === "theme") {
      this.applyTheme();
      this.rebuild(); // extras and the grid take their colours from the palette
    } else if (ev === "visibility") {
      for (const [id, b] of this.built) {
        const o = this.store.objects.get(id);
        const visible = o ? this.ui.isVisible(o) : false;
        b.meshes.forEach((m) => m.setEnabled(visible));
      }
    } else if (ev === "selection") {
      this.applyHighlight();
      // The radius depends on the pane's aspect ratio: a hidden or unsized canvas would get a wrong one, so wait for a flush.
      this.framePending = true;
      this.frame.request();
    } else if (ev === "presenting") {
      this.applyHighlight();
    } else if (ev === "autofit" && this.ui.autoFit) {
      this.fitRequested();
    }
  }

  private applyTheme(): void {
    this.scene.clearColor = BABYLON.Color4.FromHexString(`${this.palette.bg}ff`);
  }

  /** Frame the selected object; one without extent (a point, an infinite curve's origin) is only re-targeted. */
  private frameSelected(): void {
    const o = this.ui.selected ? this.store.objects.get(this.ui.selected) : undefined;
    const b = o ? sceneBounds([o.geom]) : null;
    if (!b) return;
    this.camera.target.copyFrom(v3(b.min).add(v3(b.max)).scale(0.5));
    if (v3(b.max).subtract(v3(b.min)).length() > 0) this.camera.radius = fitRadius(b, this.engine.getAspectRatio(this.camera));
    this.userMoved = true;
  }

  /** Clip planes and zoom feel follow the scene's size, also when the camera is not moved. */
  private applyScale(): void {
    const b = sceneBounds(this.geoms());
    if (b) Object.assign(this.camera, cameraScale(fitRadius(b, this.engine.getAspectRatio(this.camera))));
  }

  private fit(): void {
    const b = sceneBounds(this.geoms());
    if (!b) return;
    this.camera.target.copyFrom(v3(b.min).add(v3(b.max)).scale(0.5));
    this.camera.radius = fitRadius(b, this.engine.getAspectRatio(this.camera));
    this.applyScale();
  }

  private geoms() {
    return [...this.store.objects.values()].map((o) => o.geom);
  }

  /** Per frame: orthographic extents follow the zoom, markers keep their pixel size. */
  private beforeRender(): void {
    const aspect = this.engine.getAspectRatio(this.camera);
    if (this.ortho) Object.assign(this.camera, orthoExtents(this.camera.radius, this.camera.fov, aspect));
    const gauge = {
      ortho: this.ortho,
      fov: this.camera.fov,
      orthoHeight: (this.camera.orthoTop ?? 0) - (this.camera.orthoBottom ?? 0),
      heightPx: this.engine.getRenderHeight(),
    };
    const eye = this.camera.position;
    const forward = this.camera.getForwardRay(1).direction;
    const ws = this.widthScale;
    for (const b of this.built.values()) {
      const lit = this.isLit(b.draw.id);
      for (const { mesh, part, matrices } of b.markers) {
        const px = screenPx(part.px, ws, lit);
        part.at.forEach((p, i) => {
          const depth = (p[0] - eye.x) * forward.x + (p[1] - eye.y) * forward.y + (p[2] - eye.z) * forward.z;
          const s = 2 * px * pixelSize(gauge, depth); // the marker mesh is a unit-diameter sphere
          BABYLON.Matrix.ScalingToRef(s, s, s, scratch);
          scratch.setTranslationFromFloats(p[0], p[1], p[2]);
          scratch.copyToArray(matrices, 16 * i);
        });
        mesh.thinInstanceBufferUpdated("matrix");
      }
    }
  }

  private isLit(id: string): boolean {
    return id === this.ui.selected;
  }

  /** Line widths and surface glow for the selection and presentation mode. */
  private applyHighlight(): void {
    for (const b of this.built.values()) this.applyHighlightTo(b);
  }

  private applyHighlightTo(b: Built): void {
    const lit = this.isLit(b.draw.id);
    const ws = this.widthScale;
    for (const { mesh, part } of b.lines) mesh.greasedLineMaterial!.width = GREASED_PER_PX * screenPx(part.px, ws, lit && !part.extra);
    if (b.surface) b.surface.emissiveColor = lit ? b.surface.diffuseColor.scale(0.35) : BABYLON.Color3.Black();
  }

  private rebuild(): void {
    const objects = [...this.store.objects.values()];
    this.box = viewBox(objects.map((o) => o.geom));
    this.withCurves = hasCurves(objects);
    for (const id of [...this.built.keys()]) this.drop(id);
    for (const o of objects) this.show(o);
    this.buildGround();
  }

  private drop(id: string): void {
    this.built.get(id)?.meshes.forEach(disposeMesh);
    this.built.delete(id);
  }

  private show(o: SceneObject): void {
    this.drop(o.id);
    const draw = objectDraw3D(o, { box: this.box, lookup: (id) => this.store.objects.get(id)?.geom, withCurves: this.withCurves });
    const b: Built = { draw, meshes: [], lines: [], markers: [], surface: null };
    for (const part of draw.lines) {
      const color = part.extra ? mixHex(part.color, this.palette.bg, EXTRA_MIX) : part.color;
      const mesh = this.greasedLine(`l-${o.id}`, part.paths, color, part.px, part.alpha);
      b.lines.push({ mesh, part });
      b.meshes.push(mesh);
    }
    if (draw.surface) {
      const s = draw.surface;
      const mesh = new BABYLON.Mesh(`s-${o.id}`, this.scene);
      const data = new BABYLON.VertexData();
      data.positions = s.mesh.positions;
      data.indices = s.mesh.indices;
      if (s.mesh.uvs.length) data.uvs = s.mesh.uvs;
      data.normals = [];
      BABYLON.VertexData.ComputeNormals(s.mesh.positions, s.mesh.indices, data.normals);
      data.applyToMesh(mesh);
      const mat = new BABYLON.StandardMaterial(`m-${o.id}`, this.scene);
      mat.diffuseColor = color3(s.color);
      mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      mat.backFaceCulling = false;
      mat.twoSidedLighting = true;
      mat.alpha = s.alpha;
      mat.zOffset = 1; // curves lying on the surface stay in front of it
      mat.zOffsetUnits = 1;
      mesh.material = mat;
      mesh.metadata = { id: o.id };
      b.surface = mat;
      b.meshes.push(mesh);
    }
    for (const part of draw.markers) {
      const marker = this.markers(`p-${o.id}`, part);
      b.markers.push(marker);
      b.meshes.push(marker.mesh);
    }
    const visible = this.ui.isVisible(o);
    b.meshes.forEach((m) => {
      m.renderingGroupId = 1;
      m.setEnabled(visible);
    });
    this.built.set(o.id, b);
    this.applyHighlightTo(b);
  }

  /**
   * Constant-pixel-width lines: Babylon's `sizeAttenuation: true` is what keeps the width in
   * pixels. The default (standard) material type: the simple one disposes the shared empty
   * colours texture along with its material (Babylon 8.56), which blanks every later line.
   */
  private greasedLine(name: string, paths: Vec3[][], color: string, px: number, alpha: number): BABYLON.GreasedLineBaseMesh {
    const mesh = BABYLON.CreateGreasedLine(
      name,
      { points: paths.map((p) => p.flat()) },
      {
        color: color3(color),
        width: GREASED_PER_PX * px,
        sizeAttenuation: true,
        resolution: new BABYLON.Vector2(this.engine.getRenderWidth(), this.engine.getRenderHeight()),
      },
      this.scene,
    );
    mesh.material!.alpha = alpha;
    mesh.isPickable = false;
    return mesh;
  }

  /** One unit sphere drawn at every position (thin instances), resized each frame to keep its pixel radius. */
  private markers(name: string, part: Markers3D) {
    const mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter: 1, segments: 8 }, this.scene);
    const mat = new BABYLON.StandardMaterial(`${name}-m`, this.scene);
    const color = color3(part.extra ? mixHex(part.color, this.palette.bg, EXTRA_MIX) : part.color);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.6);
    mat.alpha = part.alpha;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true; // thin instances move every frame: skip culling against stale bounds
    const matrices = new Float32Array(16 * part.at.length);
    part.at.forEach((p, i) => BABYLON.Matrix.Translation(p[0], p[1], p[2]).copyToArray(matrices, 16 * i));
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
    return { mesh, part, matrices };
  }

  /** Spec §5.3: the grid on z = 0 and the axis triad. */
  private buildGround(): void {
    this.groundMeshes.forEach(disposeMesh);
    const g = ground(this.box);
    const palette = this.palette;
    const lineSystem = (name: string, lines: Vec3[][], color: string) => {
      const mesh = BABYLON.MeshBuilder.CreateLineSystem(name, { lines: lines.map((l) => l.map(v3)) }, this.scene);
      mesh.color = color3(color);
      mesh.material!.disableDepthWrite = true;
      mesh.isPickable = false;
      return mesh;
    };
    this.groundMeshes = [lineSystem("grid-minor", g.minor, palette.gridMinor), lineSystem("grid-major", g.major, palette.gridMajor)];
    for (const axis of g.axes) {
      const mesh = this.greasedLine(`axis-${axis.name}`, [[[0, 0, 0], axis.to]], axis.color, AXIS_PX, 1);
      mesh.renderingGroupId = 1; // over the grid lines it runs along
      this.groundMeshes.push(mesh);
    }
  }
}

const scratch = new BABYLON.Matrix();

/** Dispose a mesh and its own material (not textures: plain-coloured GreasedLines share one). */
function disposeMesh(m: BABYLON.AbstractMesh): void {
  const mat = m.material;
  m.dispose();
  mat?.dispose();
}
````

Patch `frontend/index.html` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/index.html b/frontend/index.html
index 3feefb3..b1288dd 100644
--- a/frontend/index.html
+++ b/frontend/index.html
@@ -23,7 +23,7 @@
     </header>
     <main>
       <section id="stage" data-view="2d">
-        <canvas id="canvas3d"></canvas>
+        <div id="view3d"></div>
         <div id="view2d"></div>
         <div id="toast" role="status" hidden></div>
       </section>
PATCH
````

Patch `frontend/src/main.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/main.ts b/frontend/src/main.ts
index 3f73a9f..404fde6 100644
--- a/frontend/src/main.ts
+++ b/frontend/src/main.ts
@@ -7,7 +7,7 @@ import { mountPanel } from "./ui/panel";
 import { type ActiveView, type AvailableViews, UiState, usableView } from "./ui/state";
 import { applyTheme } from "./ui/theme";
 import { View2D } from "./view2d/view";
-import { View3D } from "./view3d";
+import { View3D } from "./view3d/view";
 
 function byId<T extends HTMLElement = HTMLElement>(id: string): T {
   const el = document.getElementById(id);
@@ -41,7 +41,7 @@ function viewFailed(view: ActiveView, message: string): void {
 
 let view3d: View3D | null = null;
 try {
-  view3d = new View3D(store, ui, byId<HTMLCanvasElement>("canvas3d"));
+  view3d = new View3D(store, ui, byId("view3d"));
 } catch (err) {
   console.error("geomcore-viewer: 3D view failed", err);
   viewFailed("3d", `3D view unavailable: ${err instanceof Error ? err.message : String(err)}`);
PATCH
````

Patch `frontend/src/style.css` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/style.css b/frontend/src/style.css
index 1da851c..5ded056 100644
--- a/frontend/src/style.css
+++ b/frontend/src/style.css
@@ -54,9 +54,12 @@ header .meta:empty { display: none; }
 
 main { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 260px; }
 #stage { position: relative; min-width: 0; overflow: hidden; background: var(--bg); }
-#canvas3d, #view2d { position: absolute; inset: 0; width: 100%; height: 100%; }
-#canvas3d { outline: none; }
-#stage[data-view="2d"] #canvas3d, #stage[data-view="3d"] #view2d { display: none; }
+#view3d, #view2d { position: absolute; inset: 0; width: 100%; height: 100%; }
+#canvas3d { display: block; width: 100%; height: 100%; outline: none; }
+#stage[data-view="2d"] #view3d, #stage[data-view="3d"] #view2d { display: none; }
+.toolbar3d { position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.25rem; }
+.toolbar3d button { padding: 0.15rem 0.45rem; font-size: 0.75rem; opacity: 0.85; }
+body.presenting .toolbar3d { display: none; }
 #view2d canvas { display: block; }
 
 aside#panel { background: var(--surface); border-left: 1px solid var(--border); padding: 0.5rem 0.75rem; overflow: auto; }
PATCH
````

Delete `frontend/src/view3d.ts`:

````bash
git rm -q frontend/src/view3d.ts
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run && npm run build && npm run e2e)
````

Expected: vitest 252 passed in 24 files; build `✓ built`; e2e 8 passed (6 plane-view + 2 new).

- [ ] **Step 5: Commit**

````bash
git add -A frontend/e2e/view3d.e2e.ts frontend/index.html frontend/src/main.ts frontend/src/style.css frontend/src/view3d/view.ts
git commit -m "3d: Babylon view with constant-pixel GreasedLine curves, curvature-tessellated translucent surfaces, screen-size markers, ground grid, toolbar for projection and snap views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 8: 3D labels, picking and the tooltip

**Labels.** 3D labels reuse the plane view's DOM `LabelLayer` and greedy placement. Points are placed first, then curves, surfaces and extras. Positions are re-projected whenever the camera's view matrix changes. The axis letters are labels too.

**Picking.**
- `pickProjected` projects every pickable polyline and dot with a `Project` function, which returns null behind a perspective camera. Lines are split at such points.
- It reuses the plane view's `pickNearest`, which now reports which polyline it hit as `Hit.line`.
- It maps the hit back to the world point and the curve parameter.
- When no line or point is within 8 px, Babylon's `scene.pick` finds a surface. Its interpolated texture coordinates give (u, v) through `surfaceUv`.

**Tooltip and highlight.**
- `describeHit3D` writes the tooltip: "label · type", `t`, `u · v`, the point, and `params`.
- The hovered or selected object is lit: lines +1.5 px, and a surface gets an emissive tint. This closes the Phase 2 backlog item "3D selection highlight".

**Files:**
- Create: `frontend/src/view3d/pick.ts`, `frontend/test/pick3d.test.ts`
- Modify: `frontend/e2e/view3d.e2e.ts`, `frontend/src/view2d/pick.ts`, `frontend/src/view3d/view.ts`

**Interfaces:**
- Produces (`view3d/pick.ts`):
  - `type Project = (p: Vec3) => Vec2 | null`;
  - `interface Hit3D { id; dist; at: Vec3; t: number | null; index: number | null; uv: Vec2 | null }`;
  - `pickProjected(items, project, x, y, radius = 8): Hit3D | null`;
  - `surfaceUv(grid, st): Vec2`;
  - `uvAt(c: UvCurve, t): Vec2`, which moves to `geom/pcurve.ts` in Task 10;
  - `describeHit3D(o, hit, lookup): string[]`.
- Changes (`view2d/pick.ts`): `Hit.line?: number`.
- Produces (`View3D`): `screenOf(p: Vec3): Vec2 | null`, a debug/e2e accessor. `#view3d .tooltip` gets a `.head` line.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/pick3d.test.ts`:

````ts
import { describe, expect, it } from "vitest";
import type { Geom } from "../src/geom/types";
import type { Frame, Vec2, Vec3 } from "../src/geom/vec";
import type { SceneObject } from "../src/protocol";
import { Hit3D, Project, describeHit3D, pickProjected, surfaceUv, uvAt } from "../src/view3d/pick";
import type { Pickable3D } from "../src/view3d/render";

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
/** Looking down z, 10 px per unit, origin at (100, 100); points above z = 5 are "behind the camera". */
const project: Project = (p: Vec3): Vec2 | null => (p[2] > 5 ? null : [100 + 10 * p[0], 100 - 10 * p[1]]);
const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9));

describe("pickProjected", () => {
  it("maps a hit on a projected curve back to the world point and the curve parameter", () => {
    const line: Pickable3D = { id: "L", polylines: [{ pts: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], ts: [0, 10, 20] }], dots: [] };
    const hit = pickProjected([line], project, 115, 103)!;
    expect(hit.id).toBe("L");
    expect(hit.dist).toBeCloseTo(3, 9);
    close(hit.at, [1.5, 0, 0]);
    expect(hit.t).toBeCloseTo(15, 9);
  });

  it("splits a polyline where it passes behind the camera, and still maps hits on the far run", () => {
    const arc: Pickable3D = { id: "A", polylines: [{ pts: [[0, 0, 0], [1, 0, 9], [2, 0, 0], [3, 0, 0]], ts: [0, 1, 2, 3] }], dots: [] };
    expect(pickProjected([arc], project, 105, 100)).toBeNull(); // the segments through the hidden point are gone
    const hit = pickProjected([arc], project, 125, 101)!;
    close(hit.at, [2.5, 0, 0]);
    expect(hit.t).toBeCloseTo(2.5, 9);
  });

  it("gives a polyline's hit no parameter, and a dot its index and position", () => {
    const poly: Pickable3D = { id: "Q", polylines: [{ pts: [[0, 2, 0], [2, 2, 0]], ts: null }], dots: [] };
    const cloud: Pickable3D = { id: "S", polylines: [], dots: [[0, -2, 0], [3, -2, 1]] };
    expect(pickProjected([poly, cloud], project, 110, 81)).toMatchObject({ id: "Q", t: null, index: null });
    expect(pickProjected([poly, cloud], project, 129, 121)).toMatchObject({ id: "S", index: 1, at: [3, -2, 1], t: null });
  });

  it("finds nothing beyond the radius", () => {
    const line: Pickable3D = { id: "L", polylines: [{ pts: [[0, 0, 0], [1, 0, 0]], ts: [0, 1] }], dots: [] };
    expect(pickProjected([line], project, 105, 120)).toBeNull();
  });
});

describe("surface and (u, v) helpers", () => {
  it("maps normalized texture coordinates through the grid's window", () => {
    const grid = { u: [0, 2 * Math.PI] as [number, number], v: [-1, 4] as [number, number], nu: 8, nv: 1, assumed: false };
    close(surfaceUv(grid, [0.25, 0.5]), [Math.PI / 2, 1.5]);
  });

  it("evaluates a (u, v) line, circle or polyline at t", () => {
    close(uvAt({ type: "line", o: [0, 1.5, 0], d: [1, 0, 0] }, 2), [2, 1.5]);
    close(uvAt({ type: "circle", frame: world, r: 2 }, Math.PI / 2), [0, 2]);
    close(uvAt({ type: "polyline", points: [[0, 0, 0], [1, 0, 0], [1, 2, 0]] }, 1.25), [1, 0.5]);
  });
});

describe("describeHit3D", () => {
  const cylinder: Geom = { type: "cylinder", frame: world, r: 2, window: { v: [-1, 4] } };
  const lookup = (id: string) => (id === "Y" ? cylinder : undefined);
  const hit = (extra: Partial<Hit3D>): Hit3D => ({ id: "x", dist: 0, at: [0, 0, 0], t: null, index: null, uv: null, ...extra });

  it("shows a pcurve's t, its (u, v) and the point S(u, v)", () => {
    const ring: SceneObject = { id: "ring", geom: { type: "pcurve", surface: "Y", curve: { type: "line", o: [0, 1.5, 0], d: [1, 0, 0] } } };
    expect(describeHit3D(ring, hit({ t: Math.PI / 2 }), lookup)).toEqual(["ring · pcurve", "t = 1.5708", "u = 1.5708 · v = 1.5", "(0, 2, 1.5)"]);
  });

  it("shows a surface's (u, v) and the exact point there", () => {
    const y: SceneObject = { id: "Y", label: "Y", geom: cylinder, meta: { params: [1, 2] } };
    expect(describeHit3D(y, hit({ uv: [0, 0.5] }), lookup)).toEqual(["Y · cylinder", "u = 0 · v = 0.5", "(2, 0, 0.5)", "params (1, 2)"]);
  });

  it("shows a curve's t and a point's coordinates", () => {
    const c: SceneObject = { id: "C", geom: { type: "circle", frame: world, r: 1 } };
    expect(describeHit3D(c, hit({ t: Math.PI }), lookup)).toEqual(["C · circle", "t = 3.1416", "(-1, 0)"]);
    const p: SceneObject = { id: "P", geom: { type: "point", p: [1, 2, 3] } };
    expect(describeHit3D(p, hit({ index: 0 }), lookup)).toEqual(["P · point", "(1, 2, 3)"]);
  });
});
````

Patch `frontend/e2e/view3d.e2e.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/e2e/view3d.e2e.ts b/frontend/e2e/view3d.e2e.ts
index 5ec8141..08ebf08 100644
--- a/frontend/e2e/view3d.e2e.ts
+++ b/frontend/e2e/view3d.e2e.ts
@@ -54,3 +54,23 @@ test("the 3D toolbar snaps the camera and switches to orthographic", async ({ pa
   expect((await camera3d(page)).ortho).toBe(true);
   await expect.poll(() => pixelsLike(page, "#c47f00")).toBeGreaterThan(100);
 });
+
+test("hovering a 3D curve highlights it and shows its parameter and point", async ({ page, request }) => {
+  await postScene(request, "quadrics_3d");
+  await page.goto("/");
+  await expect(page.locator("#count")).toHaveText("7 objects");
+  await expect.poll(() => pixelsLike(page, "#c47f00")).toBeGreaterThan(100); // drawn, so the camera has its first frame
+  const [x, y] = await page.evaluate(() => {
+    const gv = (window as unknown as { __gv: { view3d: { screenOf(p: number[]): number[]; canvas: HTMLCanvasElement } } }).__gv;
+    const s = gv.view3d.screenOf([0, -2, Math.sqrt(5)]); // SY₁: the circle of radius 2 at z = √5
+    const r = gv.view3d.canvas.getBoundingClientRect();
+    return [r.left + s[0], r.top + s[1]];
+  });
+  await page.mouse.move(x, y);
+  const tooltip = page.locator("#view3d .tooltip");
+  await expect(tooltip).toBeVisible();
+  await expect(tooltip.locator(".head")).toHaveText("SY₁ · circle");
+  await expect(tooltip).toContainText("t = ");
+  await expect(tooltip).toContainText(", 2.236)"); // on SY₁, whatever t the pointer lands on
+  await expect(page.locator("#view3d .labels .label.lit")).toHaveText("SY₁");
+});
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/pick3d.test.ts)
````

Expected: `pick3d.test.ts` cannot load `../src/view3d/pick` (`Test Files 1 failed (1)`).

- [ ] **Step 3: Implement**

Create `frontend/src/view3d/pick.ts`:

````ts
import { evalCurve } from "../geom/curves";
import { pcurveSurface } from "../geom/pcurve";
import { evalSurface } from "../geom/surfaces";
import type { SurfaceGrid } from "../geom/tessellate";
import { Geom, UvCurve, isCurve, isPcurve, isSurface } from "../geom/types";
import type { Vec2, Vec3 } from "../geom/vec";
import type { SceneObject } from "../protocol";
import { fmtNum, fmtParams, fmtPoint } from "../ui/format";
import { Pickable, pickNearest } from "../view2d/pick";
import type { Pickable3D } from "./render";

/** World → screen pixels, or null for a point behind the camera. */
export type Project = (p: Vec3) => Vec2 | null;

export interface Hit3D {
  id: string;
  /** Pixels from the pointer (0 on a surface). */
  dist: number;
  /** The hit point in world space. */
  at: Vec3;
  /** The curve or pcurve parameter at `at`. */
  t: number | null;
  /** Which dot of a `points` object. */
  index: number | null;
  /** On a surface: its (u, v) at `at`. */
  uv: Vec2 | null;
}

const lerp = (a: number, b: number, s: number): number => a + (b - a) * s;
const lerp3 = (a: Vec3, b: Vec3, s: number): Vec3 => [lerp(a[0], b[0], s), lerp(a[1], b[1], s), lerp(a[2], b[2], s)];

/**
 * The curve, polyline or point nearest to screen (x, y) within `radius` pixels: every
 * pickable is projected (split where it passes behind the camera) and handed to the plane
 * view's picker, then the hit is mapped back to world space and to the curve's parameter.
 */
export function pickProjected(items: Pickable3D[], project: Project, x: number, y: number, radius = 8): Hit3D | null {
  /** Per item, the world runs behind its screen polylines (hits carry a run-local index as their `t`). */
  const runs = new Map<string, { pts: Vec3[]; ts: number[] | null }[]>();
  const screen: Pickable[] = items.map((item) => {
    const p: Pickable = { id: item.id, polylines: [], dots: [] };
    const worldRuns: { pts: Vec3[]; ts: number[] | null }[] = [];
    for (const line of item.polylines) {
      let run: { s: Vec2[]; pts: Vec3[]; ts: number[] } | null = null;
      line.pts.forEach((w, i) => {
        const s = project(w);
        if (!s) {
          run = null;
          return;
        }
        if (!run) {
          run = { s: [], pts: [], ts: [] };
          p.polylines.push({ pts: run.s, ts: null });
          worldRuns.push({ pts: run.pts, ts: line.ts ? run.ts : null });
        }
        run.s.push(s);
        run.pts.push(w);
        if (line.ts) run.ts.push(line.ts[i]);
      });
    }
    for (const line of p.polylines) line.ts = line.pts.map((_, i) => i);
    item.dots.forEach((d, index) => {
      const s = project(d);
      if (s) p.dots.push({ at: s, index });
    });
    runs.set(item.id, worldRuns);
    return p;
  });
  const hit = pickNearest(screen, x, y, radius);
  if (!hit) return null;
  if (hit.index !== null) {
    const item = items.find((i) => i.id === hit.id)!;
    return { id: hit.id, dist: hit.dist, at: item.dots[hit.index], t: null, index: hit.index, uv: null };
  }
  const run = runs.get(hit.id)![hit.line!];
  const i = Math.min(Math.floor(hit.t!), run.pts.length - 2);
  const s = hit.t! - i;
  const at = lerp3(run.pts[i], run.pts[i + 1], s);
  const t = run.ts ? lerp(run.ts[i], run.ts[i + 1], s) : null;
  return { id: hit.id, dist: hit.dist, at, t, index: null, uv: null };
}

/** A surface's (u, v) from the mesh's interpolated texture coordinates (normalized across the grid's window). */
export function surfaceUv(grid: SurfaceGrid, st: Vec2): Vec2 {
  return [lerp(grid.u[0], grid.u[1], st[0]), lerp(grid.v[0], grid.v[1], st[1])];
}

/** A (u, v) curve's point at t: the line or circle evaluated, the polyline at i + s along segment i. */
export function uvAt(c: UvCurve, t: number): Vec2 {
  if (c.type !== "polyline") {
    const q = evalCurve(c, t);
    return [q[0], q[1]];
  }
  const i = Math.max(0, Math.min(Math.floor(t), c.points.length - 2));
  const q = lerp3(c.points[i], c.points[i + 1], t - i);
  return [q[0], q[1]];
}

const uvText = (uv: Vec2): string => `u = ${fmtNum(uv[0], 4)} · v = ${fmtNum(uv[1], 4)}`;

/** Tooltip lines for a 3D hover hit: "label · type", t and/or (u, v), the point, `meta.params`. */
export function describeHit3D(o: SceneObject, hit: Hit3D, lookup: (id: string) => Geom | undefined): string[] {
  const g = o.geom;
  const lines = [`${o.label ?? o.id} · ${g.type}`];
  let at = hit.at;
  if (g.type === "point") {
    at = g.p;
  } else if (isCurve(g) && hit.t !== null) {
    lines.push(`t = ${fmtNum(hit.t, 4)}`);
    at = evalCurve(g, hit.t);
  } else if (isPcurve(g) && hit.t !== null) {
    const uv = uvAt(g.curve, hit.t);
    lines.push(`t = ${fmtNum(hit.t, 4)}`, uvText(uv));
    const s = pcurveSurface(g, lookup);
    if (s) at = evalSurface(s, uv[0], uv[1]);
  } else if (isSurface(g) && hit.uv) {
    lines.push(uvText(hit.uv));
    at = evalSurface(g, hit.uv[0], hit.uv[1]);
  }
  lines.push(fmtPoint(at));
  const params = fmtParams(o.meta?.params);
  if (params !== null) lines.push(`params ${params}`);
  return lines;
}
````

Patch `frontend/src/view2d/pick.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/view2d/pick.ts b/frontend/src/view2d/pick.ts
index 0a023ed..ae90515 100644
--- a/frontend/src/view2d/pick.ts
+++ b/frontend/src/view2d/pick.ts
@@ -18,6 +18,8 @@ export interface Hit {
   t: number | null;
   /** Which dot of a `points` object was hit. */
   index: number | null;
+  /** Which of the item's polylines was hit (the 3D view maps the hit back through it). */
+  line?: number;
 }
 
 /** Points win a near-tie with a curve passing under them. */
@@ -36,7 +38,7 @@ export function pickNearest(items: Pickable[], x: number, y: number, radius = 8)
         best = { id: item.id, dist: d, at: dot.at, t: null, index: dot.index };
       }
     }
-    for (const line of item.polylines) {
+    item.polylines.forEach((line, li) => {
       const pts = line.pts;
       for (let i = 0; i + 1 < pts.length; i++) {
         const d = segmentDistance(p, pts[i], pts[i + 1]);
@@ -55,9 +57,10 @@ export function pickNearest(items: Pickable[], x: number, y: number, radius = 8)
           at: [a[0] + s * dx, a[1] + s * dy],
           t: ts ? ts[i] + s * (ts[i + 1] - ts[i]) : null,
           index: null,
+          line: li,
         };
       }
-    }
+    });
   }
   return best;
 }
PATCH
````

Patch `frontend/src/view3d/view.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/view3d/view.ts b/frontend/src/view3d/view.ts
index ef741a1..544ed09 100644
--- a/frontend/src/view3d/view.ts
+++ b/frontend/src/view3d/view.ts
@@ -2,21 +2,27 @@ import * as BABYLON from "@babylonjs/core";
 import { Changes, FrameScheduler } from "../frame";
 import { sameBox, sceneBounds, viewBox } from "../geom/bounds";
 import { isPcurve } from "../geom/types";
-import type { Box, Vec3 } from "../geom/vec";
+import type { Box, Vec2, Vec3 } from "../geom/vec";
 import type { SceneObject } from "../protocol";
 import type { Store } from "../store";
+import { LabelItem, LabelLayer, TextMeasure } from "../ui/labels";
 import type { UiEvent, UiState } from "../ui/state";
 import { PALETTES, Palette, mixHex } from "../ui/theme";
-import { EXTRA_MIX } from "../view2d/render";
+import { placeLabels } from "../view2d/placement";
+import { EXTRA_MIX, TextKind } from "../view2d/render";
 import { SNAPS, Snap, cameraScale, fitRadius, orthoExtents, pixelSize } from "./camera";
-import { Lines3D, Markers3D, ObjectDraw3D, hasCurves, objectDraw3D, screenPx } from "./render";
-import { ground } from "./scene";
+import { Hit3D, Project, describeHit3D, pickProjected, surfaceUv } from "./pick";
+import { Lines3D, Markers3D, ObjectDraw3D, Text3D, hasCurves, objectDraw3D, screenPx } from "./render";
+import { Ground, ground } from "./scene";
 
 const v3 = (p: Vec3) => new BABYLON.Vector3(p[0], p[1], p[2]);
 const color3 = (hex: string) => BABYLON.Color3.FromHexString(hex);
 /** GreasedLine's width is twice what it covers on screen (measured: width 6 draws 3 px). */
 const GREASED_PER_PX = 2;
 const AXIS_PX = 2;
+const LABEL_PX = 13;
+/** Labels of the hovered or selected object first, then text, points, curves and surfaces, extras last. */
+const KIND_ORDER: Record<TextKind, number> = { text: 0, point: 1, curve: 2, extra: 3 };
 
 /** One object's Babylon meshes, kept with what they were built from (highlight and marker sizes change per frame). */
 interface Built {
@@ -50,6 +56,13 @@ export class View3D {
   private changes = new Changes();
   private frame = new FrameScheduler(() => this.flush());
   private toolbar: HTMLDivElement;
+  private axes: Ground["axes"] = [];
+  private labels: LabelLayer;
+  private tooltip: HTMLDivElement;
+  private measure = new TextMeasure();
+  /** Labels follow the camera: re-placed after a frame in which it (or the scene) moved. */
+  private labelsDirty = true;
+  private hover: Hit3D | null = null;
 
   constructor(
     private store: Store,
@@ -79,7 +92,15 @@ export class View3D {
     // (group 1) over it, so curves lying on z = 0 are not speckled by the lines they cross.
     this.scene.setRenderingAutoClearDepthStencil(1, false, false, false);
     this.scene.onBeforeRenderObservable.add(() => this.beforeRender());
+    this.scene.onAfterRenderObservable.add(() => this.afterRender());
+    this.camera.onViewMatrixChangedObservable.add(() => (this.labelsDirty = true));
     this.toolbar = this.makeToolbar();
+    this.labels = new LabelLayer(host);
+    this.tooltip = document.createElement("div");
+    this.tooltip.className = "tooltip";
+    this.tooltip.hidden = true;
+    host.appendChild(this.tooltip);
+    this.listenHover();
     store.onChange((ev) => {
       if (ev.type === "meta") return;
       this.changes.note(ev);
@@ -101,6 +122,11 @@ export class View3D {
     return { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, target: [t.x, t.y, t.z], ortho: this.ortho };
   }
 
+  /** Debug and e2e access: where a world point is drawn on the canvas (null behind the camera). */
+  screenOf(p: Vec3): Vec2 | null {
+    return this.projector()(p);
+  }
+
   /** Render (and apply pending changes) only while the 3D view is the one shown. */
   setActive(active: boolean): void {
     if (active === this.active) return;
@@ -159,6 +185,7 @@ export class View3D {
 
   private resize(): void {
     this.engine.resize();
+    this.labelsDirty = true;
     const resolution = new BABYLON.Vector2(this.engine.getRenderWidth(), this.engine.getRenderHeight());
     for (const b of this.built.values()) for (const l of b.lines) l.mesh.greasedLineMaterial!.resolution = resolution;
     for (const m of this.groundMeshes) {
@@ -201,6 +228,7 @@ export class View3D {
       this.framePending = false;
       this.frameSelected();
     }
+    if (this.hover && !this.built.has(this.hover.id)) this.setHover(null, null);
   }
 
   private uiChanged(ev: UiEvent): void {
@@ -213,6 +241,7 @@ export class View3D {
         const visible = o ? this.ui.isVisible(o) : false;
         b.meshes.forEach((m) => m.setEnabled(visible));
       }
+      this.labelsDirty = true;
     } else if (ev === "selection") {
       this.applyHighlight();
       // The radius depends on the pane's aspect ratio: a hidden or unsized canvas would get a wrong one, so wait for a flush.
@@ -220,6 +249,7 @@ export class View3D {
       this.frame.request();
     } else if (ev === "presenting") {
       this.applyHighlight();
+      this.labelsDirty = true;
     } else if (ev === "autofit" && this.ui.autoFit) {
       this.fitRequested();
     }
@@ -287,7 +317,7 @@ export class View3D {
   }
 
   private isLit(id: string): boolean {
-    return id === this.ui.selected;
+    return id === this.ui.selected || id === this.hover?.id;
   }
 
   /** Line widths and surface glow for the selection and presentation mode. */
@@ -311,9 +341,129 @@ export class View3D {
     this.buildGround();
   }
 
+  /** World → canvas pixels with the camera of the last frame; null behind a perspective camera. */
+  private projector(): Project {
+    const vp = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
+    const transform = this.scene.getTransformMatrix();
+    const eye = this.camera.position;
+    const fwd = this.camera.getForwardRay(1).direction;
+    const near = this.camera.minZ;
+    const out = new BABYLON.Vector3();
+    return (p) => {
+      if (!this.ortho && (p[0] - eye.x) * fwd.x + (p[1] - eye.y) * fwd.y + (p[2] - eye.z) * fwd.z <= near) return null;
+      BABYLON.Vector3.ProjectToRef(v3(p), BABYLON.Matrix.IdentityReadOnly, transform, vp, out);
+      return [out.x, out.y];
+    };
+  }
+
+  private afterRender(): void {
+    if (!this.labelsDirty) return;
+    this.labelsDirty = false;
+    this.renderLabels();
+  }
+
+  /** A label's size on screen: its measured width plus a margin, by the line height of `.labels` (1.35). */
+  private textSize(text: string, px: number, weight = 400): { w: number; h: number } {
+    return { w: Math.ceil(this.measure.width(text, px, weight)) + 2, h: Math.ceil(px * 1.35) };
+  }
+
+  /** Spec §5.3: labels as a projected DOM overlay, placed like the plane view's; the axis letters at the triad's tips. */
+  private renderLabels(): void {
+    const project = this.projector();
+    const px = LABEL_PX * this.widthScale;
+    const texts: (Text3D & { s: [number, number] })[] = [];
+    for (const [id, b] of this.built) {
+      const o = this.store.objects.get(id);
+      if (!o || !this.ui.isVisible(o)) continue;
+      for (const t of b.draw.texts) {
+        const s = project(t.at);
+        if (s) texts.push({ ...t, s });
+      }
+    }
+    const rank = (t: Text3D) => (this.isLit(t.id) ? -1 : KIND_ORDER[t.kind]);
+    texts.sort((a, b) => rank(a) - rank(b));
+    const sizes = texts.map((t) => this.textSize(t.text, px, 600));
+    const requests = texts.map((t, i) => ({ key: t.key, ax: t.s[0], ay: t.s[1], ...sizes[i], fixed: t.kind === "text" }));
+    const byKey = new Map(texts.map((t, i) => [t.key, { t, size: sizes[i] }]));
+    const w = this.canvas.clientWidth;
+    const h = this.canvas.clientHeight;
+    const palette = this.palette;
+    const items: LabelItem[] = placeLabels(requests, w, h).map((p) => {
+      const { t } = byKey.get(p.key)!;
+      const className = t.kind === "extra" ? "label extra" : this.isLit(t.id) ? "label lit" : "label";
+      return { key: p.key, text: t.text, left: p.left, top: p.top, className, fontPx: px, color: t.color ?? palette.text };
+    });
+    for (const axis of this.axes) {
+      const s = project(axis.to);
+      if (s) items.push({ key: `axis:${axis.name}`, text: axis.name, left: s[0] + 3, top: s[1] - px * 1.4, className: "tick", fontPx: px, color: axis.color });
+    }
+    this.labels.render(items);
+  }
+
+  /** What is under the pointer: the nearest curve or point within 8 px, else the surface hit by the ray. */
+  private pick(x: number, y: number): Hit3D | null {
+    const items = [];
+    for (const [id, b] of this.built) {
+      const o = this.store.objects.get(id);
+      if (o && this.ui.isVisible(o)) items.push(b.draw.pick);
+    }
+    const near = pickProjected(items, this.projector(), x, y);
+    if (near) return near;
+    const info = this.scene.pick(x, y, (m) => m.isEnabled() && m.metadata?.id !== undefined);
+    if (!info?.hit || !info.pickedMesh || !info.pickedPoint) return null;
+    const id: string = info.pickedMesh.metadata.id;
+    const grid = this.built.get(id)?.draw.surface?.grid;
+    const st = info.getTextureCoordinates();
+    const p = info.pickedPoint;
+    return { id, dist: 0, at: [p.x, p.y, p.z], t: null, index: null, uv: grid && st ? surfaceUv(grid, [st.x, st.y]) : null };
+  }
+
+  /** Highlight the hovered object and show its tooltip (null hides both). */
+  private setHover(hit: Hit3D | null, pointer: [number, number] | null): void {
+    const changed = hit?.id !== this.hover?.id;
+    this.hover = hit;
+    if (changed) {
+      this.applyHighlight();
+      this.labelsDirty = true;
+    }
+    const o = hit ? this.store.objects.get(hit.id) : undefined;
+    if (!hit || !o || !pointer) {
+      this.tooltip.hidden = true;
+      return;
+    }
+    this.tooltip.replaceChildren(
+      ...describeHit3D(o, hit, (id) => this.store.objects.get(id)?.geom).map((line, i) => {
+        const div = document.createElement("div");
+        if (i === 0) div.className = "head";
+        div.textContent = line;
+        return div;
+      }),
+    );
+    this.tooltip.hidden = false;
+    const [x, y] = pointer;
+    const width = this.canvas.clientWidth;
+    const left = x + 14 + this.tooltip.offsetWidth > width ? x - 14 - this.tooltip.offsetWidth : x + 14;
+    this.tooltip.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, y + 14)}px)`;
+  }
+
+  private listenHover(): void {
+    this.canvas.addEventListener("pointermove", (ev) => {
+      if (ev.buttons) {
+        this.setHover(null, null); // orbiting or panning
+        return;
+      }
+      const r = this.canvas.getBoundingClientRect();
+      const x = ev.clientX - r.left;
+      const y = ev.clientY - r.top;
+      this.setHover(this.pick(x, y), [x, y]);
+    });
+    this.canvas.addEventListener("pointerleave", () => this.setHover(null, null));
+  }
+
   private drop(id: string): void {
     this.built.get(id)?.meshes.forEach(disposeMesh);
     this.built.delete(id);
+    this.labelsDirty = true;
   }
 
   private show(o: SceneObject): void {
@@ -406,6 +556,8 @@ export class View3D {
   private buildGround(): void {
     this.groundMeshes.forEach(disposeMesh);
     const g = ground(this.box);
+    this.axes = g.axes;
+    this.labelsDirty = true;
     const palette = this.palette;
     const lineSystem = (name: string, lines: Vec3[][], color: string) => {
       const mesh = BABYLON.MeshBuilder.CreateLineSystem(name, { lines: lines.map((l) => l.map(v3)) }, this.scene);
PATCH
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/pick3d.test.ts)
(cd frontend && npx vitest run && npm run build && npm run e2e)
````

Expected: 9 passed (9); vitest 261 passed in 25 files; e2e 9 passed.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/e2e/view3d.e2e.ts frontend/src/view2d/pick.ts frontend/src/view3d/pick.ts frontend/src/view3d/view.ts frontend/test/pick3d.test.ts
git commit -m "3d: DOM labels placed like the plane view's; hover picks curves, points and surfaces and shows t, (u, v) and the point; hovered and selected objects are highlighted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 9: `U` key, AZERTY digits and the hover link

**Keys.**
- `U` toggles `UiState.uvPane`, which is on by default, and emits `"uvpane"`.
- `2` and `3` also match by physical position (`KeyboardEvent.code` `Digit2`/`Digit3`). On AZERTY they type `é`/`"` unshifted, which closes a Phase 2 backlog item.
- The hint line mentions `U`.

**Hover link.** `HoverLink` is the channel between the 3D view and the pane: a surface id, a (u, v), and which side it came from. A clear is passed on only once.

**Files:**
- Create: `frontend/src/viewuv/link.ts`, `frontend/test/link.test.ts`
- Modify: `frontend/index.html`, `frontend/src/main.ts`, `frontend/src/ui/keys.ts`, `frontend/src/ui/state.ts`, `frontend/test/keys.test.ts`, `frontend/test/state.test.ts`

**Interfaces:**
- Changes:
  - `KeyAction` gains `"uvpane"`;
  - `KeySource` gains `code?: string`;
  - `UiEvent` gains `"uvpane"`;
  - `UiState` gains `uvPane: boolean` and `toggleUvPane()`.
- Produces (`viewuv/link.ts`):
  - `interface UvHover { surface: string; uv: Vec2; from: "3d" | "uv" }`;
  - `class HoverLink { current: UvHover | null; onChange(handler); set(h: UvHover | null) }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/link.test.ts`:

````ts
import { describe, expect, it, vi } from "vitest";
import { HoverLink } from "../src/viewuv/link";

describe("HoverLink", () => {
  it("passes each hover to the listeners, and a clear only once", () => {
    const link = new HoverLink();
    const seen = vi.fn();
    link.onChange(seen);
    link.set({ surface: "Y", uv: [1, 2], from: "3d" });
    link.set(null);
    link.set(null);
    expect(seen.mock.calls.map((c) => c[0])).toEqual([{ surface: "Y", uv: [1, 2], from: "3d" }, null]);
    expect(link.current).toBeNull();
  });
});
````

Patch `frontend/test/keys.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/keys.test.ts b/frontend/test/keys.test.ts
index 6263668..3ac47c8 100644
--- a/frontend/test/keys.test.ts
+++ b/frontend/test/keys.test.ts
@@ -16,8 +16,19 @@ describe("keyAction", () => {
     expect(press("Escape")).toBe("escape");
   });
 
-  it("leaves other keys alone, including U until the (u,v) pane exists", () => {
-    expect(press("u")).toBeNull();
+  it("toggles the (u,v) pane with U", () => {
+    expect(press("u")).toBe("uvpane");
+    expect(press("U")).toBe("uvpane");
+  });
+
+  it("finds 2 and 3 by position on layouts where they need Shift (AZERTY)", () => {
+    expect(press("é", { code: "Digit2" })).toBe("view2d");
+    expect(press('"', { code: "Digit3" })).toBe("view3d");
+    expect(press("t", { code: "Digit2" })).toBe("theme"); // a layout's own letter keeps its meaning
+    expect(press("à", { code: "Digit0" })).toBeNull();
+  });
+
+  it("leaves other keys alone", () => {
     expect(press("a")).toBeNull();
     expect(press(" ")).toBeNull();
   });
PATCH
````

Patch `frontend/test/state.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/state.test.ts b/frontend/test/state.test.ts
index f97328a..53ed968 100644
--- a/frontend/test/state.test.ts
+++ b/frontend/test/state.test.ts
@@ -82,7 +82,9 @@ describe("UiState visibility and selection", () => {
     ui.setPresenting(true); // no change, no event
     ui.setAutoFit(false);
     ui.setCollapsed("g", true);
-    expect(seen.mock.calls.map((c) => c[0])).toEqual(["selection", "presenting", "autofit", "collapse"]);
+    ui.toggleUvPane();
+    expect(seen.mock.calls.map((c) => c[0])).toEqual(["selection", "presenting", "autofit", "collapse", "uvpane"]);
+    expect(ui.uvPane).toBe(false);
     expect(ui.selected).toBe("a");
     expect(ui.collapsedGroups.has("g")).toBe(true);
   });
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/keys.test.ts test/link.test.ts test/state.test.ts)
````

Expected: `Test Files 3 failed (3)`, `Tests 3 failed | 11 passed (14)`: no `uvpane` action, no `toggleUvPane`, and `../src/viewuv/link` is missing.

- [ ] **Step 3: Implement**

Create `frontend/src/viewuv/link.ts`:

````ts
import type { Vec2 } from "../geom/vec";

/** Where the pointer is in a surface's parameters, and which pane put it there. */
export interface UvHover {
  surface: string;
  uv: Vec2;
  from: "3d" | "uv";
}

/**
 * Spec §5.4: hover in either pane shows the corresponding point in the other. The 3D view
 * publishes (u, v) when the pointer is on a surface or a pcurve, the (u,v) pane when it is
 * inside the window; each draws a marker for what the other published.
 */
export class HoverLink {
  current: UvHover | null = null;
  private handlers = new Set<(h: UvHover | null) => void>();

  onChange(handler: (h: UvHover | null) => void): void {
    this.handlers.add(handler);
  }

  set(h: UvHover | null): void {
    if (h === null && this.current === null) return;
    this.current = h;
    for (const handler of this.handlers) handler(h);
  }
}
````

Patch `frontend/index.html` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/index.html b/frontend/index.html
index b1288dd..15f5c3d 100644
--- a/frontend/index.html
+++ b/frontend/index.html
@@ -30,7 +30,7 @@
       <aside id="panel">
         <ul id="object-list"></ul>
         <p class="hint">
-          <kbd>F</kbd> fit · <kbd>P</kbd> present · <kbd>T</kbd> theme · <kbd>2</kbd> <kbd>3</kbd> view ·
+          <kbd>F</kbd> fit · <kbd>P</kbd> present · <kbd>T</kbd> theme · <kbd>2</kbd> <kbd>3</kbd> view · <kbd>U</kbd> (u,v) pane ·
           <kbd>Esc</kbd> leave / deselect · hover for details, click a point to copy it
         </p>
         <p class="hint">Live via SSE when served locally · <code>?scene=&lt;url&gt;</code> · or drop a <code>.json</code> scene file anywhere.</p>
PATCH
````

Patch `frontend/src/main.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/main.ts b/frontend/src/main.ts
index 404fde6..15e00a9 100644
--- a/frontend/src/main.ts
+++ b/frontend/src/main.ts
@@ -101,6 +101,7 @@ mountKeys({
   theme: () => ui.toggleTheme(),
   view2d: () => chooseView("2d"),
   view3d: () => chooseView("3d"),
+  uvpane: () => ui.toggleUvPane(),
   escape: () => (ui.presenting ? ui.setPresenting(false) : ui.select(null)),
 });
 
PATCH
````

Patch `frontend/src/ui/keys.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/ui/keys.ts b/frontend/src/ui/keys.ts
index 5a88e2a..fde0c17 100644
--- a/frontend/src/ui/keys.ts
+++ b/frontend/src/ui/keys.ts
@@ -1,20 +1,29 @@
-export type KeyAction = "fit" | "present" | "theme" | "view2d" | "view3d" | "escape";
+export type KeyAction = "fit" | "present" | "theme" | "view2d" | "view3d" | "uvpane" | "escape";
 
-/** Spec §5.1 keys. `U` ((u,v) pane) is Phase 3. */
+/** Spec §5.1 keys. */
 const KEYS: ReadonlyMap<string, KeyAction> = new Map([
   ["f", "fit"],
   ["p", "present"],
   ["t", "theme"],
   ["2", "view2d"],
   ["3", "view3d"],
+  ["u", "uvpane"],
   ["escape", "escape"],
 ]);
 
+/** The digit keys by position, for layouts where they type something else unshifted (AZERTY: é and "). */
+const CODES: ReadonlyMap<string, KeyAction> = new Map([
+  ["Digit2", "view2d"],
+  ["Digit3", "view3d"],
+]);
+
 /** Input types that take typed text; checkboxes, buttons and the like do not. */
 const NON_TEXT_INPUTS: ReadonlySet<string> = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]);
 
 interface KeySource {
   key: string;
+  /** The physical key (KeyboardEvent.code). */
+  code?: string;
   ctrlKey: boolean;
   metaKey: boolean;
   altKey: boolean;
@@ -36,7 +45,7 @@ function isTyping(target: EventTarget | null): boolean {
  */
 export function keyAction(ev: KeySource): KeyAction | null {
   if (ev.ctrlKey || ev.metaKey || ev.altKey || isTyping(ev.target)) return null;
-  return KEYS.get(ev.key.toLowerCase()) ?? null;
+  return KEYS.get(ev.key.toLowerCase()) ?? (ev.code ? CODES.get(ev.code) : undefined) ?? null;
 }
 
 /** Route key presses on `target` to the handlers; held-down keys do not repeat the action. */
PATCH
````

Patch `frontend/src/ui/state.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/ui/state.ts b/frontend/src/ui/state.ts
index 5b6b2ee..b3da446 100644
--- a/frontend/src/ui/state.ts
+++ b/frontend/src/ui/state.ts
@@ -11,7 +11,7 @@ export function usableView(view: ActiveView, available: AvailableViews): ActiveV
   return !available[view] && available[other] ? other : view;
 }
 
-export type UiEvent = "theme" | "presenting" | "view" | "visibility" | "selection" | "autofit" | "collapse";
+export type UiEvent = "theme" | "presenting" | "view" | "visibility" | "selection" | "autofit" | "collapse" | "uvpane";
 
 /** The part of `Storage` the UI needs (tests pass a Map-backed fake). */
 export interface KeyValueStore {
@@ -50,6 +50,8 @@ export class UiState {
   theme: Theme;
   presenting = false;
   autoFit = true;
+  /** Spec §5.4: the (u,v) pane shows when the scene has something for it; U hides it (and brings it back). */
+  uvPane = true;
   viewOverride: ActiveView | null = null;
   selected: string | null = null;
   readonly hiddenIds = new Set<string>();
@@ -102,6 +104,11 @@ export class UiState {
     this.emit("autofit");
   }
 
+  toggleUvPane(): void {
+    this.uvPane = !this.uvPane;
+    this.emit("uvpane");
+  }
+
   setView(view: ActiveView): void {
     this.viewOverride = view;
     this.emit("view");
PATCH
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/keys.test.ts test/link.test.ts test/state.test.ts)
(cd frontend && npx vitest run && npx tsc --noEmit)
````

Expected: 15 passed (15); vitest 264 passed in 26 files; `tsc` prints nothing.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/index.html frontend/src/main.ts frontend/src/ui/keys.ts frontend/src/ui/state.ts frontend/src/viewuv/link.ts frontend/test/keys.test.ts frontend/test/link.test.ts frontend/test/state.test.ts
git commit -m "keys: U toggles the (u,v) pane; 2 and 3 also match by position (AZERTY); a hover link between the 3D view and the pane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 10: The (u,v) pane's model

This task computes what the pane draws, with no DOM:
- **`uvSubject`** picks the surface (see Rulings).
- **`uvModel`** builds the model:
  - the surface window, exactly as the 3D view tessellates it;
  - the seams inside the window;
  - every visible pcurve on the surface, sampled over the same intervals the 3D view lifts (`pcurveRanges`, split out of `liftPcurve`).
- **`wrapAxis`** cuts each path at the periodic seams and shifts the pieces into the window. It inserts the crossing point on both sides of a cut and drops zero-length pieces.
- **`wrapUv`** moves a hover point into the window.

`uvAt` moves from `view3d/pick.ts` to `geom/pcurve.ts`, where it belongs.

**Files:**
- Create: `frontend/src/viewuv/model.ts`, `frontend/test/uvmodel.test.ts`
- Modify: `frontend/src/geom/pcurve.ts`, `frontend/src/view3d/pick.ts`, `frontend/test/pick3d.test.ts`

**Interfaces:**
- Produces (`geom/pcurve.ts`): `pcurveRanges(g, s, box): Range[]`; `uvAt(c, t): Vec2` (moved).
- Produces (`viewuv/model.ts`):
  - `interface UvPath { id; label; color; dashed; paths: Vec2[][] }`;
  - `interface UvModel { surface; geom; u; v; period; seams; curves }`;
  - `uvSubject(objects, selected)`;
  - `wrapUv(m, uv)`;
  - `wrapAxis(path, axis, lo, period): Vec2[][]`;
  - `uvModel(objects, subject, box, visible)`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/uvmodel.test.ts`:

````ts
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
````

Patch `frontend/test/pick3d.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/pick3d.test.ts b/frontend/test/pick3d.test.ts
index fe91bd6..5935552 100644
--- a/frontend/test/pick3d.test.ts
+++ b/frontend/test/pick3d.test.ts
@@ -2,7 +2,8 @@ import { describe, expect, it } from "vitest";
 import type { Geom } from "../src/geom/types";
 import type { Frame, Vec2, Vec3 } from "../src/geom/vec";
 import type { SceneObject } from "../src/protocol";
-import { Hit3D, Project, describeHit3D, pickProjected, surfaceUv, uvAt } from "../src/view3d/pick";
+import { uvAt } from "../src/geom/pcurve";
+import { Hit3D, Project, describeHit3D, pickProjected, surfaceUv } from "../src/view3d/pick";
 import type { Pickable3D } from "../src/view3d/render";
 
 const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/pick3d.test.ts test/uvmodel.test.ts)
````

Expected: `uvmodel.test.ts` cannot load `../src/viewuv/model`, and `pick3d.test.ts › evaluates a (u, v) line, circle or polyline at t` fails (`uvAt` not exported from `geom/pcurve`).

- [ ] **Step 3: Implement**

Create `frontend/src/viewuv/model.ts`:

````ts
import { halfSize } from "../geom/bounds";
import { pcurveRanges, uvAt } from "../geom/pcurve";
import { sampleAdaptive } from "../geom/sample";
import { periods, surfaceWindow } from "../geom/surfaces";
import { Range, SurfaceGeom, isPcurve, isSurface } from "../geom/types";
import type { Box, Vec2 } from "../geom/vec";
import type { SceneObject } from "../protocol";
import { colorOf } from "../ui/colors";
import { ticks } from "../view2d/plane";

/** One pcurve as the pane draws it: (u, v) paths wrapped into the window, cut at the seams. */
export interface UvPath {
  id: string;
  label: string;
  color: string;
  dashed: boolean;
  paths: Vec2[][];
}

export interface UvModel {
  surface: SceneObject;
  geom: SurfaceGeom;
  u: Range;
  v: Range;
  /** Periods of the directions that wrap (2π), null for the others. */
  period: { u: number | null; v: number | null };
  /** Seam lines inside the window: u (or v) = a multiple of the period. */
  seams: { u: number[]; v: number[] };
  curves: UvPath[];
}

/**
 * The surface the (u,v) pane shows (spec §5.4): the selected surface, else the surface of
 * the selected pcurve, else that of the first pcurve in the scene; null when none applies
 * (the pane then stays hidden). A pcurve whose surface is missing gives nothing.
 */
export function uvSubject(objects: ReadonlyMap<string, SceneObject>, selected: string | null): SceneObject | null {
  const surfaceOf = (o: SceneObject | undefined): SceneObject | null => {
    if (!o) return null;
    if (isSurface(o.geom)) return o;
    if (!isPcurve(o.geom)) return null;
    const s = objects.get(o.geom.surface);
    return s && isSurface(s.geom) ? s : null;
  };
  const picked = selected ? surfaceOf(objects.get(selected)) : null;
  if (picked) return picked;
  for (const o of objects.values()) {
    if (!isPcurve(o.geom)) continue;
    const s = surfaceOf(o);
    if (s) return s;
  }
  return null;
}

/** Lift x into [lo, lo + period) — or leave it when the direction does not wrap. */
const wrap = (x: number, lo: number, period: number | null): number => (period ? lo + ((((x - lo) % period) + period) % period) : x);

/** A (u, v) point moved into the window across the periodic directions (where the pane draws it). */
export function wrapUv(m: Pick<UvModel, "u" | "v" | "period">, uv: Vec2): Vec2 {
  return [wrap(uv[0], m.u[0], m.period.u), wrap(uv[1], m.v[0], m.period.v)];
}

/**
 * Cut a path where it crosses a seam of `axis` (lo + k·period) and shift each piece into
 * [lo, lo + period], adding the crossing point at both ends of the cut. A path that only
 * touches a seam at its end leaves no zero-length piece behind.
 */
export function wrapAxis(path: Vec2[], axis: 0 | 1, lo: number, period: number): Vec2[][] {
  const cell = (p: Vec2) => Math.floor((p[axis] - lo) / period);
  const shift = (p: Vec2, k: number): Vec2 => (axis === 0 ? [p[0] - k * period, p[1]] : [p[0], p[1] - k * period]);
  const out: Vec2[][] = [];
  if (!path.length) return out;
  let k = cell(path[0]);
  let piece: Vec2[] = [shift(path[0], k)];
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const kb = cell(b);
    while (k !== kb) {
      const step = kb > k ? 1 : -1;
      const seam = lo + (step > 0 ? k + 1 : k) * period;
      const s = (seam - a[axis]) / (b[axis] - a[axis]);
      const c: Vec2 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
      piece.push(shift(c, k));
      out.push(piece);
      k += step;
      piece = [shift(c, k)];
    }
    piece.push(shift(b, k));
  }
  out.push(piece);
  const tol = 1e-9 * period;
  return out.filter((p) => p.some((q) => Math.abs(q[0] - p[0][0]) > tol || Math.abs(q[1] - p[0][1]) > tol));
}

/**
 * What the (u,v) pane draws for `subject`: its window (as the 3D view tessellates it), the
 * seams, and every visible pcurve on it, sampled over the same parameter intervals the 3D
 * view lifts and wrapped into the window.
 */
export function uvModel(objects: Iterable<SceneObject>, subject: SceneObject, box: Box, visible: (o: SceneObject) => boolean): UvModel {
  const geom = subject.geom as SurfaceGeom;
  const { u, v } = surfaceWindow(geom, halfSize(box));
  const period = periods(geom);
  const seams = {
    u: period.u ? ticks(u[0], u[1], period.u) : [],
    v: period.v ? ticks(v[0], v[1], period.v) : [],
  };
  const tol = 5e-4 * Math.max(u[1] - u[0], v[1] - v[0]);
  const curves: UvPath[] = [];
  for (const o of objects) {
    const g = o.geom;
    if (!isPcurve(g) || g.surface !== subject.id || !visible(o)) continue;
    let paths = pcurveRanges(g, geom, box).map(([a, b]) => sampleAdaptive((t) => uvAt(g.curve, t), a, b, tol).pts);
    if (period.u) paths = paths.flatMap((p) => wrapAxis(p, 0, u[0], period.u!));
    if (period.v) paths = paths.flatMap((p) => wrapAxis(p, 1, v[0], period.v!));
    curves.push({ id: o.id, label: o.label ?? o.id, color: colorOf(o), dashed: Boolean(o.style?.dashed), paths });
  }
  return { surface: subject, geom, u, v, period, seams, curves };
}
````

Patch `frontend/src/geom/pcurve.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/geom/pcurve.ts b/frontend/src/geom/pcurve.ts
index da62d5d..a0286dd 100644
--- a/frontend/src/geom/pcurve.ts
+++ b/frontend/src/geom/pcurve.ts
@@ -4,8 +4,8 @@ import { evalCurve } from "./curves";
 import { Sampled, sampleAdaptive } from "./sample";
 import { evalSurface, periods, surfaceWindow } from "./surfaces";
 import { WORLD_TOL } from "./tessellate";
-import { Geom, PcurveGeom, Range, SurfaceGeom, isSurface } from "./types";
-import type { Box, Vec3 } from "./vec";
+import { Geom, PcurveGeom, Range, SurfaceGeom, UvCurve, isSurface } from "./types";
+import type { Box, Vec2, Vec3 } from "./vec";
 
 /**
  * The surface a pcurve lies on, or null when its id names no object or one that is not a
@@ -35,6 +35,26 @@ function uvRanges(g: PcurveGeom["curve"] & { type: "line" | "circle" }, s: Surfa
   return ranges.length ? ranges : clipCurve2D(g, { xmin: u[0], xmax: u[1], ymin: v[0], ymax: v[1] });
 }
 
+/** The parameter intervals of a pcurve that are drawn: see `uvRanges`; a polyline's whole length, [0, n − 1]. */
+export function pcurveRanges(g: PcurveGeom, s: SurfaceGeom, box: Box): Range[] {
+  const c = g.curve;
+  if (c.type === "polyline") return c.points.length >= 2 ? [[0, c.points.length - 1]] : [];
+  const { u, v } = surfaceWindow(s, halfSize(box));
+  return uvRanges(c, s, u, v);
+}
+
+/** A (u, v) curve's point at t: the line or circle evaluated, the polyline at i + s along segment i. */
+export function uvAt(c: UvCurve, t: number): Vec2 {
+  if (c.type !== "polyline") {
+    const q = evalCurve(c, t);
+    return [q[0], q[1]];
+  }
+  const i = Math.max(0, Math.min(Math.floor(t), c.points.length - 2));
+  const [a, b] = [c.points[i], c.points[i + 1]];
+  const s = t - i;
+  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
+}
+
 /**
  * The pcurve in 3D, S(q(t)) (spec §4.2), sampled to `tol` in world units. Each piece carries
  * the pcurve's parameter: t for a (u, v) line or circle, i + s along the polyline's
@@ -54,10 +74,9 @@ export function liftPcurve(g: PcurveGeom, s: SurfaceGeom, box: Box, tol = WORLD_
     }
     return [{ pts, ts }];
   }
-  const { u, v } = surfaceWindow(s, halfSize(box));
   const lift = (t: number): Vec3 => {
     const q = evalCurve(c, t);
     return evalSurface(s, q[0], q[1]);
   };
-  return uvRanges(c, s, u, v).map(([a, b]) => sampleAdaptive(lift, a, b, tol));
+  return pcurveRanges(g, s, box).map(([a, b]) => sampleAdaptive(lift, a, b, tol));
 }
PATCH
````

Patch `frontend/src/view3d/pick.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/view3d/pick.ts b/frontend/src/view3d/pick.ts
index 655b1ce..75cade5 100644
--- a/frontend/src/view3d/pick.ts
+++ b/frontend/src/view3d/pick.ts
@@ -1,8 +1,8 @@
 import { evalCurve } from "../geom/curves";
-import { pcurveSurface } from "../geom/pcurve";
+import { pcurveSurface, uvAt } from "../geom/pcurve";
 import { evalSurface } from "../geom/surfaces";
 import type { SurfaceGrid } from "../geom/tessellate";
-import { Geom, UvCurve, isCurve, isPcurve, isSurface } from "../geom/types";
+import { Geom, isCurve, isPcurve, isSurface } from "../geom/types";
 import type { Vec2, Vec3 } from "../geom/vec";
 import type { SceneObject } from "../protocol";
 import { fmtNum, fmtParams, fmtPoint } from "../ui/format";
@@ -85,17 +85,6 @@ export function surfaceUv(grid: SurfaceGrid, st: Vec2): Vec2 {
   return [lerp(grid.u[0], grid.u[1], st[0]), lerp(grid.v[0], grid.v[1], st[1])];
 }
 
-/** A (u, v) curve's point at t: the line or circle evaluated, the polyline at i + s along segment i. */
-export function uvAt(c: UvCurve, t: number): Vec2 {
-  if (c.type !== "polyline") {
-    const q = evalCurve(c, t);
-    return [q[0], q[1]];
-  }
-  const i = Math.max(0, Math.min(Math.floor(t), c.points.length - 2));
-  const q = lerp3(c.points[i], c.points[i + 1], t - i);
-  return [q[0], q[1]];
-}
-
 const uvText = (uv: Vec2): string => `u = ${fmtNum(uv[0], 4)} · v = ${fmtNum(uv[1], 4)}`;
 
 /** Tooltip lines for a 3D hover hit: "label · type", t and/or (u, v), the point, `meta.params`. */
PATCH
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/pick3d.test.ts test/uvmodel.test.ts)
(cd frontend && npx vitest run && npx tsc --noEmit)
````

Expected: 17 passed (17); vitest 272 passed in 27 files; `tsc` prints nothing.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/src/geom/pcurve.ts frontend/src/view3d/pick.ts frontend/src/viewuv/model.ts frontend/test/pick3d.test.ts frontend/test/uvmodel.test.ts
git commit -m "uv: the pane's model (subject surface, window, seams, pcurves wrapped across seams); uvAt moves to geom/pcurve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 11: The (u,v) pane and the linked hover

`UvPane` is a 320 × 220 canvas inset at the bottom right of the 3D view, ×1.5 in presentation mode. It draws:
- the window with 1-2-5 ticks;
- the dashed seams;
- the pcurves, dashed when styled;
- a dot for the linked hover.

Its title reads "Y · cylinder (u, v)", and a readout reads "u 1.571 · v 1.5 → (0, 2, 1.5)".

**Linked hover:**
- Hovering inside the pane's window publishes `{from: "uv"}`. The 3D view then shows a cursor marker at S(u, v).
- Hovering the surface or a pcurve in 3D publishes `{from: "3d"}` with its (u, v), and the pane shows the dot. A point on the far side of a seam is wrapped into the window.

**Visibility.** The pane is drawn only while the 3D view is active, the pane is toggled on, and there is a subject. `main.ts` wires the pane, the link and `setActive`.

**Files:**
- Create: `frontend/src/viewuv/pane.ts`
- Modify: `frontend/e2e/view3d.e2e.ts`, `frontend/src/main.ts`, `frontend/src/style.css`, `frontend/src/view3d/view.ts`, `frontend/src/viewuv/model.ts`, `frontend/test/uvmodel.test.ts`

**Interfaces:**
- Produces (`viewuv/model.ts`):
  - `interface PlotRect { left; top; width; height }`;
  - `toPane(m, r, uv): Vec2`;
  - `fromPane(m, r, p): { uv; inside }`;
  - `hoverText(uv, p): string`.
- Produces (`viewuv/pane.ts`): `class UvPane` with
  - `constructor(store, ui, link, host)`;
  - `readonly root` (`div.uvpane` with `.uv-title`, `canvas`, `.uv-readout`);
  - `get shown(): UvModel | null`;
  - `setActive(active)`.
- Changes (`View3D`):
  - `constructor(store, ui, host, link: HoverLink)`;
  - a private `cursor: Marker | null`;
  - a mesh named `uv-cursor` while the pane hovers.

- [ ] **Step 1: Write the failing tests**

Patch `frontend/e2e/view3d.e2e.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/e2e/view3d.e2e.ts b/frontend/e2e/view3d.e2e.ts
index 08ebf08..532ef53 100644
--- a/frontend/e2e/view3d.e2e.ts
+++ b/frontend/e2e/view3d.e2e.ts
@@ -74,3 +74,47 @@ test("hovering a 3D curve highlights it and shows its parameter and point", asyn
   await expect(tooltip).toContainText(", 2.236)"); // on SY₁, whatever t the pointer lands on
   await expect(page.locator("#view3d .labels .label.lit")).toHaveText("SY₁");
 });
+
+test("the (u,v) pane shows the pcurves' surface, and U hides it", async ({ page, request }) => {
+  await postScene(request, "pcurve");
+  await page.goto("/");
+  const pane = page.locator(".uvpane");
+  await expect(pane).toBeVisible();
+  await expect(pane.locator(".uv-title")).toHaveText("Y · cylinder (u, v)");
+  await page.keyboard.press("u");
+  await expect(pane).toBeHidden();
+  await page.keyboard.press("u");
+  await expect(pane).toBeVisible();
+  await page.keyboard.press("2");
+  await expect(pane).toBeHidden(); // it belongs to the 3D view
+});
+
+test("hover links the (u,v) pane and the 3D view both ways", async ({ page, request }) => {
+  await postScene(request, "pcurve");
+  await page.goto("/");
+  await expect.poll(() => pixelsLike(page, "#00798c")).toBeGreaterThan(100); // the ring is drawn
+  const box = (await page.locator(".uvpane canvas").boundingBox())!;
+  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
+  await expect(page.locator(".uv-readout")).toContainText("→ (");
+  expect(await page.evaluate(() => (window as unknown as { __gv: { view3d: { scene: { getMeshByName(n: string): unknown } } } }).__gv.view3d.scene.getMeshByName("uv-cursor") !== null)).toBe(true);
+  const [x, y] = await page.evaluate(() => {
+    const gv = (window as unknown as { __gv: { view3d: { screenOf(p: number[]): number[]; canvas: HTMLCanvasElement } } }).__gv;
+    const s = gv.view3d.screenOf([0, -2, 1.5]); // the ring at u = 3π/2, facing the camera
+    const r = gv.view3d.canvas.getBoundingClientRect();
+    return [r.left + s[0], r.top + s[1]];
+  });
+  await page.mouse.move(x, y);
+  await expect(page.locator("#view3d .tooltip .head")).toHaveText("ring · pcurve");
+  await expect(page.locator(".uv-readout")).toContainText("· v 1.5 → (");
+});
+
+test("selecting a surface shows it in the (u,v) pane", async ({ page, request }) => {
+  await postScene(request, "quadrics_3d");
+  await page.goto("/");
+  await expect(page.locator("#count")).toHaveText("7 objects");
+  await expect(page.locator(".uvpane")).toBeHidden(); // no pcurve, nothing selected
+  await page.locator("#object-list li.object", { hasText: "S" }).first().click();
+  await expect(page.locator(".uvpane .uv-title")).toHaveText("S · sphere (u, v)");
+  await page.keyboard.press("Escape");
+  await expect(page.locator(".uvpane")).toBeHidden();
+});
PATCH
````

Patch `frontend/test/uvmodel.test.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/test/uvmodel.test.ts b/frontend/test/uvmodel.test.ts
index be9fafc..710ba60 100644
--- a/frontend/test/uvmodel.test.ts
+++ b/frontend/test/uvmodel.test.ts
@@ -4,7 +4,7 @@ import { viewBox } from "../src/geom/bounds";
 import type { Geom } from "../src/geom/types";
 import type { Frame, Vec2 } from "../src/geom/vec";
 import type { SceneObject } from "../src/protocol";
-import { uvModel, uvSubject, wrapAxis, wrapUv } from "../src/viewuv/model";
+import { fromPane, hoverText, toPane, uvModel, uvSubject, wrapAxis, wrapUv } from "../src/viewuv/model";
 
 const TAU = 2 * Math.PI;
 const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
@@ -84,3 +84,28 @@ describe("uvModel", () => {
     close(wrapUv(m, [-1, 7]), [TAU - 1, 7]);
   });
 });
+
+describe("pane mapping", () => {
+  const m = { u: [0, TAU] as [number, number], v: [-1, 4] as [number, number] };
+  const r = { left: 30, top: 10, width: 200, height: 100 };
+
+  it("stretches the window over the plot area, v upwards", () => {
+    close(toPane(m, r, [0, -1]), [30, 110]);
+    close(toPane(m, r, [TAU, 4]), [230, 10]);
+    close(toPane(m, r, [Math.PI, 1.5]), [130, 60]);
+  });
+
+  it("maps pixels back, telling whether they are in the window", () => {
+    const { uv, inside } = fromPane(m, r, [130, 60]);
+    close(uv, [Math.PI, 1.5]);
+    expect(inside).toBe(true);
+    expect(fromPane(m, r, [20, 60]).inside).toBe(false);
+    expect(fromPane(m, r, [130, 111]).inside).toBe(false);
+  });
+});
+
+describe("hoverText", () => {
+  it("reads u, v and the surface point", () => {
+    expect(hoverText([Math.PI / 2, 1.5], [0, 2, 1.5])).toBe("u 1.571 · v 1.5 → (0, 2, 1.5)");
+  });
+});
PATCH
````

- [ ] **Step 2: Run the tests to verify they fail**

Run:

````bash
(cd frontend && npx vitest run test/uvmodel.test.ts)
````

Expected: `Tests 3 failed | 8 passed (11)`: `toPane`, `fromPane` and `hoverText` are not functions.

- [ ] **Step 3: Implement**

Create `frontend/src/viewuv/pane.ts`:

````ts
import { FrameScheduler } from "../frame";
import { viewBox } from "../geom/bounds";
import { evalSurface } from "../geom/surfaces";
import type { Vec2 } from "../geom/vec";
import type { Store } from "../store";
import { fmtNum } from "../ui/format";
import { FONT_FAMILY } from "../ui/labels";
import type { UiState } from "../ui/state";
import { PALETTES } from "../ui/theme";
import { gridSpacing, ticks } from "../view2d/plane";
import { HoverLink } from "./link";
import { PlotRect, UvModel, fromPane, hoverText, toPane, uvModel, uvSubject, wrapUv } from "./model";

/** The pane's size in CSS pixels (×1.5 in presentation mode) and the plot's margins inside it. */
const WIDTH = 320;
const HEIGHT = 220;
const PAD = { left: 34, right: 10, top: 8, bottom: 20 };
const LINE_PX = 2;
const DASH: [number, number] = [6, 4];

/**
 * The linked (u,v) pane (spec §5.4): an inset over the 3D view showing a surface's (u,v)
 * window, its seams and the pcurves on it. Hover in it puts a marker on the surface in 3D;
 * hover on the surface or a pcurve in 3D puts one here.
 */
export class UvPane {
  readonly root: HTMLDivElement;
  private title: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private readout: HTMLDivElement;
  private ctx: CanvasRenderingContext2D | null;
  private active = false;
  private model: UvModel | null = null;
  private frame = new FrameScheduler(() => this.draw());

  constructor(
    private store: Store,
    private ui: UiState,
    private link: HoverLink,
    host: HTMLElement,
  ) {
    this.root = document.createElement("div");
    this.root.className = "uvpane";
    this.root.hidden = true;
    this.title = document.createElement("div");
    this.title.className = "uv-title";
    this.canvas = document.createElement("canvas");
    this.readout = document.createElement("div");
    this.readout.className = "uv-readout";
    this.root.append(this.title, this.canvas, this.readout);
    host.appendChild(this.root);
    this.ctx = this.canvas.getContext("2d");
    store.onChange(() => this.frame.request());
    ui.onChange(() => this.frame.request());
    link.onChange(() => this.frame.request());
    this.canvas.addEventListener("pointermove", (ev) => this.pointer(ev));
    this.canvas.addEventListener("pointerleave", () => {
      if (this.link.current?.from === "uv") this.link.set(null);
    });
  }

  /** Debug and e2e access: what the pane shows (null when hidden). */
  get shown(): UvModel | null {
    return this.root.hidden ? null : this.model;
  }

  /** The pane belongs to the 3D view: it is drawn only while that view is shown. */
  setActive(active: boolean): void {
    this.active = active;
    this.frame.request();
  }

  private get scale(): number {
    return this.ui.presenting ? 1.5 : 1;
  }

  private plot(): PlotRect {
    const k = this.scale;
    return { left: PAD.left * k, top: PAD.top * k, width: (WIDTH - PAD.left - PAD.right) * k, height: (HEIGHT - PAD.top - PAD.bottom) * k };
  }

  private pointer(ev: PointerEvent): void {
    const m = this.model;
    if (!m) return;
    const r = this.canvas.getBoundingClientRect();
    const { uv, inside } = fromPane(m, this.plot(), [ev.clientX - r.left, ev.clientY - r.top]);
    if (inside) this.link.set({ surface: m.surface.id, uv, from: "uv" });
    else if (this.link.current?.from === "uv") this.link.set(null);
  }

  private draw(): void {
    const subject = this.active && this.ui.uvPane ? uvSubject(this.store.objects, this.ui.selected) : null;
    this.root.hidden = !subject;
    if (!subject || !this.ctx) {
      this.model = null;
      return;
    }
    const objects = [...this.store.objects.values()];
    const m = uvModel(objects, subject, viewBox(objects.map((o) => o.geom)), (o) => this.ui.isVisible(o));
    this.model = m;
    const k = this.scale;
    const [w, h] = [WIDTH * k, HEIGHT * k];
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      [this.canvas.width, this.canvas.height] = [Math.round(w * dpr), Math.round(h * dpr)];
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const palette = PALETTES[this.ui.theme];
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, w, h);
    const r = this.plot();
    const at = (uv: Vec2) => toPane(m, r, uv);
    const segment = (a: Vec2, b: Vec2, color: string, width: number, dash: number[] = []) => {
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.moveTo(...at(a));
      ctx.lineTo(...at(b));
      ctx.stroke();
    };

    // Grid and tick labels: about four steps across each direction.
    ctx.font = `${10 * k}px ${FONT_FAMILY}`;
    ctx.fillStyle = palette.axis;
    const su = gridSpacing(1, (m.u[1] - m.u[0]) / 4).major;
    const sv = gridSpacing(1, (m.v[1] - m.v[0]) / 4).major;
    for (const u of ticks(m.u[0], m.u[1], su)) {
      segment([u, m.v[0]], [u, m.v[1]], palette.gridMajor, 1);
      const [x] = at([u, m.v[0]]);
      ctx.textAlign = "center";
      ctx.fillText(fmtNum(u, 2), x, h - 6 * k);
    }
    for (const v of ticks(m.v[0], m.v[1], sv)) {
      segment([m.u[0], v], [m.u[1], v], palette.gridMajor, 1);
      const [, y] = at([m.u[0], v]);
      ctx.textAlign = "right";
      ctx.fillText(fmtNum(v, 2), r.left - 4 * k, y + 3 * k);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.left, r.top, r.width, r.height);
    // Seams: where the surface's parameter wraps around.
    for (const u of m.seams.u) segment([u, m.v[0]], [u, m.v[1]], palette.axis, 1.5 * k, [3 * k, 3 * k]);
    for (const v of m.seams.v) segment([m.u[0], v], [m.u[1], v], palette.axis, 1.5 * k, [3 * k, 3 * k]);

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left, r.top, r.width, r.height);
    ctx.clip();
    for (const c of m.curves) {
      ctx.setLineDash(c.dashed ? DASH.map((d) => d * k) : []);
      ctx.strokeStyle = c.color;
      ctx.lineWidth = LINE_PX * k;
      ctx.beginPath();
      for (const path of c.paths) {
        ctx.moveTo(...at(path[0]));
        for (const p of path.slice(1)) ctx.lineTo(...at(p));
      }
      ctx.stroke();
    }
    const hover = this.link.current;
    if (hover && hover.surface === m.surface.id) {
      const [x, y] = at(wrapUv(m, hover.uv));
      ctx.setLineDash([]);
      ctx.fillStyle = palette.text;
      ctx.beginPath();
      ctx.arc(x, y, 4 * k, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    const label = m.surface.label ?? m.surface.id;
    this.title.textContent = `${label} · ${m.geom.type} (u, v)`;
    this.readout.textContent = hover && hover.surface === m.surface.id ? hoverText(hover.uv, evalSurface(m.geom, hover.uv[0], hover.uv[1])) : " ";
  }
}
````

Patch `frontend/src/main.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/main.ts b/frontend/src/main.ts
index 15e00a9..4c170ff 100644
--- a/frontend/src/main.ts
+++ b/frontend/src/main.ts
@@ -8,6 +8,8 @@ import { type ActiveView, type AvailableViews, UiState, usableView } from "./ui/
 import { applyTheme } from "./ui/theme";
 import { View2D } from "./view2d/view";
 import { View3D } from "./view3d/view";
+import { HoverLink } from "./viewuv/link";
+import { UvPane } from "./viewuv/pane";
 
 function byId<T extends HTMLElement = HTMLElement>(id: string): T {
   const el = document.getElementById(id);
@@ -39,9 +41,12 @@ function viewFailed(view: ActiveView, message: string): void {
   failures.push(message);
 }
 
+const link = new HoverLink();
 let view3d: View3D | null = null;
+let uvpane: UvPane | null = null;
 try {
-  view3d = new View3D(store, ui, byId("view3d"));
+  view3d = new View3D(store, ui, byId("view3d"), link);
+  uvpane = new UvPane(store, ui, link, byId("view3d"));
 } catch (err) {
   console.error("geomcore-viewer: 3D view failed", err);
   viewFailed("3d", `3D view unavailable: ${err instanceof Error ? err.message : String(err)}`);
@@ -69,6 +74,7 @@ const shell = new FrameScheduler(() => {
   autofit.checked = ui.autoFit;
   view2d.setActive(view === "2d");
   view3d?.setActive(view === "3d");
+  uvpane?.setActive(view === "3d");
 });
 store.onChange(() => shell.request());
 ui.onChange((ev) => {
@@ -124,6 +130,6 @@ window.addEventListener("drop", (e) => {
 });
 
 // Debug and e2e access (the e2e tests read cameras and strokes through it).
-Object.assign(window, { __gv: { store, ui, view2d, view3d } });
+Object.assign(window, { __gv: { store, ui, view2d, view3d, uvpane, link } });
 
 void store.load();
PATCH
````

Patch `frontend/src/style.css` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/style.css b/frontend/src/style.css
index 5ded056..e1e5dcb 100644
--- a/frontend/src/style.css
+++ b/frontend/src/style.css
@@ -60,6 +60,12 @@ main { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 260px;
 .toolbar3d { position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.25rem; }
 .toolbar3d button { padding: 0.15rem 0.45rem; font-size: 0.75rem; opacity: 0.85; }
 body.presenting .toolbar3d { display: none; }
+.uvpane { position: absolute; right: 0.5rem; bottom: 0.5rem; z-index: 1; padding: 0.3rem 0.4rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font-size: 12px; }
+.uvpane[hidden] { display: none; }
+.uvpane canvas { display: block; }
+.uvpane .uv-title { font-weight: 600; margin-bottom: 0.2rem; }
+.uvpane .uv-readout { font-variant-numeric: tabular-nums; color: var(--muted); min-height: 1.4em; white-space: nowrap; }
+body.presenting .uvpane { font-size: 18px; }
 #view2d canvas { display: block; }
 
 aside#panel { background: var(--surface); border-left: 1px solid var(--border); padding: 0.5rem 0.75rem; overflow: auto; }
PATCH
````

Patch `frontend/src/view3d/view.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/view3d/view.ts b/frontend/src/view3d/view.ts
index 544ed09..e4eab8f 100644
--- a/frontend/src/view3d/view.ts
+++ b/frontend/src/view3d/view.ts
@@ -1,7 +1,9 @@
 import * as BABYLON from "@babylonjs/core";
 import { Changes, FrameScheduler } from "../frame";
 import { sameBox, sceneBounds, viewBox } from "../geom/bounds";
-import { isPcurve } from "../geom/types";
+import { uvAt } from "../geom/pcurve";
+import { evalSurface } from "../geom/surfaces";
+import { isPcurve, isSurface } from "../geom/types";
 import type { Box, Vec2, Vec3 } from "../geom/vec";
 import type { SceneObject } from "../protocol";
 import type { Store } from "../store";
@@ -9,10 +11,11 @@ import { LabelItem, LabelLayer, TextMeasure } from "../ui/labels";
 import type { UiEvent, UiState } from "../ui/state";
 import { PALETTES, Palette, mixHex } from "../ui/theme";
 import { placeLabels } from "../view2d/placement";
+import type { HoverLink, UvHover } from "../viewuv/link";
 import { EXTRA_MIX, TextKind } from "../view2d/render";
 import { SNAPS, Snap, cameraScale, fitRadius, orthoExtents, pixelSize } from "./camera";
 import { Hit3D, Project, describeHit3D, pickProjected, surfaceUv } from "./pick";
-import { Lines3D, Markers3D, ObjectDraw3D, Text3D, hasCurves, objectDraw3D, screenPx } from "./render";
+import { Lines3D, Markers3D, ObjectDraw3D, POINT_PX, Text3D, hasCurves, objectDraw3D, screenPx } from "./render";
 import { Ground, ground } from "./scene";
 
 const v3 = (p: Vec3) => new BABYLON.Vector3(p[0], p[1], p[2]);
@@ -29,10 +32,17 @@ interface Built {
   draw: ObjectDraw3D;
   meshes: BABYLON.AbstractMesh[];
   lines: { mesh: BABYLON.GreasedLineBaseMesh; part: Lines3D }[];
-  markers: { mesh: BABYLON.Mesh; part: Markers3D; matrices: Float32Array }[];
+  markers: Marker[];
   surface: BABYLON.StandardMaterial | null;
 }
 
+/** Thin-instanced spheres and the positions they stand at. */
+interface Marker {
+  mesh: BABYLON.Mesh;
+  part: Markers3D;
+  matrices: Float32Array;
+}
+
 /**
  * The 3D view (spec §5.3), z up and right-handed like geomcore: constant-pixel GreasedLine
  * curves, tessellated surfaces, screen-size markers, a ground grid and axis triad, and a
@@ -63,11 +73,14 @@ export class View3D {
   /** Labels follow the camera: re-placed after a frame in which it (or the scene) moved. */
   private labelsDirty = true;
   private hover: Hit3D | null = null;
+  /** The point the (u,v) pane's pointer is at, S(u, v), on its surface. */
+  private cursor: Marker | null = null;
 
   constructor(
     private store: Store,
     private ui: UiState,
     private host: HTMLElement,
+    private link: HoverLink,
   ) {
     this.canvas = document.createElement("canvas");
     this.canvas.id = "canvas3d";
@@ -101,6 +114,7 @@ export class View3D {
     this.tooltip.hidden = true;
     host.appendChild(this.tooltip);
     this.listenHover();
+    link.onChange((h) => this.showCursor(h));
     store.onChange((ev) => {
       if (ev.type === "meta") return;
       this.changes.note(ev);
@@ -300,20 +314,42 @@ export class View3D {
     const eye = this.camera.position;
     const forward = this.camera.getForwardRay(1).direction;
     const ws = this.widthScale;
+    const size = ({ mesh, part, matrices }: Marker, lit: boolean) => {
+      const px = screenPx(part.px, ws, lit);
+      part.at.forEach((p, i) => {
+        const depth = (p[0] - eye.x) * forward.x + (p[1] - eye.y) * forward.y + (p[2] - eye.z) * forward.z;
+        const s = 2 * px * pixelSize(gauge, depth); // the marker mesh is a unit-diameter sphere
+        BABYLON.Matrix.ScalingToRef(s, s, s, scratch);
+        scratch.setTranslationFromFloats(p[0], p[1], p[2]);
+        scratch.copyToArray(matrices, 16 * i);
+      });
+      mesh.thinInstanceBufferUpdated("matrix");
+    };
     for (const b of this.built.values()) {
       const lit = this.isLit(b.draw.id);
-      for (const { mesh, part, matrices } of b.markers) {
-        const px = screenPx(part.px, ws, lit);
-        part.at.forEach((p, i) => {
-          const depth = (p[0] - eye.x) * forward.x + (p[1] - eye.y) * forward.y + (p[2] - eye.z) * forward.z;
-          const s = 2 * px * pixelSize(gauge, depth); // the marker mesh is a unit-diameter sphere
-          BABYLON.Matrix.ScalingToRef(s, s, s, scratch);
-          scratch.setTranslationFromFloats(p[0], p[1], p[2]);
-          scratch.copyToArray(matrices, 16 * i);
-        });
-        mesh.thinInstanceBufferUpdated("matrix");
-      }
+      for (const marker of b.markers) size(marker, lit);
     }
+    if (this.cursor) size(this.cursor, false);
+  }
+
+  /** Spec §5.4: the (u,v) pane's pointer, shown on its surface at S(u, v). */
+  private showCursor(h: UvHover | null): void {
+    if (this.cursor) disposeMesh(this.cursor.mesh);
+    this.cursor = null;
+    const s = h?.from === "uv" ? this.store.objects.get(h.surface)?.geom : undefined;
+    if (!h || !s || !isSurface(s)) return;
+    const at = evalSurface(s, h.uv[0], h.uv[1]);
+    this.cursor = this.markers("uv-cursor", { id: h.surface, at: [at], color: this.palette.text, px: POINT_PX, alpha: 1, extra: false });
+    this.cursor.mesh.renderingGroupId = 1;
+  }
+
+  /** Spec §5.4: a hover on a surface or a pcurve tells the (u,v) pane where it is. */
+  private publish(hit: Hit3D | null): void {
+    const o = hit ? this.store.objects.get(hit.id) : undefined;
+    let next: UvHover | null = null;
+    if (hit && o && hit.uv) next = { surface: o.id, uv: hit.uv, from: "3d" };
+    else if (hit && o && isPcurve(o.geom) && hit.t !== null) next = { surface: o.geom.surface, uv: uvAt(o.geom.curve, hit.t), from: "3d" };
+    if (next || this.link.current?.from === "3d") this.link.set(next);
   }
 
   private isLit(id: string): boolean {
@@ -422,6 +458,7 @@ export class View3D {
   private setHover(hit: Hit3D | null, pointer: [number, number] | null): void {
     const changed = hit?.id !== this.hover?.id;
     this.hover = hit;
+    this.publish(hit);
     if (changed) {
       this.applyHighlight();
       this.labelsDirty = true;
@@ -536,7 +573,7 @@ export class View3D {
   }
 
   /** One unit sphere drawn at every position (thin instances), resized each frame to keep its pixel radius. */
-  private markers(name: string, part: Markers3D) {
+  private markers(name: string, part: Markers3D): Marker {
     const mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter: 1, segments: 8 }, this.scene);
     const mat = new BABYLON.StandardMaterial(`${name}-m`, this.scene);
     const color = color3(part.extra ? mixHex(part.color, this.palette.bg, EXTRA_MIX) : part.color);
PATCH
````

Patch `frontend/src/viewuv/model.ts` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/frontend/src/viewuv/model.ts b/frontend/src/viewuv/model.ts
index 16ca1cf..a67a501 100644
--- a/frontend/src/viewuv/model.ts
+++ b/frontend/src/viewuv/model.ts
@@ -3,9 +3,10 @@ import { pcurveRanges, uvAt } from "../geom/pcurve";
 import { sampleAdaptive } from "../geom/sample";
 import { periods, surfaceWindow } from "../geom/surfaces";
 import { Range, SurfaceGeom, isPcurve, isSurface } from "../geom/types";
-import type { Box, Vec2 } from "../geom/vec";
+import type { Box, Vec2, Vec3 } from "../geom/vec";
 import type { SceneObject } from "../protocol";
 import { colorOf } from "../ui/colors";
+import { fmtNum, fmtPoint } from "../ui/format";
 import { ticks } from "../view2d/plane";
 
 /** One pcurve as the pane draws it: (u, v) paths wrapped into the window, cut at the seams. */
@@ -117,3 +118,29 @@ export function uvModel(objects: Iterable<SceneObject>, subject: SceneObject, bo
   }
   return { surface: subject, geom, u, v, period, seams, curves };
 }
+
+/** The pane's plot area in CSS pixels: the window is stretched to fill it (u and v need not share a scale). */
+export interface PlotRect {
+  left: number;
+  top: number;
+  width: number;
+  height: number;
+}
+
+/** (u, v) → pane pixels: u grows to the right, v upwards. */
+export function toPane(m: Pick<UvModel, "u" | "v">, r: PlotRect, uv: Vec2): Vec2 {
+  return [r.left + ((uv[0] - m.u[0]) / (m.u[1] - m.u[0])) * r.width, r.top + r.height - ((uv[1] - m.v[0]) / (m.v[1] - m.v[0])) * r.height];
+}
+
+/** Pane pixels → (u, v); `inside` tells whether the point is in the window. */
+export function fromPane(m: Pick<UvModel, "u" | "v">, r: PlotRect, p: Vec2): { uv: Vec2; inside: boolean } {
+  const su = (p[0] - r.left) / r.width;
+  const sv = (r.top + r.height - p[1]) / r.height;
+  const uv: Vec2 = [m.u[0] + su * (m.u[1] - m.u[0]), m.v[0] + sv * (m.v[1] - m.v[0])];
+  return { uv, inside: su >= 0 && su <= 1 && sv >= 0 && sv <= 1 };
+}
+
+/** The pane's readout for a linked hover: "u 1.571 · v 0.5 → (x, y, z)". */
+export function hoverText(uv: Vec2, p: Vec3): string {
+  return `u ${fmtNum(uv[0])} · v ${fmtNum(uv[1])} → ${fmtPoint(p)}`;
+}
PATCH
````

- [ ] **Step 4: Run the tests to verify they pass**

Run:

````bash
(cd frontend && npx vitest run test/uvmodel.test.ts)
(cd frontend && npx vitest run && npm run build && npm run e2e)
````

Expected: 11 passed (11); vitest 275 passed in 27 files; build `✓ built`; e2e 12 passed.

- [ ] **Step 5: Commit**

````bash
git add -A frontend/e2e/view3d.e2e.ts frontend/src/main.ts frontend/src/style.css frontend/src/view3d/view.ts frontend/src/viewuv/model.ts frontend/src/viewuv/pane.ts frontend/test/uvmodel.test.ts
git commit -m "uv: the (u,v) pane (window, seams, pcurves) as an inset of the 3D view, with hover linked both ways

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

### Task 12: Docs

Update the docs for Phase 3:
- **`protocol/SCENE.md`:**
  - `pcurve` moves from "reserved" into the geometry table;
  - the lift and clip rules join "Ranges and windows";
  - document the default surface opacity and the `isolines`/`wire` defaults.
- **`README.md`:**
  - `view.pcurve` in the API table;
  - `U` in the keys;
  - a paragraph on 3D interaction and one on the (u,v) pane;
  - `view3d/` and `viewuv/` in the layout;
  - `examples/pcurve.py`.

geomcore's own `docs/viewer.md` gains its pcurve example from the user, outside this plan (see Rulings).

**Files:**
- Modify: `README.md`, `protocol/SCENE.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Update the docs**

Patch `README.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index 7b38cc7..b6ad4e3 100644
--- a/README.md
+++ b/README.md
@@ -53,6 +53,7 @@ from this repo, as in the Development section).
 | `gv.Viewer(title, view="auto"\|"2d"\|"3d", keep=False)` | a scene (new run) |
 | `view.add(*objs, label=, group=, color=, width=, dashed=, opacity=, u=, v=, foci=, asymptotes=, …)` | show objects → `Handle` / list |
 | `handle.update(color=…)`, `handle.remove()` | change or remove one object |
+| `view.pcurve(curve, on=surface)` | a `Line2D`, `Circle2D` (e.g. `circle.parametrize_on(cyl)`) or `(u, v)` pairs drawn on a surface already added |
 | `view.polyline(pts)`, `view.mesh(v, i)`, `view.arrow(at, vec)`, `view.text(at, s)` | raw geometry |
 | `view.clear()`, `view.save(path)`, `view.open()` | housekeeping |
 | `gv.add(...)`, `gv.clear()` | same, on the most recent viewer (handy in `pdb`) |
@@ -88,6 +89,7 @@ keys do nothing for it, and the failure stays in the header's status line.
 | `P` | presentation mode: header and panel hidden, lines and labels ×1.5 |
 | `T` | light / dark theme (remembered by the browser) |
 | `2` / `3` | plane view / 3D view |
+| `U` | show / hide the (u,v) pane |
 | `Esc` | leave presentation mode, else clear the selection |
 
 In the plane view, hover an object for its type, label, parameter `t`, and
@@ -96,15 +98,26 @@ In the plane view, hover an object for its type, label, parameter `t`, and
 scroll to zoom. The panel's checkboxes hide objects and whole groups, and
 stay off when the script runs again. Click a row to frame that object.
 
+In 3D, drag to orbit, right-drag to pan and scroll to zoom; the toolbar
+switches between perspective and orthographic and snaps to the top, front,
+right and iso views. Lines keep their pixel width at any distance, and
+surfaces turn translucent when the scene also holds curves. Hover a curve
+for its parameter `t` and point, a surface for its `(u, v)`.
+
+The (u,v) pane, an inset of the 3D view, shows the selected surface (or the
+surface of the selected pcurve, or of the first pcurve in the scene): its
+window, seams and the pcurves on it. Hovering it puts a marker on the
+surface in 3D; hovering the surface or a pcurve in 3D puts one in the pane.
+
 ## Layout
 
 | Path | What |
 |---|---|
 | `protocol/SCENE.md` | protocol v2: the JSON every client and the viewer speak |
 | `python/geomcore_viewer/` | client (`viewer.py`), geomcore adapter (`adapt.py`), server (`server.py`, `spawn.py`) |
-| `frontend/` | Vite + TypeScript viewer (Babylon.js 3D, PixiJS 2D); `src/geom/` is the evaluator core, `src/view2d/` the plane view |
+| `frontend/` | Vite + TypeScript viewer (Babylon.js 3D, PixiJS 2D); `src/geom/` is the evaluator core, `src/view2d/` the plane view, `src/view3d/` the 3D view, `src/viewuv/` the (u,v) pane |
 | `clients/rust/` | Rust client (protocol v1 until phase 4 of the v2 plan) |
-| `examples/` | `conics_2d.py`, `quadrics_3d.py` |
+| `examples/` | `conics_2d.py`, `quadrics_3d.py`, `pcurve.py` (each takes `--save <file>`) |
 
 ## Development
 
PATCH
````

Patch `protocol/SCENE.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/protocol/SCENE.md b/protocol/SCENE.md
index 25053a2..0d22b94 100644
--- a/protocol/SCENE.md
+++ b/protocol/SCENE.md
@@ -35,8 +35,8 @@ The viewer never computes intersections or any other geometric query.
 | `label` | no | display name (panel, point labels) |
 | `group` | no | panel grouping / visibility toggle |
 | `source` | no | client-side type name, e.g. `Ellipse3D` |
-| `style` | no | `color` (CSS), `width` (px), `dashed`, `opacity` (0–1) |
-| `extras` | no | curves: `foci`, `center`, `axes`, `asymptotes`, `directrix`, `vertex`; surfaces: `isolines: [nu, nv]`, `wire`. Unknown extras are ignored. |
+| `style` | no | `color` (CSS), `width` (px), `dashed`, `opacity` (0–1; surfaces and meshes default to 0.45 when the scene holds a curve, polyline or pcurve, else 1) |
+| `extras` | no | curves: `foci`, `center`, `axes`, `asymptotes`, `directrix`, `vertex`; surfaces: `isolines: [nu, nv]` (or `true` for 12 × 6; drawn at the middle of each cell of the window), `wire` (lines only: the isolines, 24 × 12 by default, and the window's edges). Unknown extras are ignored. |
 | `meta` | no | free-form client data. The Python client sets `tag` (the intersection result's tag, e.g. `"points"`) and `params` (the numbers of the hit, e.g. `[t, s]` for `(t, P, s)`; a non-finite one is `null`); the 2D tooltip shows `params`. |
 
 `view` is `"auto"`, `"2d"` or `"3d"`. Vectors are `[x, y, z]`; a
@@ -64,10 +64,10 @@ unit axes `o, x, y, z` (right-handed, orthonormal).
 | `arrow` | `at`, `vec` | — |
 | `text` | `at`, `text` | — |
 | `note` | `text`, `level?` (`info` / `warn`) | panel only, e.g. `P: ∅ (parallel)` |
+| `pcurve` | `surface`, `curve` | `S(q(t))`: `surface` is a surface object's `id`; `curve` is a `line`, `circle` or `polyline` in z = 0 whose x is u and y is v |
 
 Reserved for when geomcore exposes B-spline getters (clients send
-`polyline` / `mesh` until then): `bspline_curve`, `bspline_surface`,
-`pcurve`.
+`polyline` / `mesh` until then): `bspline_curve`, `bspline_surface`.
 
 Radii (`r`, `a`, `b`, `R`) must be positive and `f` non-zero.
 
@@ -83,6 +83,14 @@ Radii (`r`, `a`, `b`, `R`) must be positive and `f` non-zero.
   viewer draws it over ±the half-size of the scene's view box (1.5 × the
   scene's half-extent, at least 1) and does not flag the object. The Python
   client always fills `window` itself, from the objects already added.
+- A `pcurve` takes its surface's window. A `line` or `circle` is clipped
+  to it in the directions that do not wrap, so a helix on a cylinder winds
+  round the seam until it leaves the v window; one those leave unbounded
+  (the line v = 3 a circle gives on a cylinder) is clipped to the whole
+  window, one turn. A `polyline` is drawn whole, point to point on the
+  surface. `range` is ignored. A pcurve adds nothing to the view box, and
+  while its `surface` names no surface it is kept but not drawn, and the
+  panel flags it.
 
 ## Runs
 
PATCH
````

- [ ] **Step 2: Run the tests to verify they pass**

Run:

````bash
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests -q
(cd frontend && npx vitest run && npx tsc --noEmit && npm run build && npm run e2e)
````

Expected: pytest 125 passed; vitest 275 passed in 27 files; build `✓ built`; e2e 12 passed.

- [ ] **Step 3: Commit**

````bash
git add -A README.md protocol/SCENE.md
git commit -m "docs: pcurve in the protocol and README, 3D interaction, the (u,v) pane and the U key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
````

---

## Final Check (manual, port 8799)

Start the server on the built frontend:

```bash
PYTHONPATH=python .venv/bin/python -m geomcore_viewer serve --dir frontend/dist --port 8799
```

In a second terminal:

```bash
GEOMCORE_VIEWER_URL=http://127.0.0.1:8799 PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python examples/pcurve.py
```

Then check:
- **The 3D view.** It shows the translucent cylinder, the ring, the helix winding round to the top of the window, and the dashed zigzag.
- **The pane.** The (u,v) pane at the bottom right shows "Y · cylinder (u, v)", with the seam dashed at u = 2π when the window spans past it.
- **Pane → 3D.** Hover the pane: a dot follows on the cylinder, and the readout gives u, v and the point.
- **3D → pane.** Hover the helix in 3D: the tooltip gives t, (u, v) and the point, and the pane's dot sits on the helix's wrapped trace.
- **Keys and toolbar.**
  - Press `U`: the pane hides. Press `U` again: it shows.
  - Snap to `top`: the scene reads like the plane view.
  - Switch to `ortho`: the picture keeps its size.
  - Press `P`: lines, labels and the pane grow ×1.5.

Run `examples/quadrics_3d.py` the same way. Select `S` in the panel: the pane shows the sphere's window, and `Esc` hides it again. Stop the server with Ctrl+C.

## Phase 2 Backlog

**Folded in:**
- the 3D selection highlight (Task 8);
- fit deferred while 3D is hidden (Task 7);
- the `U` key (Task 9);
- AZERTY `2`/`3` (Task 9).

**Left for later**, unchanged in the backlog:
- store `lastScene` after a dropped file;
- UiState no-op emits and unsubscribe;
- 2D tooltip staleness after wheel zoom and panel focus loss;
- `sampleAdaptive` spending its cap depth-first;
- the header FAILURE regex;
- the Python port-80 rule encoded three times, and numpy scalar params;
- CI retries/traces and `npm run e2e` not building first;
- the listed unit-test coverage gaps;
- extras not thickened on highlight (2D and 3D).
