# geomcore-viewer

A live, geometry-aware browser viewer for [geomcore](https://github.com/GabrielJMS/geomcore).
Write geomcore code, call `view.add(...)`, and the curves, surfaces and
intersection points appear — exactly, not as hand-sampled polylines — in a
browser tab that updates as your script, debugger or notebook runs.

```python
# conics.py — run with: python conics.py   (re-run after every edit)
from geomcore import Frame3D, Point3D, Vector3D
from geomcore.curves import Circle3D, Ellipse3D
import geomcore_viewer as gv

view = gv.Viewer("Ellipse ∩ circle")
E = Ellipse3D.from_frame(Frame3D.world(), 3.0, 2.0)
C = Circle3D(Point3D(2, 1, 0), Vector3D.z(), 1.5)

view.add(E, label="E")
view.add(C, label="C")
view.add(C.intersect_ellipse(E), label="P")   # → P₁, P₂
```

- **One verb.** `add` takes geomcore curves, surfaces and points, intersection
  results as returned (`("points", …)`, `("two_circles", …)`, `("empty", None)` →
  a note "P: ∅"), and lists of those.
- **Live, incremental.** The first `add` starts a background server and opens
  the tab; later runs reuse it. Re-running a script swaps the scene in place;
  inside one process (`pdb`, IPython, Jupyter) every `gv.add(x)` lands in the
  same scene. Re-adding a label updates that object instead of duplicating it.
- **Exact.** Objects travel as analytic definitions (frame + radii); the
  viewer evaluates them with geomcore's own parametrizations, so lines,
  parabolas and hyperbolas reach the edge of the view.
- **Static too.** `view.save("scene.json")`, then open the hosted viewer with
  `?scene=<url>` or drag-drop the file onto it.

## Install

```sh
pip install geomcore-viewer        # stdlib only; the built viewer ships in the wheel
```

The viewer itself has no dependencies, but the quick-start above and the scripts in
`examples/` build their objects with geomcore: `pip install geomcore`, or, from a
source checkout, `PYTHONPATH=../geomcore/geomcore-py` (add `python` when running
from this repo, as in the Development section).

## API

| Call | Does |
|---|---|
| `gv.Viewer(title, view="auto"\|"2d"\|"3d", keep=False)` | a scene (new run) |
| `view.add(*objs, label=, group=, color=, width=, dashed=, opacity=, u=, v=, foci=, asymptotes=, …)` | show objects → `Handle` / list |
| `handle.update(color=…)`, `handle.remove()` | change or remove one object |
| `view.polyline(pts)`, `view.mesh(v, i)`, `view.arrow(at, vec)`, `view.text(at, s)` | raw geometry |
| `view.clear()`, `view.save(path)`, `view.open()` | housekeeping |
| `gv.add(...)`, `gv.clear()` | same, on the most recent viewer (handy in `pdb`) |
| `geomcore-viewer serve` / `geomcore-viewer stop` | run / stop the server by hand |

The server listens on `http://127.0.0.1:8765` by default. If that port is
busy, set `GEOMCORE_VIEWER_URL=http://127.0.0.1:<other port>` (every script
and `gv.add` picks it up; a started server listens on that port) or pass
`gv.Viewer(url=...)`. An explicit `url=` wins over the variable. A blank
variable counts as unset. `geomcore-viewer serve` and `stop` take their default
port from the same variable; `--port` overrides it.

## Layout

| Path | What |
|---|---|
| `protocol/SCENE.md` | protocol v2: the JSON every client and the viewer speak |
| `python/geomcore_viewer/` | client (`viewer.py`), geomcore adapter (`adapt.py`), server (`server.py`, `spawn.py`) |
| `frontend/` | Vite + TypeScript viewer (Babylon.js 3D, PixiJS 2D); `src/geom/` is the evaluator core |
| `clients/rust/` | Rust client (protocol v1 until phase 4 of the v2 plan) |
| `examples/` | `conics_2d.py`, `quadrics_3d.py` |

## Development

```sh
python3 -m venv .venv && .venv/bin/pip install pytest
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests -q
cd frontend && npm ci && npm test && npm run build && cd ..
scripts/bundle-frontend.sh          # copy the build into the Python package
scripts/refresh-fixtures.sh         # re-vendor geomcore's golden fixtures
```

## Live demo

<https://gabrieljms.github.io/geomcore-viewer/> — the bundled sample scene.

## License

Dual-licensed under MIT or Apache-2.0, at your option — same as `geomcore`.
