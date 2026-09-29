# geomcore-viewer

Browser viewer for [geomcore](https://github.com/GabrielJMS/geomcore) — parametric curves and surfaces, visualized live from Rust **and** Python through one shared protocol.

- **3D pane:** Babylon.js — `Curve3D` as line systems, `Surface` as triangulated meshes, point clouds.
- **2D pane:** PixiJS (WebGL) — `Curve2D` / curve-on-surface parameter-space plots, built to hold millions of points where Canvas2D (`plot_data`-style) falls over.
- **Live updates:** clients `POST` entities to a tiny local server; the page listens over SSE and appends to the scene incrementally. No websocket library needed anywhere.
- **Static-friendly:** the same page loads `sample-scene.json`, `?scene=<url>`, or a drag-dropped file — that's what gets embedded in the docs.

## Layout

| Path | What |
|---|---|
| `protocol/SCENE.md` | The scene JSON schema both clients speak |
| `frontend/` | Vite + TypeScript app (Babylon 3D + PixiJS 2D), deployed to GitHub Pages |
| `python/geomcore_viewer/` | Stdlib-only Python client: `Viewer`, sampling helpers, local server |
| `clients/rust/` | Dependency-light Rust client (`serde_json` only, HTTP over `std`) |

## Quick start (Python)

```python
from geomcore_viewer import Viewer
import math

viewer = Viewer()  # serves frontend locally, opens browser
viewer.add_curve3d("circle", [(2 * math.cos(t), 2 * math.sin(t), 0.0) for t in frange(0, 2 * math.pi, 128)])
viewer.add_points2d("samples", [...])
```

With real `geomcore` objects, sampling helpers accept any callable, so
`circle.eval_point`-style APIs plug in directly — see `python/geomcore_viewer/sampling.py`.

## Quick start (Rust)

```rust
let viewer = geomcore_viewer::Viewer::new("http://localhost:8765")?;
viewer.add_curve3d("circle", &sampled_points)?;
```

## Live demo

<https://gabrieljms.github.io/geomcore-viewer/> — bundled `sample-scene.json`
(circle coaxial with a cylinder, plus its 2D p-curve image).

## License

Dual-licensed under MIT or Apache-2.0, at your option — same as `geomcore`.
