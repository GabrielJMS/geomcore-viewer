# Scene protocol (v2)

One JSON document spoken by the Python and Rust clients, the local server,
and the browser viewer. Clients send **analytic definitions** — the same
parameters geomcore stores — and the viewer evaluates them for display.
The viewer never computes intersections or any other geometric query.

## Document

```json
{
  "version": 2,
  "title": "Ellipse ∩ circle",
  "run": "a1b2c3d4e5f6",
  "view": "auto",
  "objects": [
    {
      "id": "E", "label": "E", "group": "conics", "source": "Ellipse3D",
      "geom": {
        "type": "ellipse",
        "frame": {"o": [0, 0, 0], "x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]},
        "a": 3, "b": 2
      },
      "style": {"color": "#d1495b", "width": 3, "dashed": false, "opacity": 1},
      "extras": {"foci": true}
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | unique, stable across updates; re-sending an `id` replaces the object |
| `geom` | yes | geometry, `geom.type` selects the shape (table below) |
| `label` | no | display name (panel, point labels) |
| `group` | no | panel grouping / visibility toggle |
| `source` | no | client-side type name, e.g. `Ellipse3D` |
| `style` | no | `color` (CSS), `width` (px), `dashed`, `opacity` (0–1) |
| `extras` | no | curves: `foci`, `center`, `axes`, `asymptotes`, `directrix`, `vertex`; surfaces: `isolines: [nu, nv]`, `wire`. Unknown extras are ignored. |
| `meta` | no | free-form client data |

`view` is `"auto"`, `"2d"` or `"3d"`. Vectors are `[x, y, z]`; a
2-component vector is read as `[x, y, 0]`. Every `frame` carries all three
unit axes `o, x, y, z` (right-handed, orthonormal).

## Geometry types

| `type` | Fields | Parametrization (identical to geomcore) |
|---|---|---|
| `line` | `o`, `d` | `o + t·d` |
| `circle` | `frame`, `r` | `o + r cos t·x + r sin t·y` |
| `ellipse` | `frame`, `a`, `b` | `o + a cos t·x + b sin t·y` |
| `parabola` | `frame`, `f` | `o + (t²/4f)·x + t·y` (o = apex) |
| `hyperbola` | `frame`, `a`, `b` | `o + a cosh t·x + b sinh t·y` (one branch) |
| `polyline` | `points` | as given |
| `plane` | `frame` | `o + u·x + v·y` |
| `cylinder` | `frame`, `r` | `o + r cos u·x + r sin u·y + v·z` |
| `cone` | `frame`, `semi_angle`, `ref_radius` | `R = ref_radius + v sin φ`; `o + R cos u·x + R sin u·y + v cos φ·z` |
| `sphere` | `frame`, `r` | `o + r cos v cos u·x + r cos v sin u·y + r sin v·z` |
| `torus` | `frame`, `R`, `r` | `ρ = R + r cos v`; `o + ρ cos u·x + ρ sin u·y + r sin v·z` |
| `mesh` | `vertices`, `indices` | triangles; `indices.length % 3 == 0` |
| `point` | `p` | — |
| `points` | `positions`, `size?` | point cloud |
| `arrow` | `at`, `vec` | — |
| `text` | `at`, `text` | — |
| `note` | `text`, `level?` (`info` / `warn`) | panel only, e.g. `P: ∅ (parallel)` |

Reserved for when geomcore exposes B-spline getters (clients send
`polyline` / `mesh` until then): `bspline_curve`, `bspline_surface`,
`pcurve`.

Radii (`r`, `a`, `b`, `R`) must be positive and `f` non-zero.

### Ranges and windows

- Curves may carry `range: [t0, t1]`. Without it, `circle`/`ellipse` draw
  one full period; `line`/`parabola`/`hyperbola` are infinite and the
  viewer draws the part that crosses the visible region.
- Surfaces carry `window: {"u": [a, b], "v": [a, b]}`. Closed directions
  default to their full period (`cylinder`/`cone` u, `sphere` u and
  v ∈ [-π/2, π/2], `torus` u and v); infinite directions (`plane` u/v,
  `cylinder`/`cone` v) should always be given — the viewer falls back to
  ±5 and flags the object.

## Runs

Every client session has a `run` id. When the server receives objects with
a `run` it has not seen, it empties the scene first (unless `keep: true`)
and broadcasts a `run` event. The page keeps showing the previous picture
until the first `upsert` of the new run, then swaps — so re-running a
script never flashes an empty view, and the camera stays where it was.

## Local server API

| Method | Path | Body | Effect |
|---|---|---|---|
| `GET` | `/api/health` | — | `{"app": "geomcore-viewer", "protocol": 2}` |
| `GET` | `/api/scene` | — | full document |
| `POST` | `/api/objects` | `{"run"?, "keep"?, "title"?, "view"?, "objects": [...]}` | upsert by `id` |
| `DELETE` | `/api/objects/{id}` | — | remove (404 if absent) |
| `POST` | `/api/clear` | — | empty scene |
| `POST` | `/api/shutdown` | — | stop the server |
| `POST` | `/api/add` | one v1 entity | v1 clients (kept until the Rust client speaks v2) |
| `GET` | `/events` | — | SSE: `run`, `upsert`, `remove`, `clear` |

Every `POST` must send `Content-Type: application/json` (anything else
gets `415`). Any website can make a browser call `127.0.0.1`, so the server
only answers requests from itself: the `Host` header must be
`127.0.0.1:<port>` or `localhost:<port>`, and an `Origin` header, when
present, must be `http://127.0.0.1:<port>` or `http://localhost:<port>`;
otherwise `403`. It sends no CORS headers and answers no preflight, so other
origins can neither read nor write. Non-browser clients (Python, Rust, curl)
send no `Origin`; they just need the JSON content type and a `Host` with the
port.

The server binds `127.0.0.1`, is stdlib-only, and validates shape only
(`id` string, `geom.type` string); geometric validity is checked by the
viewer, which lists rejected objects in its panel.

## Compatibility

- v1 documents (`"version": 1`, `entities`) still load: `curve3d`/`curve2d`
  → `polyline`, `surface` → `mesh` (with `opacity`), `points3d`/`points2d`
  → `points`, `name` → `label`, `color` → `style.color`.
- Unknown `geom.type` → the object is skipped and listed as a problem.
- Any other `version` → nothing is drawn and the page says why.

Static fallbacks, in priority order: `?scene=<url>`, a live local server,
a drag-dropped `.json` file, the bundled `sample-scene.json`.
