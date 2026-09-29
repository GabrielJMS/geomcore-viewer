# Scene protocol (v1)

One JSON document both the Rust and Python clients speak. Transport is
either a file (`scene.json`) or the local server API below.

## Document

```json
{
  "version": 1,
  "entities": [
        {"id": "circle", "kind": "curve3d", "color": "#ff5533", "points": [[2.0, 0.0, 0.0], "..."]},
        {"id": "pcurve", "kind": "curve2d", "points": [[0.0, 1.0], "..."]},
        {"id": "cyl", "kind": "surface", "vertices": [[...]], "indices": [0, 1, 2]},
        {"id": "cloud", "kind": "points3d", "positions": [[...]]}
      ]
}
```

### Entity kinds

| kind | 3D pane | 2D pane | payload |
|---|---|---|---|
| `curve3d` | Babylon `LineSystem` | — | `points: [x, y, z][]` (polyline, ≥ 2) |
| `curve2d` | — | PixiJS polyline | `points: [u, v][]` (polyline, ≥ 2) |
| `surface` | Babylon mesh | — | `vertices: [x,y,z][]`, `indices: number[]` (triangles) |
| `points3d` | Babylon point cloud | — | `positions: [x,y,z][]`, optional `size` |
| `points2d` | — | PixiJS points | `positions: [u,v][]`, optional `size` |

Common optional fields: `id` (string, stable across updates — resending an
existing `id` replaces the entity), `name`, `color` (CSS color string).

### Rules

- Coordinates are plain JSON numbers, SI-ish units as produced by `geomcore`
  sampling; the viewer auto-frames per pane.
- `surface.indices` length must be a multiple of 3.
- Unknown `kind` values must be ignored (forward compatibility).
- `version` is `1` for now; readers reject major mismatches loudly.

## Local server API (for live updates)

Started by either client (`python -m geomcore_viewer serve`,
`Viewer::serve()` spawns the same). Static hosting (GitHub Pages) skips
the server and loads a document instead.

| Method | Path | Body | Effect |
|---|---|---|---|
| `GET` | `/api/scene` | — | Full document |
| `POST` | `/api/add` | One entity object | Upsert by `id`, broadcast to SSE |
| `POST` | `/api/clear` | — | Empty scene, broadcast |
| `GET` | `/events` | — | SSE stream, events `upsert` / `clear` with entity/scene JSON |

Static fallbacks, in priority order: `?scene=<url>` query param,
drag-dropped `.json` file, bundled `sample-scene.json`.
