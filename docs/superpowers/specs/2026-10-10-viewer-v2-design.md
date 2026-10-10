# geomcore-viewer v2 — geometry-aware live viewer

Date: 2026-10-10 · Status: approved design, pending spec review

## 1. Purpose

`geomcore-viewer` exists so that someone writing `geomcore` code can *see*
the geometry while they work — a math teacher building an
ellipse ∩ circle demo live in front of a class, a contributor checking a new
intersection routine, a developer stepping through a Newton iteration in
`pdb`.

The v1 MVP is a low-level polyline/mesh dump: the user samples every curve by
hand, invents ids, unpacks intersection tuples, and gets a perspective 3D
camera with 1 px lines for a planar conic problem. v2 makes the viewer
**understand geometry**: clients send analytic definitions (the same
parameters `geomcore` stores), the viewer evaluates and draws them exactly,
and the Python API takes `geomcore` objects and intersection results as-is.

### Success criteria

1. A teacher writes ~10 lines of Python (§3.1 example), runs
   `python conics.py`, and a browser tab shows exact, labeled conics and
   their intersection points on a Cartesian plane — no sampling, ids,
   colors, or frontend paths.
2. Re-running the script replaces the picture in place, keeping camera and
   panel state.
3. In one process (script, `pdb`, IPython, notebook kernel), every `add`
   appears immediately in the same tab; re-adding a label updates in place.
4. Infinite curves (lines, parabolas, hyperbola branches) never visibly end
   when panning/zooming in 2D.
5. A 3D quadric-intersection scene is legible on a projector (thick curves,
   translucent surfaces, labels), and a curve-on-surface scene shows a linked
   (u,v) pane.
6. `pip install geomcore-viewer` is sufficient — the built frontend ships in
   the wheel.

### Non-goals

- The viewer never computes intersections, projections, or any geometric
  query. `geomcore` is the single source of truth; the viewer only evaluates
  parametrizations for display.
- No browser → Python callbacks (sliders, interactive parameters). The live
  loop is *re-run the script* or *add more from the same process*.
- No geomcore-to-WASM build. The protocol leaves room for it later (§4.5).
- No editing of geometry in the browser.
- `geomcore_viewer` keeps zero hard runtime dependencies (stdlib only;
  `geomcore` is duck-typed, not imported).

## 2. Users and workflows

| Workflow | Host | Expected behavior |
|---|---|---|
| Classroom demo | `python conics.py` + browser tab on projector | Each re-run swaps the scene; camera kept |
| Debugging | `pdb` breakpoint | `(Pdb) gv.add(curve)` appears instantly in the open tab |
| Exploration | IPython / Jupyter kernel | Cells/lines accumulate in the same tab; `view.clear()` resets |
| Docs / static demo | GitHub Pages | Loads a saved `scene.json` (`?scene=`, drag-drop, bundled sample) |
| Rust user | `cargo run --example …` | Same protocol via the Rust client (phase 4) |

## 3. Python API

### 3.1 Example

```python
# conics.py — run with: python conics.py   (re-run after every edit)
from geomcore import Point3D, Vector3D, Frame3D
from geomcore.curves import Ellipse3D, Circle3D
import geomcore_viewer as gv

view = gv.Viewer("Ellipse ∩ circle")

E = Ellipse3D.from_frame(Frame3D.world(), 3.0, 2.0)
C = Circle3D(Point3D(2, 1, 0), Vector3D.z(), 1.5)

view.add(E, label="E", foci=True)
view.add(C, label="C")
view.add(E.intersect_circle(C), label="P")   # → P₁…Pₙ with coordinates
```

### 3.2 Surface

```python
class Viewer:
    def __init__(self, title: str = "", *, view: str = "auto",   # "auto" | "2d" | "3d"
                 keep: bool = False, url: str = "http://127.0.0.1:8765",
                 open_browser: bool = True) -> None: ...
    def add(self, *objs, label: str | None = None, color: str | None = None,
            width: float | None = None, dashed: bool = False,
            opacity: float | None = None, group: str | None = None,
            **extras) -> Handle | list[Handle]: ...
    def polyline(self, points, **style) -> Handle: ...
    def mesh(self, vertices, indices, **style) -> Handle: ...
    def arrow(self, at, vec, **style) -> Handle: ...
    def text(self, at, text: str, **style) -> Handle: ...
    def clear(self) -> None: ...
    def scene(self) -> dict: ...
    def save(self, path) -> Path: ...

class Handle:
    id: str
    def update(self, **style) -> None: ...
    def remove(self) -> None: ...

# module level — uses (and lazily creates) a per-process default Viewer
def add(*objs, **kw): ...
def clear() -> None: ...
def viewer() -> Viewer: ...
```

