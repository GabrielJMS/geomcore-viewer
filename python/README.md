# geomcore-viewer

A live, geometry-aware browser viewer for [geomcore](https://github.com/geomcore/geomcore).
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
  viewer evaluates them with geomcore's own parametrizations. The plane view
  clips lines, parabolas and hyperbolas to the window in closed form, so they
  run edge to edge at any zoom; the 3D view draws them across 1.5× the
  scene's extent.
- **Static too.** `view.save("scene.json")`, then open the hosted viewer with
  `?scene=<url>` or drag-drop the file onto it.

## Install

```sh
pip install geomcore-viewer        # stdlib only; the built viewer ships in the wheel
pip install geomcore               # to build the objects you show
```

## API

| Call | Does |
|---|---|
| `gv.Viewer(title, view="auto"\|"2d"\|"3d", keep=False)` | a scene (new run) |
| `view.add(*objs, label=, group=, color=, width=, dashed=, opacity=, u=, v=, foci=, asymptotes=, …)` | show objects → `Handle` / list |
| `handle.update(color=…)`, `handle.remove()` | change or remove one object |
| `view.pcurve(curve, on=surface)` | a `Line2D`, `Circle2D` (e.g. `circle.parametrize_on(cyl)`) or `(u, v)` pairs drawn on a surface already added |
| `view.polyline(pts)`, `view.mesh(v, i)`, `view.arrow(at, vec)`, `view.text(at, s)` | raw geometry |
| `view.clear()`, `view.save(path)`, `view.open()` | housekeeping |
| `gv.add(...)`, `gv.clear()` | same, on the most recent viewer (handy in `pdb`) |
| `geomcore-viewer serve` / `geomcore-viewer stop` | run / stop the server by hand |

The server listens on `http://127.0.0.1:8765` by default; set
`GEOMCORE_VIEWER_URL` to use another port. The full guide (remote machines over
SSH, the plane and 3D views, the (u, v) pane, the scene protocol and the Rust
client) is in the [repository README](https://github.com/geomcore/geomcore-viewer#readme).

Licensed under either of MIT or Apache-2.0, at your option.