`add` with one object returns one `Handle`; with several, or with an
intersection result that expands to several objects, it returns a list.

### 3.3 `add` dispatch (adapter)

`add` converts inputs by **class name + duck typing**; it never imports
`geomcore`. Unknown inputs raise `TypeError` naming the type and listing what
is accepted.

| Input | Emitted object(s) |
|---|---|
| `Line3D`, `Circle3D`, `Ellipse3D`, `Parabola3D`, `Hyperbola3D` | analytic curve (§4.2) |
| `Line2D`, `Circle2D` | analytic curve in the z = 0 plane |
| `Plane`, `Cylinder`, `Cone`, `Sphere`, `Torus` | analytic surface (§4.2) |
| `BSplineCurve3D` / B-spline surface | `bspline_*` if pole/knot getters exist, else sampled `polyline` / `mesh` with `source` metadata |
| `Point3D`, `Point2D` | `point` |
| `(tag, payload)` intersection result | expanded per §3.4 |
| `list` / `tuple` of the above (not a result tag) | each element, labels suffixed ₁, ₂, … |
| `intersect_curve_curve` / `intersect_curve_surface` lists | `point`s (parameters kept in `meta`) |
| `intersect_marching` → `list[BSplineCurve3D]` | curves as above |

**Frame recovery.** The bindings expose radii/center but not orientation, so
the adapter recovers the frame by evaluating the object at known parameters
using geomcore's published conventions (§4.3). Example (ellipse): `o =
center()`, `x = (P(0) − o)/a`, `y = (P(π/2) − o)/b`, `z = x × y`; cylinder:
`o = (S(0,0)+S(π,0))/2`, `x = (S(0,0) − o)/r`, `z = S(0,1) − S(0,0)`,
`y = z × x`. Recovered frames are orthonormalized and cross-checked by
re-evaluating one extra parameter; a mismatch > 1e-9 raises (never draws a
wrong shape silently).

*Optional upstream follow-up (not blocking):* add `frame()` to analytic
types and `poles()/knots()/multiplicities()/weights()` to B-splines in
geomcore-py. The adapter prefers those getters when present.

### 3.4 Intersection results

geomcore returns `(tag, payload)`. Mapping:

| Tag(s) | Display |
|---|---|
| `point`, `one_point`, `tangent_point`, `apex_point` | point(s); tangent/apex noted in label tooltip |
| `two_points`, `points`, `hits` | points `P₁…Pₙ` |
| `line`, `two_lines`, `tangent_line` | line(s) |
| `circle`, `two_circles`, `tangent_circle`, `ellipse`, `parabola`, `hyperbola` | curve(s) |
| `coincident` | `note` "E ≡ C (coincident)" + payload drawn if geometric |
| `empty`, `parallel`, `skew` | `note` "E ∩ C = ∅ (parallel)" etc. |
| `tangent` | payload drawn + note "tangent" |
| `not_analytic` | `note` "no closed form — try intersect_marching" |
| unknown tag | `note` with the raw tag + warning badge |

Note text uses the operands' labels when `add` can infer them (the result
label prefix, e.g. `P`) and falls back to the tag otherwise.

### 3.5 Runs, identity, and the server

- **Server discovery.** On first send, `Viewer` calls `GET /api/health`. If
  nothing answers, it spawns a detached `python -m geomcore_viewer serve`
  (frontend from package data), waits for health (≤ 3 s), and opens the
  browser once. Later processes find the same server. `geomcore-viewer stop`
  (or `python -m geomcore_viewer stop`) shuts it down.
- **Runs.** Each `Viewer` instance gets a fresh run id. The first object of a
  new run replaces the scene unless `keep=True`. Inside one process all
  `add` calls share that run, so they accumulate.
- **Identity.** Object id = `label` when given (re-adding the same label
  upserts in place — moves the "Newton iterate" point instead of piling up),
  else an auto id. Expanded results get `label₁`, `label₂`, ….
- **Default palette.** Colors cycle through a projector-safe palette
  (contrast-checked on light and dark backgrounds) unless `color=` is set.
- **Unreachable server.** `add` warns once (`warnings.warn`) and keeps
  buffering; `save()` still works and a later successful send flushes the
  buffer. No bare `except OSError: pass`.
- **Default view.** `view="auto"`: 2D if every object lies in z = 0
  (within 1e-9, using frames/points), else 3D. The page also has a toggle.
- **Default surface windows.** Infinite directions (plane u/v, cylinder and
  cone v) default to the bounding box of the scene's finite objects × 1.5,
  or ±5 when there are none. Override with `u=(…)`, `v=(…)`.

## 4. Protocol v2 (`protocol/SCENE.md`)

### 4.1 Document

```json
{
  "version": 2,
  "title": "Ellipse ∩ circle",
  "run": "a1b2c3",
  "view": "auto",
  "objects": [
    {
      "id": "E", "label": "E", "group": "conics", "source": "Ellipse3D",
      "geom": {
        "type": "ellipse",
        "frame": {"o": [0,0,0], "x": [1,0,0], "y": [0,1,0], "z": [0,0,1]},
        "a": 3, "b": 2
      },
      "style": {"color": "#d1495b", "width": 3, "dashed": false, "opacity": 1},
      "extras": {"foci": true},
      "meta": {}
    }
  ]
}
```

- `id` required, unique, stable across updates. `label`, `group`, `style`,
  `extras`, `meta`, `source` optional.
- `frame` always carries all three unit axes (right-handed, orthonormal).
- Curves may carry `range: [t0, t1]`. Without it: closed curves draw one
  full period; open curves are infinite and the viewer clips to the view.
- Surfaces carry `window: {"u": [a,b], "v": [a,b]}`; required for every
  infinite direction, optional otherwise (defaults to the full period).

### 4.2 Geometry types

| `type` | Fields | Parametrization (identical to geomcore) |
|---|---|---|
| `line` | `o`, `d` | `o + t·d` |
| `circle` | `frame`, `r` | `o + r cos t·x + r sin t·y` |
| `ellipse` | `frame`, `a`, `b` | `o + a cos t·x + b sin t·y` |
| `parabola` | `frame`, `f` | `o + (t²/4f)·x + t·y` (o = apex) |
| `hyperbola` | `frame`, `a`, `b` | `o + a cosh t·x + b sinh t·y` (one branch) |
| `bspline_curve` | `degree`, `poles`, `weights?`, `knots` (flat), `periodic` | de Boor / rational |
| `polyline` | `points` (2D or 3D) | as given |
| `plane` | `frame` | `o + u·x + v·y` |
| `cylinder` | `frame`, `r` | `o + r cos u·x + r sin u·y + v·z` |
| `cone` | `frame`, `semi_angle`, `ref_radius` | `R = ref_radius + v sin φ`; `o + R cos u·x + R sin u·y + v cos φ·z` |
| `sphere` | `frame`, `r` | `o + r cos v cos u·x + r cos v sin u·y + r sin v·z` |
| `torus` | `frame`, `R`, `r` | `ρ = R + r cos v`; `o + ρ cos u·x + ρ sin u·y + r sin v·z` |
| `bspline_surface` | `degree_u/v`, `poles` (grid), `weights?`, `knots_u/v`, `periodic_u/v` | tensor de Boor |
| `mesh` | `vertices`, `indices` | as given |
| `point` | `p` | — |
| `points` | `positions`, `size?` | — |
| `arrow` | `at`, `vec` | — |
| `text` | `at`, `text` | — |
| `pcurve` | `surface` (object id), `curve` (a 2D `line`/`circle`/`polyline` in (u,v)) | drawn in the (u,v) pane; lifted to 3D via the surface |
| `note` | `text`, `level?` (`info`/`warn`) | panel only |

2D curve variants (`line`/`circle` with 2-component `o`/`d`) are accepted
for pcurves and Line2D/Circle2D.

`extras` (curves): `foci`, `center`, `axes`, `asymptotes`, `directrix`,
`vertex`. (surfaces): `isolines: [nu, nv]`, `wire`. Unknown extras are
ignored.

### 4.3 Conventions shared with geomcore

The table in §4.2 is normative and copied from geomcore's rustdoc. The
frontend evaluators are tested against geomcore's golden fixtures
(`tests/fixtures/curves_analytic.json`, `surfaces_analytic.json`,
`curves_bspline.json`, `surfaces_bspline.json`) — vendored into
`frontend/test/fixtures/` with a script to refresh them — at 1e-9.

### 4.4 Server API

| Method | Path | Body | Effect |
|---|---|---|---|
| `GET` | `/api/health` | — | `{"app": "geomcore-viewer", "protocol": 2}` |
| `GET` | `/api/scene` | — | full document |
| `POST` | `/api/objects` | `{"run", "keep", "title?", "view?", "objects": [...]}` | upsert; new `run` without `keep` → clear first |
| `DELETE` | `/api/objects/{id}` | — | remove |
| `POST` | `/api/clear` | — | empty scene |
| `POST` | `/api/shutdown` | — | stop server (used by `stop`) |
| `GET` | `/events` | — | SSE: `run`, `upsert` (list), `remove`, `clear` |

Server stays stdlib-only, binds 127.0.0.1, and validates only shape (`id`
present, `geom.type` a string); geometric validity is the viewer's job.

### 4.5 Compatibility and forward-compatibility

- v1 documents load: `curve3d`/`curve2d` → `polyline`, `surface` → `mesh`,
  `points3d`/`points2d` → `points`.
- Unknown `geom.type` → panel warning badge, object skipped.
- Major-version mismatch → loud banner, nothing drawn.
- Evaluators live behind one `evaluate(geom, t)` / `evaluate(geom, u, v)`
  module so a WASM-backed implementation could replace them later.

## 5. Frontend

### 5.1 Layout

```
┌────────────────────────────────────────────── header: title · live · run 3 · 12 objects · [2D|3D] ─┐
│                                                        │ panel                                    │
│            main view (2D plane or 3D)                  │  ▾ conics   ■ E ellipse   ☑              │
│                                                        │             ■ C circle    ☑              │
│                                    ┌─────────────────┐ │  ▾ result   ● P₁ (1.84, 1.62)            │
│                                    │ (u,v) pane      │ │             ● P₂ (…)                     │
│                                    │ (when relevant) │ │  ⓘ E ∩ L = ∅ (parallel)                  │
│                                    └─────────────────┘ │  ⚠ unknown type "foo"                    │
└────────────────────────────────────────────────────────┴──────────────────────────────────────────┘
```

- Panel: objects grouped by `group`, color swatch, label, type, visibility
  checkbox (per object and per group), notes and badges. Click an object →
  highlight + frame it.
- Keys: `F` fit, `P` presentation mode (chrome hidden, ×1.5 line widths and
  fonts), `T` light/dark (light default), `2`/`3` switch view, `U` toggle
  (u,v) pane.
- Run swap: on `run`, keep rendering the old scene until the first `upsert`
  of the new run, then replace; camera, view mode, and per-group visibility
  survive (matched by group name / object id).

### 5.2 2D plane view (PixiJS + HTML overlay)

- Cartesian plane: adaptive 1-2-5 grid (major/minor), axes through origin,
  tick labels, aspect ratio locked 1:1, y up.
- Curves re-tessellated on every view change in screen space (chord error
  ≤ 0.25 px, max segments capped); infinite curves clipped to viewport +
  10 % margin by solving the parameter interval inside the view box
  (closed-form for line/parabola/hyperbola).
- Constant pixel line widths (fixes v1, where stroke width froze at the
  creation-time zoom).
- Points: filled dot + label "P₁ (1.84, 1.62)" (3 decimals, coordinates
  from the protocol, never recomputed); greedy label placement to avoid
  overlaps.
- Extras derived from analytic parameters: foci, center, principal axes,
  asymptotes, directrix, vertex — dashed, same color, lighter.
- Hover: nearest object within 8 px highlighted; tooltip shows type, label,
  `t`, `(x, y)`. Click a point → copy coordinates.
- Labels/text as DOM overlay positioned from world→screen transform (crisp
  at any zoom, selectable).

### 5.3 3D view (Babylon)

- ArcRotate camera; perspective/orthographic toggle; snap views (top / front
  / right / iso). Top view of a planar scene matches the 2D view.
- Ground grid on z = 0 + labeled axis triad (z up, matching geomcore).
- Curves as screen-space-width lines (`GreasedLine`), default 3 px;
  infinite curves clipped to scene bounding box × 1.5.
- Analytic surfaces tessellated on their window with curvature-based
  density; default opacity 0.45 when curves are present, else 1; optional
  u/v isolines (`isolines` extra) and wireframe.
- Points as screen-size markers; labels as projected DOM overlay, always
  shown (no occlusion test in v2).
- Picking: surface → `(u, v)` + point (inverse by mesh vertex param
  interpolation); curve → `t` + point.

### 5.4 Linked (u,v) pane

- Appears when the scene contains a `pcurve` or when a surface is selected.
- Shows the surface's (u,v) window with periodic seams marked, and every
  pcurve on that surface.
- Hover in either pane shows the corresponding point in the other (pcurve
  `(u,v)` ↔ surface `S(u,v)`).

### 5.5 Module structure

```
frontend/src/
  protocol.ts        types + v1→v2 migration + validation
  geom/              evaluate(), derived features, view clipping, tessellation
    curves.ts  surfaces.ts  bspline.ts  extras.ts  clip.ts  tessellate.ts
  store.ts           scene state, run swap, SSE/static loading
  ui/                header.ts  panel.ts  keys.ts  labels.ts (DOM overlay)  theme.ts
  view2d/            plane.ts (grid/axes)  render.ts  pick.ts
  view3d/            scene.ts  render.ts  pick.ts
  viewuv/            pane.ts
  main.ts
```

`geom/` has no rendering dependency and is the unit-tested core.

## 6. Packaging

- `python/` wheel includes the built `frontend/dist` as package data
  (`geomcore_viewer/_frontend/`); `serve` defaults to it. CI builds the
  frontend before building the wheel.
- Vite builds with a relative base (`./`) so the same bundle works on
  GitHub Pages and from the local server; drop the `/geomcore-viewer` path
  strip in `server.py`.
- Console entry point `geomcore-viewer` with `serve` / `stop` subcommands.

## 7. Rust client (phase 4)

`clients/rust` gains v2 types (`Geom` enum mirroring §4.2, `Object`,
`Style`), `Viewer::add`, run ids, and conversions from `geomcore` types
behind an optional `geomcore` cargo feature. Same discovery semantics as
Python (health check; spawning is Python-only — Rust prints how to start
the server).

## 8. Phases

1. **Foundation** — protocol v2 doc, server v2 (health, objects, runs,
   shutdown, SSE events), Python `Viewer`/`add`/`Handle`/module-level API,
   adapter + frame recovery + intersection mapping, background server spawn,
   frontend in wheel, frontend store/protocol v2 with v1 migration and the
   existing views drawing v2 objects via evaluators (minimal rendering).
2. **2D plane view** — §5.2 + panel/header/keys/presentation mode/theme.
3. **3D view upgrade + (u,v) pane** — §5.3, §5.4.
4. **Rust client v2** — §7.

Each phase ends with the docs (`README.md`, `protocol/SCENE.md`, geomcore
`docs/viewer.md` example) updated and `examples/` scripts that exercise it:
`conics_2d.py` (ellipse/circle/hyperbola/line intersections),
`quadrics_3d.py` (sphere ∩ cylinder, plane ∩ cone), `pcurve.py`
(circle on cylinder with linked (u,v)).

## 9. Testing

| Layer | Tooling | What |
|---|---|---|
| `frontend/src/geom` | vitest | evaluators vs geomcore golden fixtures (1e-9); clipping of infinite curves; tessellation error bound; derived extras (foci, asymptotes) vs closed form |
| protocol | vitest | v1→v2 migration; validation errors produce badges |
| Python adapter | pytest | frame recovery and intersection mapping against real geomcore (skipped if not installed) and fake duck-typed objects; label/id/upsert semantics; unreachable-server buffering |
| server | pytest | health, objects upsert, run replacement vs `keep`, delete, clear, SSE event sequence, shutdown |
| end-to-end | Playwright | the three example scenes render (screenshot smoke); run swap keeps camera; 2D zoom-out keeps a line spanning the viewport |

CI runs all of the above plus the frontend build and wheel build.

## 10. Risks

- **Evaluator drift from geomcore conventions** — mitigated by vendored
  golden fixtures and frame-recovery cross-checks.
- **Frame recovery depends on parametrization conventions** — a geomcore
  convention change breaks it loudly (cross-check raises), and the upstream
  `frame()` getter removes the dependency.
- **Detached server lifecycle** (orphaned process, port taken by something
  else) — health check verifies `app == "geomcore-viewer"`; a foreign
  listener on the port raises a clear error suggesting `url=`.
- **GreasedLine / Pixi performance with many re-tessellations** — cap
  segments per curve; re-tessellate only on view change (debounced to one
  per animation frame).
