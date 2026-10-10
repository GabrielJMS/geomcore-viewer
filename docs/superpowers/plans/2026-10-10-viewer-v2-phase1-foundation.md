# geomcore-viewer v2 — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 polyline-dump viewer with protocol v2: geomcore objects go in through `view.add(obj)` / `gv.add(obj)`, travel as analytic definitions, and the existing 3D/2D panes draw them exactly via TypeScript evaluators — served by a background server that outlives the script and ships with the wheel.

**Architecture:** Python side = `adapt.py` (geomcore object / intersection result → protocol geometry, frame recovery with cross-check), `viewer.py` (runs, labels, buffering, module-level API), `spawn.py` (find-or-start the detached server), `server.py` (stdlib HTTP + SSE, protocol v2). Frontend side = `geom/` (pure evaluators, ranges, tessellation, bounds — unit-tested against geomcore golden fixtures), `protocol.ts` (validation + v1 migration), `store.ts` (run-swap state machine), views + a minimal panel. Phases 2–4 (2D plane view, 3D upgrade + (u,v) pane, Rust client) get their own plans afterwards.

**Tech Stack:** Python ≥ 3.9 stdlib only (pytest for tests); TypeScript + Vite 6, Babylon.js 8, PixiJS 8, vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-10-viewer-v2-design.md` — read §3 (Python API), §4 (protocol), §6 (packaging) before starting any task.

## Global Constraints

- `geomcore_viewer` has **zero runtime dependencies** (stdlib only) and **never imports `geomcore`** — dispatch is by class name + duck typing.
- `requires-python = ">=3.9"`; every Python module starts with `from __future__ import annotations`.
- Protocol: document `"version": 2`; health `{"app": "geomcore-viewer", "protocol": 2}`; default URL `http://127.0.0.1:8765`; server binds `127.0.0.1` only.
- Parametrizations (normative, identical to geomcore): line `o + t·d`; circle `o + r cos t·x + r sin t·y`; ellipse `o + a cos t·x + b sin t·y`; parabola `o + (t²/4f)·x + t·y`; hyperbola `o + a cosh t·x + b sinh t·y`; plane `o + u·x + v·y`; cylinder `o + r cos u·x + r sin u·y + v·z`; cone `R = ref_radius + v sin φ`, `o + R cos u·x + R sin u·y + v cos φ·z`; sphere `o + r cos v cos u·x + r cos v sin u·y + r sin v·z`; torus `ρ = R + r cos v`, `o + ρ cos u·x + ρ sin u·y + r sin v·z`.
- Frame recovery cross-check tolerance: `1e-9 · max(1, |P|)`; frontend evaluator vs. golden fixtures: same tolerance.
- The viewer never computes intersections or other geometric queries — geomcore is the only source of truth.
- No silent failures: no bare `except …: pass`; unreachable server → one `RuntimeWarning`; malformed objects → panel problem rows.
- Labels and notes are rendered with `textContent`, never `innerHTML`.
- Commit after every task, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Deliberate deviations from the spec (Phase 1):**
- `bspline_curve` / `bspline_surface` are documented as *reserved* in `SCENE.md` and not evaluated by the frontend: geomcore-py exposes no pole/knot getters, so the adapter always sends B-splines as `polyline` / `mesh` (spec §3.3 fallback path). `BSplineSurface` has no domain getter either, so `add` requires `u=`/`v=` for it.
- "Scene bounding box × 1.5" for default infinite-surface windows (spec §3.5) is computed as **1.5 × the farthest finite feature from the origin** (fallback 5) — a symmetric window the surface's own parameters can use directly.
- Auto view (`view="auto"` → 2D vs 3D) is resolved by the frontend in Phase 2; in Phase 1 both panes stay: 3D shows everything, the 2D pane shows objects lying in z = 0.

## Review Focus

1. **An older (v1) geomcore-viewer is still running on port 8765** — `Viewer().add(...)` must fail with a message saying the port is held by something that is not a geomcore-viewer v2 server and how to fix it, not hang or spawn a second server. (Test: Task 3 `test_foreign_listener_is_reported`.)
2. **A computation produced NaN/inf** (e.g. degenerate input) — `add` must raise `ValueError` naming the object, not send invalid JSON that the browser silently drops. (Test: Task 4 `test_nan_geometry_is_rejected`.)
3. **Labels with non-ASCII or URL-special characters** (`P₁`, `a/b c`) — `handle.remove()` / re-adding must work. (Test: Task 4 `test_remove_label_with_special_characters`.)
4. **Escape hatches fed tuples, generators, or numpy-like sequences** — `polyline`, `mesh`, `arrow`, `text` must coerce to plain floats/ints. (Test: Task 4 `test_escape_hatches_coerce_inputs`.)
5. **`?scene=<url>` that 404s or isn't JSON** on the static site — status must say what failed instead of staying on "loading". (Test: Task 7 `loadUrl reports HTTP failures`.)

---

## Before you start (controller)

```bash
cd /home/gabriel/Documentos/open_source/geomcore-viewer
git switch -c viewer-v2
# Preserve the user's pre-v2 WIP (surface opacity, Pages base strip) as its own commit; v2 supersedes both.
git add frontend/src/protocol.ts frontend/src/view3d.ts protocol/SCENE.md python/geomcore_viewer/server.py python/geomcore_viewer/viewer.py
git commit -m "viewer: surface opacity + Pages base-path strip (pre-v2 WIP)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
python3 -m venv .venv && .venv/bin/pip install -q pytest
```

`.venv/` is already in `.gitignore`. All Python test commands below run from the repo root:

```bash
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests -q
```

`../geomcore/geomcore-py` holds a built `geomcore` extension; tests that need real geomcore use `pytest.importorskip("geomcore")` and are skipped in CI.

---

### Task 1: Protocol v2 document + server v2

**Files:**
- Rewrite: `protocol/SCENE.md`
- Rewrite: `python/geomcore_viewer/server.py`
- Create: `python/tests/test_server.py`
- Delete: `python/tests/test_viewer.py` (v1 API tests; Task 4 writes the new one, Task 2 moves the sampling tests)

**Interfaces:**
- Produces (Python, `geomcore_viewer.server`): `APP = "geomcore-viewer"`, `PROTOCOL = 2`, `DEFAULT_PORT = 8765`, `default_frontend_dir() -> Path`, `class Server(frontend_dir: str | Path | None = None, port: int = DEFAULT_PORT)` with `.url`, `.port`, `.state`, `.httpd`, `.start() -> Server`, `.stop()`, context manager.
- Produces (HTTP): `GET /api/health`, `GET /api/scene`, `POST /api/objects` body `{"run"?, "keep"?, "title"?, "view"?, "objects": [...]}`, `DELETE /api/objects/{id}` (404 if absent), `POST /api/clear`, `POST /api/shutdown`, `POST /api/add` (v1 entity, compat), `GET /events` SSE with `data: {"type": "run"|"upsert"|"remove"|"clear", ...}` lines; first line `: connected`, keep-alive `: ping` every 15 s.
- SSE payloads: `{"type": "run", "run": str, "keep": bool}`, `{"type": "upsert", "objects": [...], "title": str, "view": str}`, `{"type": "remove", "id": str}`, `{"type": "clear"}`.

- [ ] **Step 1: Write `protocol/SCENE.md` (the contract every later task follows)**

Replace the whole file with:

````markdown
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
````

- [ ] **Step 2: Write the failing server tests**

Create `python/tests/test_server.py`:

```python
import http.client
import json
import threading
import urllib.error
import urllib.request

import pytest

from geomcore_viewer.server import APP, PROTOCOL, Server


def _obj(object_id, **geom):
    return {"id": object_id, "geom": {"type": "point", "p": [0.0, 0.0, 0.0], **geom}}


def _get(url):
    with urllib.request.urlopen(url, timeout=5) as res:
        return json.loads(res.read())


def _send(url, body=None, method="POST", raw=None):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.loads(res.read())


@pytest.fixture
def server(tmp_path):
    (tmp_path / "index.html").write_text("<html>ok</html>")
    srv = Server(tmp_path, port=0).start()
    yield srv
    srv.stop()


def _ids(server):
    return [o["id"] for o in _get(f"{server.url}/api/scene")["objects"]]


def test_health(server):
    assert _get(f"{server.url}/api/health") == {"app": APP, "protocol": PROTOCOL}


def test_post_objects_upserts_by_id(server):
    url = f"{server.url}/api/objects"
    _send(url, {"objects": [_obj("a"), _obj("b")]})
    _send(url, {"objects": [_obj("a", p=[1.0, 2.0, 3.0])]})
    scene = _get(f"{server.url}/api/scene")
    assert scene["version"] == 2
    assert [o["id"] for o in scene["objects"]] == ["a", "b"]
    assert scene["objects"][0]["geom"]["p"] == [1.0, 2.0, 3.0]


def test_new_run_replaces_scene_unless_keep(server):
    url = f"{server.url}/api/objects"
    _send(url, {"run": "r1", "title": "first", "objects": [_obj("a")]})
    _send(url, {"run": "r2", "objects": [_obj("b")]})
    scene = _get(f"{server.url}/api/scene")
    assert [o["id"] for o in scene["objects"]] == ["b"]
    assert scene["run"] == "r2" and scene["title"] == ""
    _send(url, {"run": "r3", "keep": True, "objects": [_obj("c")]})
    assert _ids(server) == ["b", "c"]


def test_same_run_accumulates(server):
    url = f"{server.url}/api/objects"
    _send(url, {"run": "r1", "objects": [_obj("a")]})
    _send(url, {"run": "r1", "objects": [_obj("b")]})
    assert _ids(server) == ["a", "b"]


def test_delete_and_clear(server):
    _send(f"{server.url}/api/objects", {"objects": [_obj("a"), _obj("b/c ₁")]})
    _send(f"{server.url}/api/objects/a", method="DELETE")
    assert _ids(server) == ["b/c ₁"]
    _send(f"{server.url}/api/objects/b%2Fc%20%E2%82%81", method="DELETE")
    assert _ids(server) == []
    with pytest.raises(urllib.error.HTTPError) as err:
        _send(f"{server.url}/api/objects/missing", method="DELETE")
    assert err.value.code == 404
    _send(f"{server.url}/api/objects", {"objects": [_obj("a")]})
    _send(f"{server.url}/api/clear")
    assert _ids(server) == []


def test_rejects_malformed_bodies(server):
    url = f"{server.url}/api/objects"
    for body in ({"objects": [{"geom": {"type": "point"}}]}, {"objects": [{"id": "a"}]}, {"nope": 1}):
        with pytest.raises(urllib.error.HTTPError) as err:
            _send(url, body)
        assert err.value.code == 400
    with pytest.raises(urllib.error.HTTPError) as err:
        _send(url, raw=b"not json")
    assert err.value.code == 400


def test_v1_add_still_accepted(server):
    _send(f"{server.url}/api/add", {"id": "c", "kind": "curve3d", "points": [[0, 0, 0], [1, 0, 0]]})
    assert _get(f"{server.url}/api/scene")["objects"][0]["kind"] == "curve3d"


def test_sse_event_sequence(server):
    events = []
    ready = threading.Event()

    def listen():
        with urllib.request.urlopen(f"{server.url}/events", timeout=10) as res:
            for raw in res:
                line = raw.decode().strip()
                if line == ": connected":
                    ready.set()
                if line.startswith("data: "):
                    events.append(json.loads(line[len("data: "):]))
                    if len(events) == 4:
                        return

    t = threading.Thread(target=listen, daemon=True)
    t.start()
    assert ready.wait(5)
    _send(f"{server.url}/api/objects", {"run": "r1", "objects": [_obj("a")]})
    _send(f"{server.url}/api/objects/a", method="DELETE")
    _send(f"{server.url}/api/clear")
    t.join(5)
    assert [e["type"] for e in events] == ["run", "upsert", "remove", "clear"]
    assert events[0] == {"type": "run", "run": "r1", "keep": False}
    assert events[1]["objects"][0]["id"] == "a"


def test_static_files_placeholder_and_traversal(tmp_path):
    (tmp_path / "secret.txt").write_text("secret")
    dist = tmp_path / "dist"
    dist.mkdir()
    srv = Server(dist, port=0).start()
    try:
        with urllib.request.urlopen(f"{srv.url}/", timeout=5) as res:
            assert b"Frontend not built" in res.read()
        conn = http.client.HTTPConnection("127.0.0.1", srv.port, timeout=5)
        conn.request("GET", "/../secret.txt")
        assert conn.getresponse().status == 404
        (dist / "index.html").write_text("<html>built</html>")
        with urllib.request.urlopen(f"{srv.url}/", timeout=5) as res:
            assert res.read() == b"<html>built</html>"
    finally:
        srv.stop()


def test_shutdown_stops_server(tmp_path):
    srv = Server(tmp_path, port=0).start()
    _send(f"{srv.url}/api/shutdown")
    srv._thread.join(timeout=5)
    assert not srv._thread.is_alive()
    srv.stop()
```

Delete the v1 tests: `git rm python/tests/test_viewer.py`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_server.py -q`
Expected: FAIL — `ImportError: cannot import name 'APP'` (collection error).

- [ ] **Step 4: Rewrite `python/geomcore_viewer/server.py`**

```python
"""Local server: serves the built frontend, the scene API and SSE fan-out.

Stdlib only. Static hosting (GitHub Pages) skips this entirely and loads
a scene document instead — see protocol/SCENE.md (v2).
"""

from __future__ import annotations

import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

APP = "geomcore-viewer"
PROTOCOL = 2
DEFAULT_PORT = 8765
_KEEPALIVE_S = 15.0

_MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".wasm": "application/wasm",
}

_PLACEHOLDER = (
    b"<!doctype html><meta charset='utf-8'><title>geomcore-viewer</title>"
    b"<p>Frontend not built. Run <code>scripts/bundle-frontend.sh</code> "
    b"(or <code>npm run build</code> in <code>frontend/</code>).</p>"
)


def default_frontend_dir() -> Path:
    """The build bundled in the wheel, else a source checkout's ``frontend/dist``."""
    bundled = Path(__file__).parent / "_frontend"
    if (bundled / "index.html").is_file():
        return bundled
    return Path(__file__).resolve().parents[2] / "frontend" / "dist"


def _valid_object(obj: object) -> bool:
    if not isinstance(obj, dict) or not isinstance(obj.get("id"), str):
        return False
    geom = obj.get("geom")
    if isinstance(geom, dict) and isinstance(geom.get("type"), str):
        return True
    return isinstance(obj.get("kind"), str)  # v1 entity; the frontend migrates it


class _State:
    def __init__(self) -> None:
        self.title = ""
        self.view = "auto"
        self.run: str | None = None
        self.objects: dict[str, dict] = {}
        self.subscribers: list[queue.Queue[str]] = []
        self.lock = threading.Lock()

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "version": PROTOCOL,
                "title": self.title,
                "run": self.run,
                "view": self.view,
                "objects": list(self.objects.values()),
            }

    def _broadcast(self, event: dict) -> None:
        payload = f"data: {json.dumps(event)}\n\n"
        for sub in self.subscribers:
            sub.put(payload)

    def post(self, batch: dict) -> None:
        with self.lock:
            run = batch.get("run")
            if isinstance(run, str) and run != self.run:
                keep = bool(batch.get("keep"))
                self.run = run
                if not keep:
                    self.objects.clear()
                    self.title, self.view = "", "auto"
                self._broadcast({"type": "run", "run": run, "keep": keep})
            if isinstance(batch.get("title"), str):
                self.title = batch["title"]
            if isinstance(batch.get("view"), str):
                self.view = batch["view"]
            objects = batch.get("objects", [])
            for obj in objects:
                self.objects[obj["id"]] = obj
            self._broadcast({"type": "upsert", "objects": objects, "title": self.title, "view": self.view})

    def remove(self, object_id: str) -> bool:
        with self.lock:
            if self.objects.pop(object_id, None) is None:
                return False
            self._broadcast({"type": "remove", "id": object_id})
            return True

    def clear(self) -> None:
        with self.lock:
            self.objects.clear()
            self._broadcast({"type": "clear"})

    def subscribe(self) -> queue.Queue[str]:
        sub: queue.Queue[str] = queue.Queue()
        with self.lock:
            self.subscribers.append(sub)
        return sub

    def unsubscribe(self, sub: queue.Queue[str]) -> None:
        with self.lock:
            self.subscribers.remove(sub)


def make_handler(frontend_dir: Path, state: _State) -> type[BaseHTTPRequestHandler]:
    root = frontend_dir.resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = f"{APP}/{PROTOCOL}"

        def log_message(self, *args: object) -> None:
            pass

        def _send_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def _send_json(self, obj: object, status: int = 200) -> None:
            self._send_bytes(json.dumps(obj).encode(), "application/json", status)

        def _read_json(self) -> object:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length) if length else b"{}")

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/health":
                self._send_json({"app": APP, "protocol": PROTOCOL})
            elif path == "/api/scene":
                self._send_json(state.snapshot())
            elif path == "/events":
                self._stream_events()
            else:
                self._send_static(path)

        def _stream_events(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            sub = state.subscribe()
            try:
                self.wfile.write(b": connected\n\n")
                self.wfile.flush()
                while True:
                    try:
                        payload = sub.get(timeout=_KEEPALIVE_S)
                    except queue.Empty:
                        payload = ": ping\n\n"
                    self.wfile.write(payload.encode())
                    self.wfile.flush()
            except (ConnectionError, BrokenPipeError):
                pass  # browser tab closed or reloaded
            finally:
                state.unsubscribe(sub)

        def _send_static(self, path: str) -> None:
            rel = path.lstrip("/") or "index.html"
            target = (root / rel).resolve()
            if target.is_dir():
                target = target / "index.html"
            if not target.is_relative_to(root) or not target.is_file():
                if rel == "index.html":
                    self._send_bytes(_PLACEHOLDER, "text/html")
                else:
                    self.send_error(404)
                return
            self._send_bytes(target.read_bytes(), _MIME.get(target.suffix, "application/octet-stream"))

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            try:
                body = self._read_json()
            except ValueError:
                self._send_json({"error": "body is not JSON"}, 400)
                return
            if path == "/api/objects":
                objects = body.get("objects") if isinstance(body, dict) else None
                if not isinstance(objects, list) or not all(_valid_object(o) for o in objects):
                    self._send_json({"error": 'expected {"objects": [...]}, each with a string id and geom.type'}, 400)
                    return
                state.post(body)
            elif path == "/api/add":
                if not _valid_object(body):
                    self._send_json({"error": "entity needs a string id and kind"}, 400)
                    return
                state.post({"objects": [body]})
            elif path == "/api/clear":
                state.clear()
            elif path == "/api/shutdown":
                self._send_json({"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            else:
                self.send_error(404)
                return
            self._send_json({"ok": True})

        def do_DELETE(self) -> None:
            path = urlparse(self.path).path
            prefix = "/api/objects/"
            if not path.startswith(prefix):
                self.send_error(404)
                return
            if state.remove(unquote(path[len(prefix):])):
                self._send_json({"ok": True})
            else:
                self._send_json({"error": "no such object"}, 404)

    return Handler


class Server:
    """Local viewer server. Background thread via :meth:`start`, or a context manager."""

    def __init__(self, frontend_dir: str | Path | None = None, port: int = DEFAULT_PORT) -> None:
        self.state = _State()
        directory = Path(frontend_dir) if frontend_dir is not None else default_frontend_dir()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(directory, self.state))
        self.port = self.httpd.server_address[1]
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> Server:
        self._thread.start()
        return self

    def stop(self) -> None:
        if self._thread.is_alive():
            self.httpd.shutdown()
            self._thread.join(timeout=5)
        self.httpd.server_close()

    def __enter__(self) -> Server:
        return self.start()

    def __exit__(self, *args: object) -> None:
        self.stop()
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_server.py -q`
Expected: `10 passed`.

- [ ] **Step 6: Commit**

```bash
git add protocol/SCENE.md python/geomcore_viewer/server.py python/tests/test_server.py python/tests/test_viewer.py
git commit -m "protocol v2 + server: health, objects, runs, delete, shutdown, SSE events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`python/tests/test_viewer.py` is staged as deleted; `python/geomcore_viewer/viewer.py` and `__init__.py` still import the old API and are rewritten in Task 4 — the package import stays working because nothing removed from `server.py` is used by them except `Server`.)

---

### Task 2: Adapter — geomcore objects and results → protocol geometry

**Files:**
- Create: `python/geomcore_viewer/adapt.py`
- Create: `python/tests/test_adapt.py`
- Create: `python/tests/test_sampling.py` (the two sampling tests from the deleted v1 file)

**Interfaces:**
- Consumes: `geomcore_viewer.sampling.sample_curve(eval_point, t0, t1, n) -> list`, `sample_surface_grid(eval_point, u0, u1, v0, v1, nu, nv) -> (vertices, indices)` (existing).
- Produces (`geomcore_viewer.adapt`):
  - `to_objects(obj, label: str | None = None, *, u=None, v=None) -> list[dict]` — each part is `{"label": str | None, "geom": dict, "source"?: str, "key"?: str}`; `key` is set on notes (`f"{label}·note"`).
  - `eval_curve(geom: dict, t: float) -> list[float]`, `eval_surface(geom: dict, u: float, v: float) -> list[float]`.
  - `as_vec(p) -> list[float]` (Point3D/Point2D/Vector3D/Vector2D/sequence → `[x, y, z]`).
  - `subscript(i: int) -> str` (`1 → "₁"`).
  - `with_window(geom: dict, extent: float, u=None, v=None) -> dict` (surfaces only; others returned unchanged).
  - `scene_extent(geoms: Iterable[dict]) -> float`.
  - `SURFACE_TYPES: frozenset[str]` = `{"plane","cylinder","cone","sphere","torus"}`.

- [ ] **Step 1: Move the sampling tests**

Create `python/tests/test_sampling.py`:

```python
import math

import pytest

from geomcore_viewer import sample_curve, sample_surface_grid


class P3:
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


def test_sample_curve_3d():
    pts = sample_curve(lambda t: P3(2 * math.cos(t), 2 * math.sin(t)), 0.0, 2 * math.pi, n=8)
    assert len(pts) == 9
    assert pts[0][0] == pytest.approx(2.0)
    assert all(len(p) == 3 for p in pts)


def test_sample_surface_grid():
    verts, idx = sample_surface_grid(lambda u, v: P3(u, v, u * v), 0, 1, 0, 1, nu=4, nv=2)
    assert len(verts) == 5 * 3
    assert len(idx) == 4 * 2 * 6
```

- [ ] **Step 2: Write the failing adapter tests**

Create `python/tests/test_adapt.py`:

```python
import math

import pytest

from geomcore_viewer.adapt import (
    _frame,
    as_vec,
    eval_curve,
    eval_surface,
    scene_extent,
    subscript,
    to_objects,
    with_window,
)

TILTED = _frame([1.0, 2.0, 3.0], [1.0, -1.0, 0.0], [1.0, 1.0, 1.0])


# --- duck-typed stand-ins named like geomcore classes ---------------------
class Point3D:
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


class Vector3D:
    def __init__(self, *c):
        self._c = c

    def components(self):
        return self._c


def fake(name, geom, **getters):
    """An object named ``name`` that evaluates ``geom`` and exposes ``getters``."""

    def eval_point(self, *args):
        p = eval_curve(geom, *args) if len(args) == 1 else eval_surface(geom, *args)
        return Point3D(*p)

    attrs = {"eval_point": eval_point}
    for key, value in getters.items():
        attrs[key] = (lambda value: lambda self: value)(value)
    return type(name, (), attrs)()


def assert_frame(got, want):
    for axis in ("o", "x", "y", "z"):
        assert got[axis] == pytest.approx(want[axis], abs=1e-12), axis


CASES = [
    ("Circle3D", {"type": "circle", "frame": TILTED, "r": 1.5},
     {"center": Point3D(*TILTED["o"]), "radius": 1.5, "normal": Vector3D(*TILTED["z"])}),
    ("Ellipse3D", {"type": "ellipse", "frame": TILTED, "a": 3.0, "b": 2.0},
     {"center": Point3D(*TILTED["o"]), "major_radius": 3.0, "minor_radius": 2.0}),
    ("Hyperbola3D", {"type": "hyperbola", "frame": TILTED, "a": 2.0, "b": 1.0},
     {"center": Point3D(*TILTED["o"]), "major_radius": 2.0, "minor_radius": 1.0}),
    ("Parabola3D", {"type": "parabola", "frame": TILTED, "f": 0.7}, {"focal": 0.7}),
    ("Plane", {"type": "plane", "frame": TILTED}, {}),
    ("Cylinder", {"type": "cylinder", "frame": TILTED, "r": 2.0}, {"radius": 2.0}),
    ("Cone", {"type": "cone", "frame": TILTED, "semi_angle": 0.4, "ref_radius": 2.0},
     {"semi_angle": 0.4, "ref_radius": 2.0}),
    ("Cone", {"type": "cone", "frame": TILTED, "semi_angle": 0.4, "ref_radius": 0.0},
     {"semi_angle": 0.4, "ref_radius": 0.0}),
    ("Sphere", {"type": "sphere", "frame": TILTED, "r": 3.0}, {"center": Point3D(*TILTED["o"]), "radius": 3.0}),
    ("Torus", {"type": "torus", "frame": TILTED, "R": 4.0, "r": 1.0}, {"major_radius": 4.0, "minor_radius": 1.0}),
]


@pytest.mark.parametrize("name,geom,getters", CASES, ids=[f"{c[0]}-{i}" for i, c in enumerate(CASES)])
def test_recovers_tilted_frames(name, geom, getters):
    [part] = to_objects(fake(name, geom, **getters), "S")
    assert part["label"] == "S" and part["source"] == name
    got = part["geom"]
    assert got["type"] == geom["type"]
    assert_frame(got["frame"], geom["frame"])
    for key in set(geom) - {"type", "frame"}:
        assert got[key] == pytest.approx(geom[key])


def test_line_and_point():
    line = type("Line3D", (), {
        "origin": lambda self: Point3D(1, 2, 3),
        "direction": lambda self: Vector3D(0.0, 0.0, 1.0),
        "eval_point": lambda self, t: Point3D(1, 2, 3 + t),
    })()
    assert to_objects(line)[0]["geom"] == {"type": "line", "o": [1.0, 2.0, 3.0], "d": [0.0, 0.0, 1.0]}
    assert to_objects(Point3D(1, 2, 3), "A") == [{"label": "A", "geom": {"type": "point", "p": [1.0, 2.0, 3.0]}, "source": "Point3D"}]


def test_convention_mismatch_raises():
    geom = {"type": "ellipse", "frame": TILTED, "a": 3.0, "b": 2.0}
    lying = fake("Ellipse3D", geom, center=Point3D(*TILTED["o"]), major_radius=3.0, minor_radius=2.5)
    with pytest.raises(ValueError, match="convention"):
        to_objects(lying)


def test_points_result_gets_subscripted_labels():
    parts = to_objects(("points", [(0.1, Point3D(1, 0, 0), 0.2), (0.3, Point3D(0, 1, 0), 0.4)]), "P")
    assert [p["label"] for p in parts] == ["P₁", "P₂"]
    assert [p["geom"]["p"] for p in parts] == [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]


@pytest.mark.parametrize("tag,text", [("empty", "P: ∅"), ("parallel", "P: ∅ (parallel)"), ("skew", "P: ∅ (skew)")])
def test_empty_results_become_notes(tag, text):
    assert to_objects((tag, None), "P") == [
        {"label": None, "key": "P·note", "geom": {"type": "note", "text": text, "level": "info"}}
    ]


def test_not_analytic_and_unknown_tags_warn():
    [note] = to_objects(("not_analytic", None), "X")
    assert note["geom"]["level"] == "warn" and "intersect_marching" in note["geom"]["text"]
    parts = to_objects(("bogus", Point3D(0, 0, 0)), "Y")
    assert parts[0]["geom"]["type"] == "point"
    assert parts[1]["geom"] == {"type": "note", "text": "Y: unrecognized result tag 'bogus'", "level": "warn"}


def test_tangent_result_draws_payload_and_notes_it():
    parts = to_objects(("tangent", (2.3, Point3D(1, 1, 0), -1.0)), "T")
    assert parts[0]["geom"] == {"type": "point", "p": [1.0, 1.0, 0.0]}
    assert parts[1]["geom"]["text"] == "T: tangent"


def test_lists():
    assert to_objects([], "Z")[0]["geom"]["text"] == "Z: ∅"
    assert len(to_objects([Point3D(0, 0, 0), Point3D(1, 0, 0)], "Q")) == 2
    with pytest.raises(TypeError, match="no geometry"):
        to_objects([1.0, 2.0])
    with pytest.raises(TypeError, match="object"):
        to_objects(object())


def test_bspline_surface_needs_window():
    surf = type("BSplineSurface", (), {"eval_point": lambda self, u, v: Point3D(u, v, 0.0)})()
    with pytest.raises(TypeError, match="u=.*v="):
        to_objects(surf)
    [part] = to_objects(surf, u=(0, 1), v=(0, 1))
    assert part["geom"]["type"] == "mesh"


def test_windows_and_extent():
    geoms = [{"type": "point", "p": [2.0, 0.0, 0.0]}, {"type": "circle", "frame": TILTED, "r": 1.0}]
    extent = scene_extent(geoms)
    assert extent == pytest.approx(1.5 * (math.sqrt(14) + 1.0))
    assert scene_extent([]) == 5.0
    plane = with_window({"type": "plane", "frame": TILTED}, 3.0)
    assert plane["window"] == {"u": [-3.0, 3.0], "v": [-3.0, 3.0]}
    cyl = with_window({"type": "cylinder", "frame": TILTED, "r": 1.0}, 3.0, v=(0, 2))
    assert cyl["window"] == {"u": [0.0, 2 * math.pi], "v": [0.0, 2.0]}
    point = {"type": "point", "p": [0, 0, 0]}
    assert with_window(point, 3.0) is point


def test_helpers():
    assert subscript(12) == "₁₂"
    assert as_vec((1, 2)) == [1.0, 2.0, 0.0]
    assert as_vec(Vector3D(1, 2, 3)) == [1.0, 2.0, 3.0]


# --- real geomcore (skipped when it is not importable) --------------------
def test_real_geomcore_types_round_trip():
    gc = pytest.importorskip("geomcore")
    from geomcore import Frame3D, Point2D, Point3D as P, Vector2D, Vector3D as V
    from geomcore.curves import Circle2D, Circle3D, Ellipse3D, Hyperbola3D, Line2D, Line3D, Parabola3D
    from geomcore.surfaces import Cone, Cylinder, Plane, Sphere, Torus

    tilted = Frame3D(P(1, 2, 3), V(1, 1, 1), V(1, -1, 0))
    curves = [
        Line3D(P(1, 2, 3), V(1, 1, 0)), Circle3D(P(2, 1, 0), V(0, 1, 1), 1.5),
        Ellipse3D.from_frame(tilted, 3.0, 2.0), Hyperbola3D.from_frame(tilted, 2.0, 1.0),
        Parabola3D.from_frame(tilted, 0.7), Line2D(Point2D(0, 1), Vector2D(1, 1)), Circle2D(Point2D(1, 1), 2.0),
    ]
    for curve in curves:
        [part] = to_objects(curve)
        for t in (-1.3, 0.0, 1.1, 2.5):
            assert eval_curve(part["geom"], t) == pytest.approx(as_vec(curve.eval_point(t)), abs=1e-9), type(curve).__name__
    surfaces = [
        Plane.from_frame(tilted), Cylinder.from_frame(tilted, 2.0), Cone.from_frame(tilted, 0.4, 2.0),
        Sphere(P(1, 2, 3), 3.0), Torus(P(1, 2, 3), V(1, 1, 1), 4.0, 1.0),
    ]
    for surface in surfaces:
        [part] = to_objects(surface)
        for u, v in ((0.0, 0.0), (1.1, -0.4), (2.5, 0.9)):
            assert eval_surface(part["geom"], u, v) == pytest.approx(as_vec(surface.eval_point(u, v)), abs=1e-9), type(surface).__name__
    assert gc is not None


def test_real_geomcore_intersections():
    pytest.importorskip("geomcore")
    from geomcore import Frame3D, Point3D as P, Vector3D as V
    from geomcore.curves import Circle3D, Ellipse3D

    E = Ellipse3D.from_frame(Frame3D.world(), 3.0, 2.0)
    C = Circle3D(P(2, 1, 0), V.z(), 1.5)
    parts = to_objects(C.intersect_ellipse(E), "P")
    assert [p["label"] for p in parts] == ["P₁", "P₂"]
    far = Circle3D(P(9, 0, 0), V.z(), 1.0)
    assert to_objects(C.intersect_circle(far), "Q")[0]["geom"]["text"] == "Q: ∅"
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_adapt.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'geomcore_viewer.adapt'`.

- [ ] **Step 4: Write `python/geomcore_viewer/adapt.py`**

```python
"""Turn geomcore objects and intersection results into protocol-v2 geometry.

Dispatch is by class name + duck typing, so this module never imports
geomcore. geomcore-py exposes radii and centers but not orientation, so
analytic frames are recovered by evaluating the object at known parameters
(the parametrizations in protocol/SCENE.md, identical to geomcore's). Every
recovered geometry is re-evaluated at an extra parameter and compared with
``eval_point``: a convention mismatch raises instead of drawing a wrong
shape.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

from .sampling import sample_curve, sample_surface_grid

TAU = 2.0 * math.pi
CHECK_TOL = 1e-9
_CHECK_T = 0.7
_CHECK_UV = (0.7, 0.3)
_BSPLINE_SEGMENTS = 256
_BSPLINE_GRID = 48

CURVES = frozenset({"Line3D", "Line2D", "Circle3D", "Circle2D", "Ellipse3D", "Parabola3D", "Hyperbola3D"})
SURFACES = frozenset({"Plane", "Cylinder", "Cone", "Sphere", "Torus"})
POINTS = frozenset({"Point3D", "Point2D"})
SAMPLED = frozenset({"BSplineCurve3D", "BSplineSurface"})
GEOMETRY = CURVES | SURFACES | POINTS | SAMPLED
SURFACE_TYPES = frozenset({"plane", "cylinder", "cone", "sphere", "torus"})

POINT_TAGS = frozenset({"point", "one_point", "tangent_point", "apex_point", "two_points", "points", "hits"})
CURVE_TAGS = frozenset({
    "line", "two_lines", "tangent_line", "circle", "two_circles", "tangent_circle", "ellipse", "parabola", "hyperbola",
})
EMPTY_NOTES = {"empty": "∅", "parallel": "∅ (parallel)", "skew": "∅ (skew)"}
INFO_NOTES = {
    "coincident": "coincident",
    "tangent": "tangent",
    "tangent_point": "tangent",
    "tangent_line": "tangent",
    "tangent_circle": "tangent",
    "apex_point": "through the apex",
}

# Full periods of closed parameter directions, and which directions are infinite.
_FULL_PERIOD = {
    "plane": {},
    "cylinder": {"u": [0.0, TAU]},
    "cone": {"u": [0.0, TAU]},
    "sphere": {"u": [0.0, TAU], "v": [-math.pi / 2, math.pi / 2]},
    "torus": {"u": [0.0, TAU], "v": [0.0, TAU]},
}
_INFINITE = {"plane": ("u", "v"), "cylinder": ("v",), "cone": ("v",), "sphere": (), "torus": ()}

_SUBSCRIPTS = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def subscript(i: int) -> str:
    return str(i).translate(_SUBSCRIPTS)


# --- vectors ---------------------------------------------------------------
def as_vec(p) -> list[float]:
    """Point3D / Point2D / Vector2D / Vector3D / sequence → ``[x, y, z]`` floats."""
    if hasattr(p, "components"):  # Vector3D: .x is a static constructor there
        c = list(p.components())
    elif hasattr(p, "x") and not callable(p.x):
        c = [p.x, p.y, getattr(p, "z", 0.0)]
    else:
        c = list(p)
    if len(c) == 2:
        c.append(0.0)
    if len(c) != 3:
        raise TypeError(f"expected a 2D or 3D point/vector, got {p!r}")
    return [float(x) for x in c]


def _add(a, b):
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def _sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def _mul(a, s):
    return [a[0] * s, a[1] * s, a[2] * s]


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _mid(a, b):
    return _mul(_add(a, b), 0.5)


def _unit(a):
    n = math.sqrt(_dot(a, a))
    if n == 0.0:
        raise ValueError("degenerate geometry: zero-length frame axis")
    return _mul(a, 1.0 / n)


def _frame(o, x, z) -> dict:
    """Right-handed orthonormal frame from an origin, an x hint and a z direction."""
    z = _unit(z)
    x = _unit(_sub(x, _mul(z, _dot(x, z))))
    return {"o": list(o), "x": x, "y": _cross(z, x), "z": z}


def _in_frame(f, cx, cy, cz=0.0):
    return _add(f["o"], _add(_mul(f["x"], cx), _add(_mul(f["y"], cy), _mul(f["z"], cz))))


# --- evaluators (mirror of protocol/SCENE.md and frontend/src/geom) -------
def eval_curve(g: dict, t: float) -> list[float]:
    kind = g["type"]
    if kind == "line":
        return _add(g["o"], _mul(g["d"], t))
    f = g["frame"]
    if kind == "circle":
        return _in_frame(f, g["r"] * math.cos(t), g["r"] * math.sin(t))
    if kind == "ellipse":
        return _in_frame(f, g["a"] * math.cos(t), g["b"] * math.sin(t))
    if kind == "parabola":
        return _in_frame(f, t * t / (4.0 * g["f"]), t)
    if kind == "hyperbola":
        return _in_frame(f, g["a"] * math.cosh(t), g["b"] * math.sinh(t))
    raise ValueError(f"not a curve: {kind}")


def eval_surface(g: dict, u: float, v: float) -> list[float]:
    kind, f = g["type"], g["frame"]
    if kind == "plane":
        return _in_frame(f, u, v)
    if kind == "cylinder":
        return _in_frame(f, g["r"] * math.cos(u), g["r"] * math.sin(u), v)
    if kind == "cone":
        radius = g["ref_radius"] + v * math.sin(g["semi_angle"])
        return _in_frame(f, radius * math.cos(u), radius * math.sin(u), v * math.cos(g["semi_angle"]))
    if kind == "sphere":
        rc = g["r"] * math.cos(v)
        return _in_frame(f, rc * math.cos(u), rc * math.sin(u), g["r"] * math.sin(v))
    if kind == "torus":
        rho = g["R"] + g["r"] * math.cos(v)
        return _in_frame(f, rho * math.cos(u), rho * math.sin(u), g["r"] * math.sin(v))
    raise ValueError(f"not a surface: {kind}")


def _check(name: str, want: list[float], got: list[float]) -> None:
    err = math.dist(want, got)
    if err > CHECK_TOL * max(1.0, math.hypot(*want)):
        raise ValueError(
            f"{name}: recovered geometry is off by {err:.3g} at the check parameter — "
            "geomcore's parametrization convention may have changed; please report it"
        )


# --- frame recovery ----------------------------------------------------------
def _curve_geom(obj, name: str) -> dict:
    def P(t):
        return as_vec(obj.eval_point(t))

    if name in ("Line3D", "Line2D"):
        return {"type": "line", "o": as_vec(obj.origin()), "d": as_vec(obj.direction())}
    if name in ("Circle3D", "Circle2D"):
        o = as_vec(obj.center())
        z = as_vec(obj.normal()) if name == "Circle3D" else [0.0, 0.0, 1.0]
        return {"type": "circle", "frame": _frame(o, _sub(P(0.0), o), z), "r": float(obj.radius())}
    if name == "Ellipse3D":
        o = as_vec(obj.center())
        x, y = _sub(P(0.0), o), _sub(P(math.pi / 2), o)
        return {"type": "ellipse", "frame": _frame(o, x, _cross(x, y)),
                "a": float(obj.major_radius()), "b": float(obj.minor_radius())}
    if name == "Hyperbola3D":
        o = as_vec(obj.center())
        x, y = _sub(P(0.0), o), _sub(P(1.0), P(-1.0))
        return {"type": "hyperbola", "frame": _frame(o, x, _cross(x, y)),
                "a": float(obj.major_radius()), "b": float(obj.minor_radius())}
    if name == "Parabola3D":
        o, focal = P(0.0), float(obj.focal())
        x = _mul(_sub(_add(P(1.0), P(-1.0)), _mul(o, 2.0)), focal)  # = x/2 whatever the sign of f
        y = _sub(P(1.0), P(-1.0))
        return {"type": "parabola", "frame": _frame(o, x, _cross(x, y)), "f": focal}
    raise TypeError(name)


def _surface_geom(obj, name: str) -> dict:
    def S(u, v):
        return as_vec(obj.eval_point(u, v))

    if name == "Plane":
        o = S(0.0, 0.0)
        x, y = _sub(S(1.0, 0.0), o), _sub(S(0.0, 1.0), o)
        return {"type": "plane", "frame": _frame(o, x, _cross(x, y))}
    if name == "Cylinder":
        a = S(0.0, 0.0)
        o = _mid(a, S(math.pi, 0.0))
        return {"type": "cylinder", "frame": _frame(o, _sub(a, o), _sub(S(0.0, 1.0), a)), "r": float(obj.radius())}
    if name == "Cone":
        phi, r0 = float(obj.semi_angle()), float(obj.ref_radius())
        c0 = _mid(S(0.0, 0.0), S(math.pi, 0.0))
        c1 = _mid(S(0.0, 1.0), S(math.pi, 1.0))
        ring = 0.0 if abs(r0) > 1e-12 else 1.0  # the v = 0 ring is a point when ref_radius = 0
        x = _sub(S(0.0, ring), c0 if ring == 0.0 else c1)
        if r0 + ring * math.sin(phi) < 0.0:
            x = _mul(x, -1.0)  # negative ring radius points the other way
        return {"type": "cone", "frame": _frame(c0, x, _sub(c1, c0)), "semi_angle": phi, "ref_radius": r0}
    if name == "Sphere":
        o = as_vec(obj.center())
        return {"type": "sphere", "frame": _frame(o, _sub(S(0.0, 0.0), o), _sub(S(0.0, math.pi / 2), o)),
                "r": float(obj.radius())}
    if name == "Torus":
        big, small = float(obj.major_radius()), float(obj.minor_radius())
        a = S(0.0, 0.0)
        o = _mid(a, S(math.pi, 0.0))
        x = _unit(_sub(a, o))
        z = _sub(_sub(S(0.0, math.pi / 2), o), _mul(x, big))
        return {"type": "torus", "frame": _frame(o, x, z), "R": big, "r": small}
    raise TypeError(name)


def _single(obj, label: str | None, u, v) -> list[dict]:
    name = type(obj).__name__
    if name in POINTS:
        geom = {"type": "point", "p": as_vec(obj)}
    elif name in CURVES:
        geom = _curve_geom(obj, name)
        _check(name, as_vec(obj.eval_point(_CHECK_T)), eval_curve(geom, _CHECK_T))
    elif name in SURFACES:
        geom = _surface_geom(obj, name)
        _check(name, as_vec(obj.eval_point(*_CHECK_UV)), eval_surface(geom, *_CHECK_UV))
    elif name == "BSplineCurve3D":
        t0, t1 = obj.bounds()
        geom = {"type": "polyline", "points": sample_curve(obj.eval_point, t0, t1, _BSPLINE_SEGMENTS)}
    elif name == "BSplineSurface":
        if u is None or v is None:
            raise TypeError("BSplineSurface has no domain getter in geomcore yet: pass u=(u0, u1) and v=(v0, v1)")
        vertices, indices = sample_surface_grid(obj.eval_point, u[0], u[1], v[0], v[1], _BSPLINE_GRID, _BSPLINE_GRID)
        geom = {"type": "mesh", "vertices": vertices, "indices": indices}
    else:
        raise TypeError(name)
    return [{"label": label, "geom": geom, "source": name}]


# --- results and containers --------------------------------------------------
def _leaves(payload) -> list:
    """Geometry objects anywhere inside a result payload (parameters are dropped)."""
    if payload is None:
        return []
    if type(payload).__name__ in GEOMETRY:
        return [payload]
    if isinstance(payload, (list, tuple)):
        return [leaf for item in payload for leaf in _leaves(item)]
    return []


def _labelled(items: list, label: str | None, u, v) -> list[dict]:
    if len(items) == 1:
        return _single(items[0], label, u, v)
    parts: list[dict] = []
    for i, item in enumerate(items, start=1):
        parts += _single(item, f"{label}{subscript(i)}" if label else None, u, v)
    return parts


def _note(text: str, label: str | None, level: str = "info") -> dict:
    return {
        "label": None,
        "key": f"{label}·note" if label else None,
        "geom": {"type": "note", "text": f"{label}: {text}" if label else text, "level": level},
    }


def _is_result(obj) -> bool:
    return isinstance(obj, tuple) and len(obj) == 2 and isinstance(obj[0], str)


def _result(tag: str, payload, label: str | None, u, v) -> list[dict]:
    if tag in EMPTY_NOTES:
        return [_note(EMPTY_NOTES[tag], label)]
    if tag == "not_analytic":
        return [_note("no closed form — try geomcore.intersect_marching", label, "warn")]
    parts = _labelled(_leaves(payload), label, u, v)
    if tag in INFO_NOTES:
        parts.append(_note(INFO_NOTES[tag], label))
    elif tag not in POINT_TAGS and tag not in CURVE_TAGS:
        parts.append(_note(f"unrecognized result tag {tag!r}", label, "warn"))
    return parts


def to_objects(obj, label: str | None = None, *, u=None, v=None) -> list[dict]:
    """Protocol parts for one ``add`` argument: a geomcore object, a ``(tag, payload)``
    intersection result, or a list/tuple of those."""
    if _is_result(obj):
        return _result(obj[0], obj[1], label, u, v)
    if type(obj).__name__ in GEOMETRY:
        return _single(obj, label, u, v)
    if isinstance(obj, (list, tuple)):
        if not obj:
            return [_note(EMPTY_NOTES["empty"], label)]
        leaves = _leaves(obj)
        if not leaves:
            raise TypeError(f"no geometry found in {type(obj).__name__} of length {len(obj)}")
        return _labelled(leaves, label, u, v)
    raise TypeError(
        f"cannot show {type(obj).__name__}: expected a geomcore curve, surface or point, "
        "an intersection result (tag, payload), or a list of those"
    )


# --- surface windows -----------------------------------------------------------
def scene_extent(geoms: Iterable[dict]) -> float:
    """Half-size for infinite surface windows: 1.5 × the farthest finite feature
    from the origin, or 5 for an empty scene."""
    reach = 0.0
    for g in geoms:
        kind = g["type"]
        if kind == "point":
            reach = max(reach, math.hypot(*g["p"]))
        elif kind in ("circle", "sphere"):
            reach = max(reach, math.hypot(*g["frame"]["o"]) + g["r"])
        elif kind == "ellipse":
            reach = max(reach, math.hypot(*g["frame"]["o"]) + g["a"])
        elif kind == "torus":
            reach = max(reach, math.hypot(*g["frame"]["o"]) + g["R"] + g["r"])
        elif kind == "polyline":
            reach = max([reach, *(math.hypot(*p) for p in g["points"])])
        elif kind == "mesh":
            reach = max([reach, *(math.hypot(*p) for p in g["vertices"])])
    return 1.5 * reach if reach > 0.0 else 5.0


def with_window(geom: dict, extent: float, u=None, v=None) -> dict:
    """A surface geom with ``window`` filled: explicit u/v, else full periods, else ±extent."""
    kind = geom["type"]
    if kind not in _INFINITE:
        return geom
    window = {d: list(r) for d, r in _FULL_PERIOD[kind].items()}
    for d in _INFINITE[kind]:
        window[d] = [-float(extent), float(extent)]
    if u is not None:
        window["u"] = [float(u[0]), float(u[1])]
    if v is not None:
        window["v"] = [float(v[0]), float(v[1])]
    return {**geom, "window": window}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_adapt.py python/tests/test_sampling.py -q`
Expected: all pass (the two `real_geomcore` tests run because `../geomcore/geomcore-py` is on the path; they must pass too — if one fails, the recovery formula for that type is wrong, fix it rather than loosening the tolerance).

- [ ] **Step 6: Commit**

```bash
git add python/geomcore_viewer/adapt.py python/tests/test_adapt.py python/tests/test_sampling.py
git commit -m "adapter: geomcore objects and intersection results to protocol v2 geometry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server discovery, spawn, CLI, packaging

**Files:**
- Create: `python/geomcore_viewer/spawn.py`
- Rewrite: `python/geomcore_viewer/__main__.py`
- Rewrite: `python/pyproject.toml`
- Create: `scripts/bundle-frontend.sh` (executable)
- Modify: `.gitignore`
- Create: `python/tests/test_spawn.py`

**Interfaces:**
- Consumes: `geomcore_viewer.server.APP`, `PROTOCOL`, `DEFAULT_PORT`, `Server`.
- Produces (`geomcore_viewer.spawn`): `probe(url: str, timeout: float = 0.5) -> str` returning `"ours" | "foreign" | "none"`; `ensure_server(url: str, timeout: float = 5.0) -> bool` (True if it started the server; raises `RuntimeError` on foreign listener / failed start); `stop_server(url: str) -> bool`.
- Produces (CLI): `python -m geomcore_viewer serve [--dir D] [--port P] [--no-browser]`, `python -m geomcore_viewer stop [--port P]`; console script `geomcore-viewer`. `main(argv: list[str] | None = None) -> None`.

- [ ] **Step 1: Write the failing tests**

Create `python/tests/test_spawn.py`:

```python
import socket
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from geomcore_viewer.__main__ import main
from geomcore_viewer.spawn import ensure_server, probe, stop_server


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_ensure_server_spawns_reuses_and_stops():
    url = f"http://127.0.0.1:{_free_port()}"
    assert probe(url) == "none"
    try:
        assert ensure_server(url) is True
        assert probe(url) == "ours"
        assert ensure_server(url) is False
    finally:
        assert stop_server(url)
    deadline = time.monotonic() + 3
    while probe(url) != "none" and time.monotonic() < deadline:
        time.sleep(0.05)
    assert probe(url) == "none"


def test_foreign_listener_is_reported(tmp_path):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), lambda *a: SimpleHTTPRequestHandler(*a, directory=str(tmp_path)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        assert probe(url) == "foreign"
        with pytest.raises(RuntimeError, match="not a geomcore-viewer v2 server"):
            ensure_server(url)
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_only_local_servers_are_spawned():
    with pytest.raises(RuntimeError, match="only local"):
        ensure_server(f"http://192.0.2.1:{_free_port()}", timeout=0.5)


def test_cli_stop_without_server(capsys):
    port = _free_port()
    main(["stop", "--port", str(port)])
    assert "no viewer running" in capsys.readouterr().out
```

Note: `192.0.2.1` is TEST-NET (never routable); `probe` returns `"none"` after its 0.5 s timeout and `ensure_server` must refuse before spawning.

- [ ] **Step 2: Run the tests to see them fail**

Run: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_spawn.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'geomcore_viewer.spawn'`.

- [ ] **Step 3: Write `python/geomcore_viewer/spawn.py`**

```python
"""Find or start the background viewer server — one per port, shared by every run."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from .server import APP, PROTOCOL

_children: list[subprocess.Popen] = []  # keep handles so they aren't reported as leaked


def probe(url: str, timeout: float = 0.5) -> str:
    """``"ours"`` (a v2 geomcore-viewer answers), ``"foreign"`` (something else
    answers) or ``"none"`` (nothing listens)."""
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=timeout) as res:
            doc = json.loads(res.read())
    except urllib.error.HTTPError:
        return "foreign"
    except ValueError:
        return "foreign"
    except OSError:
        return "none"
    if isinstance(doc, dict) and doc.get("app") == APP and doc.get("protocol") == PROTOCOL:
        return "ours"
    return "foreign"


def _spawn(port: int) -> subprocess.Popen:
    env = dict(os.environ)
    package_parent = str(Path(__file__).resolve().parent.parent)
    env["PYTHONPATH"] = os.pathsep.join(p for p in (package_parent, env.get("PYTHONPATH")) if p)
    if os.name == "posix":
        detach: dict = {"start_new_session": True}
    else:
        detach = {"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
    proc = subprocess.Popen(
        [sys.executable, "-m", "geomcore_viewer", "serve", "--port", str(port), "--no-browser"],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, **detach,
    )
    _children.append(proc)
    return proc


def ensure_server(url: str, timeout: float = 5.0) -> bool:
    """Make sure a geomcore-viewer answers at ``url``; return True if this call started it.

    Raises RuntimeError when another application holds the port, when ``url``
    is not local, or when the started server does not answer within ``timeout``.
    """
    state = probe(url)
    if state == "ours":
        return False
    if state == "foreign":
        raise RuntimeError(
            f"{url} answers but is not a geomcore-viewer v2 server (an older geomcore-viewer, "
            "or another application). Stop it, or pass Viewer(url='http://127.0.0.1:<free port>')."
        )
    parsed = urlparse(url)
    if parsed.hostname not in ("127.0.0.1", "localhost"):
        raise RuntimeError(f"no geomcore-viewer at {url} (only local servers are started automatically)")
    port = parsed.port or 80
    proc = _spawn(port)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if probe(url) == "ours":
            return True
        if proc.poll() is not None:
            raise RuntimeError(
                f"the viewer server exited with code {proc.returncode}; "
                f"run `python -m geomcore_viewer serve --port {port}` to see why"
            )
        time.sleep(0.05)
    raise RuntimeError(f"the viewer server did not answer at {url} within {timeout:.0f} s")


def stop_server(url: str) -> bool:
    """Ask the server at ``url`` to shut down; False when nothing answered."""
    req = urllib.request.Request(f"{url}/api/shutdown", data=b"{}", method="POST")
    try:
        with urllib.request.urlopen(req, timeout=2):
            return True
    except OSError:
        return False
```

- [ ] **Step 4: Rewrite `python/geomcore_viewer/__main__.py`**

```python
"""Command line: ``python -m geomcore_viewer serve|stop`` (installed as ``geomcore-viewer``)."""

from __future__ import annotations

import argparse
import webbrowser

from .server import DEFAULT_PORT, Server
from .spawn import stop_server


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="geomcore-viewer")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="serve the viewer in the foreground")
    serve.add_argument("--dir", default=None, help="frontend directory (default: the bundled build)")
    serve.add_argument("--port", type=int, default=DEFAULT_PORT)
    serve.add_argument("--no-browser", action="store_true")
    stop = commands.add_parser("stop", help="stop a running viewer server")
    stop.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)

    if args.command == "serve":
        server = Server(args.dir, args.port)
        print(f"geomcore-viewer at {server.url} (Ctrl-C to stop)", flush=True)
        if not args.no_browser:
            webbrowser.open(server.url)
        try:
            server.httpd.serve_forever()
        except KeyboardInterrupt:
            pass  # Ctrl-C is the documented way to stop a foreground server
        finally:
            server.httpd.server_close()
    else:
        url = f"http://127.0.0.1:{args.port}"
        print(f"stopped {url}" if stop_server(url) else f"no viewer running at {url}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Packaging — `python/pyproject.toml`, bundle script, `.gitignore`**

`python/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=77"]
build-backend = "setuptools.build_meta"

[project]
name = "geomcore-viewer"
version = "0.2.0"
description = "Live, geometry-aware browser viewer for geomcore: Python client + local server. Stdlib only."
requires-python = ">=3.9"
license = "MIT OR Apache-2.0"

[project.scripts]
geomcore-viewer = "geomcore_viewer.__main__:main"

[tool.setuptools.packages.find]
where = ["."]
include = ["geomcore_viewer*"]

[tool.setuptools.package-data]
geomcore_viewer = ["_frontend/*", "_frontend/**/*"]
```

`scripts/bundle-frontend.sh`:

```sh
#!/usr/bin/env sh
# Build the frontend and copy it into the Python package (shipped in the wheel).
set -eu
cd "$(dirname "$0")/.."
(cd frontend && npm run build)
rm -rf python/geomcore_viewer/_frontend
cp -r frontend/dist python/geomcore_viewer/_frontend
echo "bundled frontend into python/geomcore_viewer/_frontend"
```

Run `chmod +x scripts/bundle-frontend.sh`. Append to `.gitignore`:

```
build/
python/geomcore_viewer/_frontend/
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_spawn.py python/tests/test_server.py -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add python/geomcore_viewer/spawn.py python/geomcore_viewer/__main__.py python/pyproject.toml scripts/bundle-frontend.sh .gitignore python/tests/test_spawn.py
git commit -m "spawn: find-or-start a detached viewer server; serve/stop CLI; frontend in wheel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `Viewer`, `Handle`, module-level `add`

**Files:**
- Rewrite: `python/geomcore_viewer/viewer.py`
- Rewrite: `python/geomcore_viewer/__init__.py`
- Create: `python/tests/test_viewer.py`

**Interfaces:**
- Consumes: `adapt.to_objects`, `adapt.as_vec`, `adapt.subscript`, `adapt.scene_extent`, `adapt.with_window`, `adapt.SURFACE_TYPES`; `spawn.ensure_server`, `spawn.probe`; `server.DEFAULT_PORT`, `server.PROTOCOL`.
- Produces (`geomcore_viewer`): `Viewer(title="", *, view="auto", keep=False, url="http://127.0.0.1:8765", open_browser=True, spawn=True)` with `.add(*objs, label=None, group=None, u=None, v=None, color=None, width=None, dashed=None, opacity=None, **extras) -> Handle | list[Handle]`, `.polyline(points, **kw)`, `.mesh(vertices, indices, **kw)`, `.arrow(at, vec, **kw)`, `.text(at, text, **kw)`, `.clear()`, `.scene() -> dict`, `.save(path) -> Path`, `.open()`, attributes `.run`, `.objects`, `.url`; `Handle` with `.id`, `.update(**style)`, `.remove()`; module functions `add(*objs, **kw)`, `clear()`, `viewer() -> Viewer`; `PALETTE` tuple.

- [ ] **Step 1: Write the failing tests**

Create `python/tests/test_viewer.py`:

```python
import json
import math
import socket
import urllib.request
import warnings

import pytest

import geomcore_viewer as gv
from geomcore_viewer import PALETTE, Server, Viewer


class Point3D:
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


class Plane:
    def eval_point(self, u, v):
        return Point3D(u, v, 0.0)


@pytest.fixture
def server(tmp_path):
    srv = Server(tmp_path, port=0).start()
    yield srv
    srv.stop()


def _scene(server):
    with urllib.request.urlopen(f"{server.url}/api/scene", timeout=5) as res:
        return json.loads(res.read())


def _ids(server):
    return [o["id"] for o in _scene(server)["objects"]]


def make(server, **kw):
    return Viewer(url=server.url, open_browser=False, **kw)


def test_add_streams_point_with_label_and_palette_color(server):
    view = make(server, title="demo")
    handle = view.add(Point3D(1, 2, 3), label="A")
    scene = _scene(server)
    assert handle.id == "A"
    [obj] = scene["objects"]
    assert obj["geom"] == {"type": "point", "p": [1.0, 2.0, 3.0]}
    assert obj["label"] == "A" and obj["source"] == "Point3D"
    assert obj["style"]["color"] == PALETTE[0]
    assert scene["title"] == "demo" and scene["run"] == view.run


def test_same_label_updates_in_place_and_keeps_color(server):
    view = make(server)
    view.add(Point3D(0, 0), label="x")
    view.add(Point3D(9, 9), label="other")
    view.add(Point3D(1, 0), label="x")
    objs = {o["id"]: o for o in _scene(server)["objects"]}
    assert list(objs) == ["x", "other"]
    assert objs["x"]["geom"]["p"] == [1.0, 0.0, 0.0]
    assert objs["x"]["style"]["color"] == PALETTE[0]


def test_relabelled_result_drops_stale_members(server):
    view = make(server)
    view.add(("points", [Point3D(0, 0), Point3D(1, 0)]), label="P")
    assert _ids(server) == ["P₁", "P₂"]
    view.add(("empty", None), label="P")
    [note] = _scene(server)["objects"]
    assert note["id"] == "P·note" and note["geom"]["text"] == "P: ∅" and "style" not in note


def test_several_objects_get_subscripted_labels(server):
    handles = make(server).add(Point3D(0, 0), Point3D(1, 1), label="Q")
    assert [h.id for h in handles] == ["Q₁", "Q₂"]


def test_unlabelled_objects_get_unique_ids(server):
    view = make(server)
    a, b = view.add(Point3D(0, 0)), view.add(Point3D(1, 0))
    assert a.id != b.id and _ids(server) == [a.id, b.id]


def test_new_viewer_replaces_scene_and_keep_accumulates(server):
    make(server).add(Point3D(0, 0), label="a")
    make(server).add(Point3D(0, 0), label="b")
    assert _ids(server) == ["b"]
    make(server, keep=True).add(Point3D(0, 0), label="c")
    assert _ids(server) == ["b", "c"]


def test_handle_update_and_remove(server):
    view = make(server)
    handle = view.add(Point3D(0, 0), label="a")
    handle.update(color="#000000", width=4)
    assert _scene(server)["objects"][0]["style"] == {"color": "#000000", "width": 4}
    with pytest.raises(TypeError, match="colour"):
        handle.update(colour="red")
    handle.remove()
    assert _ids(server) == []


def test_remove_label_with_special_characters(server):
    view = make(server)
    handle = view.add(Point3D(0, 0), label="a/b c₁")
    assert _ids(server) == ["a/b c₁"]
    handle.remove()
    assert _ids(server) == []


def test_surface_gets_default_window_from_scene(server):
    view = make(server)
    view.add(Point3D(2, 0, 0))
    view.add(Plane(), label="pl")
    plane = _scene(server)["objects"][1]
    assert plane["geom"]["window"] == {"u": [-3.0, 3.0], "v": [-3.0, 3.0]}
    view.add(Plane(), label="pl", u=(0, 1))
    assert _scene(server)["objects"][1]["geom"]["window"]["u"] == [0.0, 1.0]


def test_extras_are_validated(server):
    view = make(server)
    view.add(Point3D(0, 0), label="a", foci=True)
    assert _scene(server)["objects"][0]["extras"] == {"foci": True}
    with pytest.raises(TypeError, match="colour"):
        view.add(Point3D(0, 0), colour="red")


def test_nan_geometry_is_rejected(server):
    with pytest.raises(ValueError, match="bad.*NaN"):
        make(server).add(Point3D(math.nan, 0), label="bad")
    assert _ids(server) == []


def test_escape_hatches_coerce_inputs(server):
    view = make(server)
    view.polyline(((0, 0), (1, 1)), label="pl")
    view.mesh([(0, 0, 0), (1, 0, 0), (0, 1, 0)], (i for i in range(3)), label="m")
    view.arrow((0, 0, 0), Point3D(1, 0, 0), label="ar")
    view.text([1, 1], 42, label="tx")
    geoms = {o["id"]: o["geom"] for o in _scene(server)["objects"]}
    assert geoms["pl"] == {"type": "polyline", "points": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}
    assert geoms["m"]["indices"] == [0, 1, 2]
    assert geoms["ar"] == {"type": "arrow", "at": [0.0, 0.0, 0.0], "vec": [1.0, 0.0, 0.0]}
    assert geoms["tx"] == {"type": "text", "at": [1.0, 1.0, 0.0], "text": "42"}


def test_offline_buffers_warns_once_then_flushes(tmp_path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    view = Viewer(url=f"http://127.0.0.1:{port}", open_browser=False, spawn=False)
    with pytest.warns(RuntimeWarning, match="no geomcore-viewer"):
        view.add(Point3D(0, 0), label="a")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        view.add(Point3D(1, 0), label="b")
    saved = json.loads(view.save(tmp_path / "s.json").read_text())
    assert saved["version"] == 2 and [o["id"] for o in saved["objects"]] == ["a", "b"]
    srv = Server(tmp_path, port=port).start()
    try:
        view.add(Point3D(2, 0), label="c")
        assert _ids(srv) == ["a", "b", "c"]
    finally:
        srv.stop()


def test_module_level_add_uses_latest_viewer(server):
    view = make(server)
    gv.add(Point3D(0, 0), label="m")
    assert gv.viewer() is view and _ids(server) == ["m"]
    gv.clear()
    assert _ids(server) == []


def test_argument_errors(server):
    with pytest.raises(TypeError):
        make(server).add()
    with pytest.raises(ValueError):
        Viewer(view="4d")
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests/test_viewer.py -q`
Expected: FAIL — `ImportError: cannot import name 'PALETTE'`.

- [ ] **Step 3: Rewrite `python/geomcore_viewer/viewer.py`**

```python
"""Client: add geometry to the live viewer page, or save it as a scene file."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
import uuid
import warnings
import webbrowser
from pathlib import Path
from urllib.parse import quote

from .adapt import SURFACE_TYPES, as_vec, scene_extent, subscript, to_objects, with_window
from .server import DEFAULT_PORT, PROTOCOL
from .spawn import ensure_server, probe

# Categorical palette that stays readable on a projector, light or dark background.
PALETTE = ("#d1495b", "#00798c", "#edae49", "#30638e", "#6a4c93", "#2a9d8f", "#e76f51", "#3d405b")
STYLE_KEYS = ("color", "width", "dashed", "opacity")
EXTRA_KEYS = frozenset({"foci", "center", "axes", "asymptotes", "directrix", "vertex", "isolines", "wire"})
VIEWS = ("auto", "2d", "3d")

_default: Viewer | None = None


class Handle:
    """One object in the scene, as returned by :meth:`Viewer.add`."""

    def __init__(self, viewer: Viewer, object_id: str) -> None:
        self.viewer = viewer
        self.id = object_id

    def update(self, **style) -> None:
        """Change ``color``, ``width``, ``dashed`` or ``opacity`` in place."""
        self.viewer._restyle(self.id, style)

    def remove(self) -> None:
        self.viewer._remove(self.id)

    def __repr__(self) -> str:
        return f"Handle({self.id!r})"


class Viewer:
    """A live scene in the browser viewer.

    Every :meth:`add` appears immediately in the open tab. A new ``Viewer``
    (re-running a script) starts a new *run*: the tab swaps to it on its
    first object unless ``keep=True``. The most recently created viewer is
    the default target of the module-level :func:`add`, so ``gv.add(x)`` at
    a ``pdb`` prompt lands in the script's scene.
    """

    def __init__(
        self,
        title: str = "",
        *,
        view: str = "auto",
        keep: bool = False,
        url: str = f"http://127.0.0.1:{DEFAULT_PORT}",
        open_browser: bool = True,
        spawn: bool = True,
    ) -> None:
        global _default
        if view not in VIEWS:
            raise ValueError(f"view must be one of {VIEWS}, got {view!r}")
        self.title, self.view, self.keep = title, view, keep
        self.url = url.rstrip("/")
        self.open_browser, self.spawn = open_browser, spawn
        self.run = uuid.uuid4().hex[:12]
        self.objects: dict[str, dict] = {}
        self._families: dict[str, list[str]] = {}  # label → ids its last add produced
        self._unsent: list[str] = []
        self._run_sent = False
        self._online: bool | None = None  # None until the first send
        self._warned = False
        self._next_color = 0
        self._next_auto = 0
        _default = self

    # -- adding ------------------------------------------------------------
    def add(self, *objs, label: str | None = None, group: str | None = None, u=None, v=None, **options):
        """Show geomcore objects, intersection results, points, or lists of them.

        Style: ``color``, ``width``, ``dashed``, ``opacity``. Curve extras:
        ``foci``, ``center``, ``axes``, ``asymptotes``, ``directrix``,
        ``vertex``; surface extras ``isolines``, ``wire``; ``u=``/``v=``
        set a surface's parameter window. Re-adding a ``label`` replaces
        what that label showed before.
        """
        if not objs:
            raise TypeError("add() needs at least one object")
        parts: list[dict] = []
        for i, obj in enumerate(objs, start=1):
            part_label = label if len(objs) == 1 or label is None else f"{label}{subscript(i)}"
            parts += to_objects(obj, part_label, u=u, v=v)
        return self._commit(parts, label, group, options, u, v)

    def polyline(self, points, *, label: str | None = None, group: str | None = None, **options):
        geom = {"type": "polyline", "points": [as_vec(p) for p in points]}
        return self._commit([{"label": label, "geom": geom}], label, group, options)

    def mesh(self, vertices, indices, *, label: str | None = None, group: str | None = None, **options):
        geom = {"type": "mesh", "vertices": [as_vec(p) for p in vertices], "indices": [int(i) for i in indices]}
        return self._commit([{"label": label, "geom": geom}], label, group, options)

    def arrow(self, at, vec, *, label: str | None = None, group: str | None = None, **options):
        geom = {"type": "arrow", "at": as_vec(at), "vec": as_vec(vec)}
        return self._commit([{"label": label, "geom": geom}], label, group, options)

    def text(self, at, text, *, label: str | None = None, group: str | None = None, **options):
        geom = {"type": "text", "at": as_vec(at), "text": str(text)}
        return self._commit([{"label": label, "geom": geom}], label, group, options)

    def _commit(self, parts: list[dict], label, group, options: dict, u=None, v=None):
        style = {k: options.pop(k) for k in STYLE_KEYS if k in options and options[k] is not None}
        for k in STYLE_KEYS:
            options.pop(k, None)
        unknown = set(options) - EXTRA_KEYS
        if unknown:
            raise TypeError(f"unexpected keyword argument(s): {', '.join(sorted(unknown))}")
        objects = [self._build(part, style, group, options, u, v) for part in parts]
        for obj in objects:
            self.objects[obj["id"]] = obj
            self._unsent.append(obj["id"])
        ids = [obj["id"] for obj in objects]
        if label is not None:
            for stale in self._families.get(label, []):
                if stale not in ids:
                    self._remove(stale)
            self._families[label] = ids
        self._flush()
        handles = [Handle(self, i) for i in ids]
        return handles[0] if len(handles) == 1 else handles

    def _build(self, part: dict, style: dict, group, extras: dict, u, v) -> dict:
        geom = part["geom"]
        object_id = part.get("key") or part["label"] or self._auto_id()
        if geom["type"] in SURFACE_TYPES:
            others = (o["geom"] for o in self.objects.values() if o["id"] != object_id)
            geom = with_window(geom, scene_extent(others), u, v)
        try:
            json.dumps(geom, allow_nan=False)
        except ValueError:
            raise ValueError(f"{object_id}: geometry has NaN or infinite values") from None
        obj: dict = {"id": object_id, "geom": geom}
        if part["label"]:
            obj["label"] = part["label"]
        if part.get("source"):
            obj["source"] = part["source"]
        if group:
            obj["group"] = group
        if geom["type"] != "note":
            previous = self.objects.get(object_id, {}).get("style", {})
            obj["style"] = {"color": previous.get("color") or self._color(), **style}
        if extras:
            obj["extras"] = dict(extras)
        return obj

    def _color(self) -> str:
        color = PALETTE[self._next_color % len(PALETTE)]
        self._next_color += 1
        return color

    def _auto_id(self) -> str:
        self._next_auto += 1
        return f"{self.run[:6]}-{self._next_auto}"

    # -- changing and removing -------------------------------------------------
    def _restyle(self, object_id: str, style: dict) -> None:
        unknown = set(style) - set(STYLE_KEYS)
        if unknown:
            raise TypeError(f"unexpected style keyword(s): {', '.join(sorted(unknown))}")
        if object_id not in self.objects:
            raise KeyError(f"{object_id!r} is no longer in the scene")
        self.objects[object_id].setdefault("style", {}).update(style)
        self._unsent.append(object_id)
        self._flush()

    def _remove(self, object_id: str) -> None:
        self.objects.pop(object_id, None)
        self._unsent = [i for i in self._unsent if i != object_id]
        if self._run_sent and self._connect():
            self._request("DELETE", f"/api/objects/{quote(object_id, safe='')}", missing_ok=True)

    def clear(self) -> None:
        """Empty the scene, here and in the open tab."""
        self.objects.clear()
        self._families.clear()
        self._unsent.clear()
        if self._connect():
            self._request("POST", "/api/clear", {})

    # -- persistence -----------------------------------------------------------
    def scene(self) -> dict:
        return {"version": PROTOCOL, "title": self.title, "run": self.run, "view": self.view,
                "objects": list(self.objects.values())}

    def save(self, path: str | Path) -> Path:
        """Write the scene as JSON (open it with ``?scene=`` or drag-drop it on the page)."""
        out = Path(path)
        out.write_text(json.dumps(self.scene(), allow_nan=False))
        return out

    def open(self) -> None:
        """Open the viewer page in the browser (e.g. after closing the tab)."""
        webbrowser.open(self.url)

    # -- transport -------------------------------------------------------------
    def _flush(self) -> None:
        if not self._unsent or not self._connect():
            return
        ids = list(dict.fromkeys(self._unsent))
        batch: dict = {"objects": [self.objects[i] for i in ids if i in self.objects],
                       "title": self.title, "view": self.view}
        if not self._run_sent:
            batch.update(run=self.run, keep=self.keep)
        if self._request("POST", "/api/objects", batch):
            self._run_sent = True
            self._unsent.clear()

    def _connect(self) -> bool:
        if self._online:
            return True
        if self._online is None and self.spawn:
            started = ensure_server(self.url)
            self._online = True
            if started:
                print(f"geomcore-viewer: {self.url}")
                if self.open_browser:
                    webbrowser.open(self.url)
            return True
        self._online = probe(self.url) == "ours"
        if not self._online:
            self._warn(f"no geomcore-viewer at {self.url}; keeping objects locally (save() still works)")
        return self._online

    def _request(self, method: str, path: str, body: dict | None = None, missing_ok: bool = False) -> bool:
        data = None if body is None else json.dumps(body, allow_nan=False).encode()
        req = urllib.request.Request(f"{self.url}{path}", data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5):
                return True
        except urllib.error.HTTPError as err:
            if missing_ok and err.code == 404:
                return True
            raise RuntimeError(f"geomcore-viewer rejected {method} {path}: {err.read().decode(errors='replace')}") from err
        except OSError as err:
            self._online = False
            self._warn(f"geomcore-viewer at {self.url} is unreachable ({err}); keeping objects locally")
            return False

    def _warn(self, message: str) -> None:
        if not self._warned:
            self._warned = True
            warnings.warn(message, RuntimeWarning, stacklevel=4)


def viewer() -> Viewer:
    """The default viewer: the most recently created one, else a new one."""
    return _default if _default is not None else Viewer()


def add(*objs, **kwargs):
    """``viewer().add(...)`` — one line at a ``pdb`` prompt, a REPL or a notebook cell."""
    return viewer().add(*objs, **kwargs)


def clear() -> None:
    viewer().clear()
```

- [ ] **Step 4: Rewrite `python/geomcore_viewer/__init__.py`**

```python
"""geomcore-viewer: a live, geometry-aware browser viewer for geomcore."""

from .sampling import sample_curve, sample_surface_grid
from .server import Server
from .viewer import PALETTE, Handle, Viewer, add, clear, viewer

__all__ = [
    "PALETTE",
    "Handle",
    "Server",
    "Viewer",
    "add",
    "clear",
    "sample_curve",
    "sample_surface_grid",
    "viewer",
]
```

- [ ] **Step 5: Run the whole Python suite**

Run: `PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests -q`
Expected: all pass, no warnings other than the one `pytest.warns` captures.

- [ ] **Step 6: Commit**

```bash
git add python/geomcore_viewer/viewer.py python/geomcore_viewer/__init__.py python/tests/test_viewer.py
git commit -m "Viewer v2: add/handles/runs, label families, buffering, module-level gv.add

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend geometry core — vectors, types, evaluators vs. golden fixtures

**Files:**
- Modify: `frontend/package.json` (add vitest, `test` script)
- Create: `frontend/src/geom/vec.ts`, `frontend/src/geom/types.ts`, `frontend/src/geom/curves.ts`, `frontend/src/geom/surfaces.ts`
- Create: `frontend/test/fixtures/curves_analytic.json`, `frontend/test/fixtures/surfaces_analytic.json` (copied)
- Create: `scripts/refresh-fixtures.sh` (executable)
- Create: `frontend/test/eval.test.ts`

**Interfaces:**
- Produces (`geom/vec.ts`): `type Vec3 = [number, number, number]`; `interface Frame { o; x; y; z: Vec3 }`; `interface Box { min: Vec3; max: Vec3 }`; `add, sub, scale(a, s), dot, cross, norm, inFrame(f, cx, cy, cz = 0)`.
- Produces (`geom/types.ts`): `Range = [number, number]`; `Window { u?: Range; v?: Range }`; `CurveGeom`, `SurfaceGeom`, `MarkerGeom`, `Geom` unions (fields exactly as SCENE.md; curves have optional `range`, surfaces optional `window`); `CURVE_TYPES`, `SURFACE_TYPES: ReadonlySet<string>`; `isCurve(g): g is CurveGeom`, `isSurface(g): g is SurfaceGeom`.
- Produces (`geom/curves.ts`): `evalCurve(g: CurveGeom, t: number): Vec3`; `curveRange(g: CurveGeom, box: Box): Range`.
- Produces (`geom/surfaces.ts`): `evalSurface(g: SurfaceGeom, u: number, v: number): Vec3`; `naturalWindow(g): { u: Range | null; v: Range | null }`; `surfaceWindow(g, fallbackHalf: number): { u: Range; v: Range; assumed: boolean }`.

- [ ] **Step 1: Add vitest and vendor the fixtures**

```bash
cd frontend && npm install --save-dev vitest@^3.2.0 && cd ..
```

In `frontend/package.json` `scripts`, add `"test": "vitest run"`.

Create `scripts/refresh-fixtures.sh`:

```sh
#!/usr/bin/env sh
# Copy geomcore's golden fixtures used by the frontend evaluator tests.
# Usage: scripts/refresh-fixtures.sh [path/to/geomcore/tests/fixtures]
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../../geomcore/tests/fixtures}"
dst="$here/../frontend/test/fixtures"
mkdir -p "$dst"
cp "$src/curves_analytic.json" "$src/surfaces_analytic.json" "$dst/"
echo "copied fixtures from $src"
```

Run `chmod +x scripts/refresh-fixtures.sh && scripts/refresh-fixtures.sh`.

- [ ] **Step 2: Write the failing evaluator tests**

Create `frontend/test/eval.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import curves from "./fixtures/curves_analytic.json";
import surfaces from "./fixtures/surfaces_analytic.json";
import { curveRange, evalCurve } from "../src/geom/curves";
import { evalSurface, surfaceWindow } from "../src/geom/surfaces";
import type { CurveGeom, SurfaceGeom } from "../src/geom/types";
import { Box, Frame, Vec3, norm, sub } from "../src/geom/vec";

type FxFrame = { origin: Vec3; x_dir: Vec3; y_dir: Vec3; z_dir: Vec3 };
type CurveSample = { u: number; point: Vec3 };
type SurfaceSample = { u: number; v: number; point: Vec3 };
const frame = (f: FxFrame): Frame => ({ o: f.origin, x: f.x_dir, y: f.y_dir, z: f.z_dir });

function expectClose(got: Vec3, want: Vec3): void {
  expect(norm(sub(got, want))).toBeLessThanOrEqual(1e-9 * Math.max(1, norm(want)));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const curveCases: [string, CurveGeom, CurveSample[]][] = [
  ...curves.lines.map((c: any): [string, CurveGeom, CurveSample[]] => ["line", { type: "line", o: c.origin, d: c.direction }, c.samples]),
  ...curves.circles.map((c: any): [string, CurveGeom, CurveSample[]] => ["circle", { type: "circle", frame: frame(c.frame), r: c.radius }, c.samples]),
  ...curves.ellipses.map((c: any): [string, CurveGeom, CurveSample[]] => ["ellipse", { type: "ellipse", frame: frame(c.frame), a: c.major_radius, b: c.minor_radius }, c.samples]),
  ...curves.parabolas.map((c: any): [string, CurveGeom, CurveSample[]] => ["parabola", { type: "parabola", frame: frame(c.frame), f: c.focal }, c.samples]),
  ...curves.hyperbolas.map((c: any): [string, CurveGeom, CurveSample[]] => ["hyperbola", { type: "hyperbola", frame: frame(c.frame), a: c.major_radius, b: c.minor_radius }, c.samples]),
];

const surfaceCases: [string, SurfaceGeom, SurfaceSample[]][] = [
  ...surfaces.planes.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["plane", { type: "plane", frame: frame(c.frame) }, c.samples]),
  ...surfaces.cylinders.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["cylinder", { type: "cylinder", frame: frame(c.frame), r: c.radius }, c.samples]),
  ...surfaces.cones.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["cone", { type: "cone", frame: frame(c.frame), semi_angle: c.semi_angle, ref_radius: c.ref_radius }, c.samples]),
  ...surfaces.spheres.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["sphere", { type: "sphere", frame: frame(c.frame), r: c.radius }, c.samples]),
  ...surfaces.tori.map((c: any): [string, SurfaceGeom, SurfaceSample[]] => ["torus", { type: "torus", frame: frame(c.frame), R: c.major_radius, r: c.minor_radius }, c.samples]),
];
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("evalCurve matches geomcore goldens", () => {
  it.each(curveCases)("%s", (_name, g, samples) => {
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expectClose(evalCurve(g, s.u), s.point);
  });
});

describe("evalSurface matches geomcore goldens", () => {
  it.each(surfaceCases)("%s", (_name, g, samples) => {
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expectClose(evalSurface(g, s.u, s.v), s.point);
  });
});

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const unitBox: Box = { min: [-1, -1, -1], max: [1, 1, 1] };
const inBox = (p: Vec3, b: Box) => p.every((c, i) => c >= b.min[i] && c <= b.max[i]);

describe("curveRange", () => {
  it("covers a box far from a line's origin", () => {
    const [t0, t1] = curveRange({ type: "line", o: [100, 0, 0], d: [1, 0, 0] }, unitBox);
    expect(t0).toBeLessThanOrEqual(-101);
    expect(t1).toBeGreaterThanOrEqual(-99);
  });

  it.each<CurveGeom>([
    { type: "parabola", frame: world, f: 0.25 },
    { type: "hyperbola", frame: { ...world, o: [-1.5, 0, 0] }, a: 1, b: 0.5 },
  ])("leaves the box just outside its range (%#)", (g) => {
    const [t0, t1] = curveRange(g, unitBox);
    expect(inBox(evalCurve(g, t1 * 1.01 + 1e-6), unitBox)).toBe(false);
    expect(inBox(evalCurve(g, t0 * 1.01 - 1e-6), unitBox)).toBe(false);
  });

  it("uses full periods and explicit ranges", () => {
    expect(curveRange({ type: "circle", frame: world, r: 1 }, unitBox)).toEqual([0, 2 * Math.PI]);
    expect(curveRange({ type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [2, 3] }, unitBox)).toEqual([2, 3]);
  });
});

describe("surfaceWindow", () => {
  it("fills full periods and flags assumed infinite directions", () => {
    expect(surfaceWindow({ type: "sphere", frame: world, r: 1 }, 5)).toEqual({ u: [0, 2 * Math.PI], v: [-Math.PI / 2, Math.PI / 2], assumed: false });
    expect(surfaceWindow({ type: "plane", frame: world }, 5)).toEqual({ u: [-5, 5], v: [-5, 5], assumed: true });
    expect(surfaceWindow({ type: "cylinder", frame: world, r: 1, window: { v: [0, 2] } }, 5)).toEqual({ u: [0, 2 * Math.PI], v: [0, 2], assumed: false });
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd frontend && npx vitest run test/eval.test.ts`
Expected: FAIL — cannot resolve `../src/geom/curves`.

- [ ] **Step 4: Write the geometry modules**

`frontend/src/geom/vec.ts`:

```ts
export type Vec3 = [number, number, number];

/** Right-handed orthonormal frame: origin plus unit axes (protocol `frame`). */
export interface Frame {
  o: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** `o + cx·x + cy·y + cz·z` — every analytic parametrization has this shape. */
export function inFrame(f: Frame, cx: number, cy: number, cz = 0): Vec3 {
  return [
    f.o[0] + cx * f.x[0] + cy * f.y[0] + cz * f.z[0],
    f.o[1] + cx * f.x[1] + cy * f.y[1] + cz * f.z[1],
    f.o[2] + cx * f.x[2] + cy * f.y[2] + cz * f.z[2],
  ];
}
```

`frontend/src/geom/types.ts`:

```ts
import type { Frame, Vec3 } from "./vec";

export type Range = [number, number];

export interface Window {
  u?: Range;
  v?: Range;
}

export type CurveGeom =
  | { type: "line"; o: Vec3; d: Vec3; range?: Range }
  | { type: "circle"; frame: Frame; r: number; range?: Range }
  | { type: "ellipse"; frame: Frame; a: number; b: number; range?: Range }
  | { type: "parabola"; frame: Frame; f: number; range?: Range }
  | { type: "hyperbola"; frame: Frame; a: number; b: number; range?: Range };

export type SurfaceGeom =
  | { type: "plane"; frame: Frame; window?: Window }
  | { type: "cylinder"; frame: Frame; r: number; window?: Window }
  | { type: "cone"; frame: Frame; semi_angle: number; ref_radius: number; window?: Window }
  | { type: "sphere"; frame: Frame; r: number; window?: Window }
  | { type: "torus"; frame: Frame; R: number; r: number; window?: Window };

export type MarkerGeom =
  | { type: "polyline"; points: Vec3[] }
  | { type: "mesh"; vertices: Vec3[]; indices: number[] }
  | { type: "point"; p: Vec3 }
  | { type: "points"; positions: Vec3[]; size?: number }
  | { type: "arrow"; at: Vec3; vec: Vec3 }
  | { type: "text"; at: Vec3; text: string }
  | { type: "note"; text: string; level?: "info" | "warn" };

export type Geom = CurveGeom | SurfaceGeom | MarkerGeom;

export const CURVE_TYPES: ReadonlySet<string> = new Set(["line", "circle", "ellipse", "parabola", "hyperbola"]);
export const SURFACE_TYPES: ReadonlySet<string> = new Set(["plane", "cylinder", "cone", "sphere", "torus"]);

export const isCurve = (g: Geom): g is CurveGeom => CURVE_TYPES.has(g.type);
export const isSurface = (g: Geom): g is SurfaceGeom => SURFACE_TYPES.has(g.type);
```

`frontend/src/geom/curves.ts`:

```ts
import type { CurveGeom, Range } from "./types";
import { Box, Vec3, add, dot, inFrame, norm, scale, sub } from "./vec";

const TAU = 2 * Math.PI;

/** Point at parameter `t` — formulas identical to geomcore (protocol/SCENE.md). */
export function evalCurve(g: CurveGeom, t: number): Vec3 {
  switch (g.type) {
    case "line":
      return add(g.o, scale(g.d, t));
    case "circle":
      return inFrame(g.frame, g.r * Math.cos(t), g.r * Math.sin(t));
    case "ellipse":
      return inFrame(g.frame, g.a * Math.cos(t), g.b * Math.sin(t));
    case "parabola":
      return inFrame(g.frame, (t * t) / (4 * g.f), t);
    case "hyperbola":
      return inFrame(g.frame, g.a * Math.cosh(t), g.b * Math.sinh(t));
  }
}

/**
 * Parameter interval to draw: the explicit `range`, one full period for
 * closed curves, or — for infinite curves — an interval guaranteed to
 * contain every parameter whose point lies in `box` (the box sits inside a
 * ball of radius `reach` around the curve origin, and each bound below
 * inverts a lower bound on |P(t) − o|).
 */
export function curveRange(g: CurveGeom, box: Box): Range {
  if (g.range) return g.range;
  if (g.type === "circle" || g.type === "ellipse") return [0, TAU];
  const center = scale(add(box.min, box.max), 0.5);
  const radius = norm(sub(box.max, box.min)) / 2;
  if (g.type === "line") {
    const speed = norm(g.d);
    const tc = dot(sub(center, g.o), g.d) / (speed * speed);
    return [tc - radius / speed, tc + radius / speed];
  }
  const reach = norm(sub(center, g.frame.o)) + radius;
  if (g.type === "parabola") return [-reach, reach]; // |P − o| ≥ |t|
  const t = Math.asinh(reach / Math.max(g.a, g.b)); // |P − o| ≥ max(a, b)·sinh|t|
  return [-t, t];
}
```

`frontend/src/geom/surfaces.ts`:

```ts
import type { Range, SurfaceGeom } from "./types";
import { Vec3, inFrame } from "./vec";

const TAU = 2 * Math.PI;

/** Point at `(u, v)` — formulas identical to geomcore (protocol/SCENE.md). */
export function evalSurface(g: SurfaceGeom, u: number, v: number): Vec3 {
  switch (g.type) {
    case "plane":
      return inFrame(g.frame, u, v);
    case "cylinder":
      return inFrame(g.frame, g.r * Math.cos(u), g.r * Math.sin(u), v);
    case "cone": {
      const radius = g.ref_radius + v * Math.sin(g.semi_angle);
      return inFrame(g.frame, radius * Math.cos(u), radius * Math.sin(u), v * Math.cos(g.semi_angle));
    }
    case "sphere": {
      const rc = g.r * Math.cos(v);
      return inFrame(g.frame, rc * Math.cos(u), rc * Math.sin(u), g.r * Math.sin(v));
    }
    case "torus": {
      const rho = g.R + g.r * Math.cos(v);
      return inFrame(g.frame, rho * Math.cos(u), rho * Math.sin(u), g.r * Math.sin(v));
    }
  }
}

/** Full periods of closed parameter directions; null where the surface is infinite. */
export function naturalWindow(g: SurfaceGeom): { u: Range | null; v: Range | null } {
  switch (g.type) {
    case "plane":
      return { u: null, v: null };
    case "cylinder":
    case "cone":
      return { u: [0, TAU], v: null };
    case "sphere":
      return { u: [0, TAU], v: [-Math.PI / 2, Math.PI / 2] };
    case "torus":
      return { u: [0, TAU], v: [0, TAU] };
  }
}

/** Window to tessellate: explicit, else natural, else ±fallbackHalf (`assumed` = a fallback was used). */
export function surfaceWindow(g: SurfaceGeom, fallbackHalf: number): { u: Range; v: Range; assumed: boolean } {
  const natural = naturalWindow(g);
  const fallback: Range = [-fallbackHalf, fallbackHalf];
  const u = g.window?.u ?? natural.u;
  const v = g.window?.v ?? natural.v;
  return { u: u ?? fallback, v: v ?? fallback, assumed: u === null || v === null };
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all tests pass; tsc prints nothing.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/geom frontend/test scripts/refresh-fixtures.sh
git commit -m "frontend geom: analytic evaluators validated against geomcore golden fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend tessellation, bounds, planarity

**Files:**
- Create: `frontend/src/geom/tessellate.ts`, `frontend/src/geom/bounds.ts`, `frontend/src/geom/planar.ts`
- Create: `frontend/test/tessellate.test.ts`

**Interfaces:**
- Consumes: Task 5 `evalCurve`, `curveRange`, `evalSurface`, `surfaceWindow`, `Geom`, `isCurve`, `isSurface`, vec helpers.
- Produces:
  - `tessellate.ts`: `tessellateCurve(g: CurveGeom, box: Box, segments = 256): Vec3[]`; `interface TriMesh { positions: number[]; indices: number[]; assumed: boolean }`; `tessellateSurface(g: SurfaceGeom, fallbackHalf: number, nu = 64, nv = 32): TriMesh`; `arrowPolylines(at: Vec3, vec: Vec3): Vec3[][]`.
  - `bounds.ts`: `sceneBounds(geoms: Iterable<Geom>): Box | null`; `viewBox(geoms: Iterable<Geom>): Box`; `halfSize(box: Box): number`; `sameBox(a: Box, b: Box): boolean`.
  - `planar.ts`: `inPlaneZ0(g: Geom): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/tessellate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { arrowPolylines, tessellateCurve, tessellateSurface } from "../src/geom/tessellate";
import { halfSize, sameBox, sceneBounds, viewBox } from "../src/geom/bounds";
import { inPlaneZ0 } from "../src/geom/planar";
import type { Geom } from "../src/geom/types";
import { Frame } from "../src/geom/vec";

const world: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const tilted: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };

describe("tessellateCurve", () => {
  it("samples a closed circle from t=0 to 2π", () => {
    const pts = tessellateCurve({ type: "circle", frame: world, r: 2 }, viewBox([]), 8);
    expect(pts).toHaveLength(9);
    expect(pts[0][0]).toBeCloseTo(2);
    expect(pts[8][0]).toBeCloseTo(2);
  });

  it("extends a line across the whole view box", () => {
    const pts = tessellateCurve({ type: "line", o: [0, 0, 0], d: [1, 0, 0] }, viewBox([]), 4);
    expect(pts[0][0]).toBeLessThanOrEqual(-5);
    expect(pts[4][0]).toBeGreaterThanOrEqual(5);
  });
});

describe("tessellateSurface", () => {
  it("builds an (nu+1)×(nv+1) grid of triangles", () => {
    const mesh = tessellateSurface({ type: "sphere", frame: world, r: 1 }, 5, 4, 2);
    expect(mesh.positions).toHaveLength(5 * 3 * 3);
    expect(mesh.indices).toHaveLength(4 * 2 * 6);
    expect(mesh.assumed).toBe(false);
    expect(tessellateSurface({ type: "plane", frame: world }, 5, 2, 2).assumed).toBe(true);
  });
});

describe("arrowPolylines", () => {
  it("draws a shaft from at to at+vec plus two head strokes", () => {
    const lines = arrowPolylines([0, 0, 0], [0, 0, 2]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual([[0, 0, 0], [0, 0, 2]]);
    for (const head of lines.slice(1)) expect(head[0]).toEqual([0, 0, 2]);
  });
});

describe("bounds", () => {
  it("covers finite geometry and only the origin of infinite curves", () => {
    const geoms: Geom[] = [
      { type: "circle", frame: { ...world, o: [1, 0, 0] }, r: 2 },
      { type: "point", p: [0, 4, 0] },
      { type: "line", o: [0, 0, -1], d: [1, 0, 0] },
      { type: "note", text: "hi" },
    ];
    expect(sceneBounds(geoms)).toEqual({ min: [-1, -2, -2], max: [3, 4, 2] });
    expect(sceneBounds([{ type: "note", text: "x" }])).toBeNull();
  });

  it("grows the scene box ×1.5 into a cube, or falls back to ±5", () => {
    expect(viewBox([])).toEqual({ min: [-5, -5, -5], max: [5, 5, 5] });
    const box = viewBox([{ type: "point", p: [0, 0, 0] }, { type: "point", p: [2, 0, 0] }]);
    expect(box).toEqual({ min: [-0.5, -1.5, -1.5], max: [2.5, 1.5, 1.5] });
    expect(halfSize(box)).toBe(1.5);
    expect(sameBox(box, viewBox([{ type: "point", p: [2, 0, 0] }, { type: "point", p: [0, 0, 0] }]))).toBe(true);
  });
});

describe("inPlaneZ0", () => {
  it.each<[Geom, boolean]>([
    [{ type: "circle", frame: world, r: 1 }, true],
    [{ type: "circle", frame: tilted, r: 1 }, false],
    [{ type: "line", o: [0, 0, 0], d: [1, 1, 0] }, true],
    [{ type: "line", o: [0, 0, 0], d: [0, 0, 1] }, false],
    [{ type: "point", p: [1, 2, 0] }, true],
    [{ type: "polyline", points: [[0, 0, 0], [1, 0, 1e-3]] }, false],
    [{ type: "plane", frame: world }, false],
  ])("%j → %s", (g, want) => {
    expect(inPlaneZ0(g)).toBe(want);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd frontend && npx vitest run test/tessellate.test.ts`
Expected: FAIL — cannot resolve `../src/geom/tessellate`.

- [ ] **Step 3: Write the modules**

`frontend/src/geom/tessellate.ts`:

```ts
import { curveRange, evalCurve } from "./curves";
import { evalSurface, surfaceWindow } from "./surfaces";
import type { CurveGeom, SurfaceGeom } from "./types";
import { Box, Vec3, add, cross, norm, scale, sub } from "./vec";

export interface TriMesh {
  positions: number[];
  indices: number[];
  /** True when an infinite direction had no window and fell back to ±fallbackHalf. */
  assumed: boolean;
}

/** Polyline through the curve, uniform in t over `curveRange(g, box)`. */
export function tessellateCurve(g: CurveGeom, box: Box, segments = 256): Vec3[] {
  const [t0, t1] = curveRange(g, box);
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) points.push(evalCurve(g, t0 + ((t1 - t0) * i) / segments));
  return points;
}

/** Grid triangulation of the surface over its window (same layout as the Python sampler). */
export function tessellateSurface(g: SurfaceGeom, fallbackHalf: number, nu = 64, nv = 32): TriMesh {
  const { u, v, assumed } = surfaceWindow(g, fallbackHalf);
  const positions: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const vj = v[0] + ((v[1] - v[0]) * j) / nv;
    for (let i = 0; i <= nu; i++) positions.push(...evalSurface(g, u[0] + ((u[1] - u[0]) * i) / nu, vj));
  }
  const indices: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const c = a + nu + 1;
      indices.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  return { positions, indices, assumed };
}

/** Shaft plus two head strokes (15 % of the length), in a plane containing the arrow. */
export function arrowPolylines(at: Vec3, vec: Vec3): Vec3[][] {
  const tip = add(at, vec);
  const length = norm(vec);
  if (length === 0) return [[at, tip]];
  const dir = scale(vec, 1 / length);
  const helper: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const side = cross(dir, helper);
  const sideUnit = scale(side, (0.08 * length) / norm(side));
  const back = sub(tip, scale(dir, 0.15 * length));
  return [[at, tip], [tip, add(back, sideUnit)], [tip, sub(back, sideUnit)]];
}
```

`frontend/src/geom/bounds.ts`:

```ts
import { evalSurface, surfaceWindow } from "./surfaces";
import { Geom, isSurface } from "./types";
import { Box, Vec3, add } from "./vec";

const FALLBACK: Box = { min: [-5, -5, -5], max: [5, 5, 5] };

/**
 * Bounding box of everything with a finite extent. Infinite curves add only
 * their origin; surfaces add a coarse sample of their window; notes add nothing.
 */
export function sceneBounds(geoms: Iterable<Geom>): Box | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let found = false;
  const grow = (p: Vec3, pad = 0) => {
    found = true;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i] - pad);
      max[i] = Math.max(max[i], p[i] + pad);
    }
  };
  for (const g of geoms) {
    switch (g.type) {
      case "point": grow(g.p); break;
      case "points": g.positions.forEach((p) => grow(p)); break;
      case "polyline": g.points.forEach((p) => grow(p)); break;
      case "mesh": g.vertices.forEach((p) => grow(p)); break;
      case "arrow": grow(g.at); grow(add(g.at, g.vec)); break;
      case "text": grow(g.at); break;
      case "line": grow(g.o); break;
      case "parabola": case "hyperbola": grow(g.frame.o); break;
      case "circle": grow(g.frame.o, g.r); break;
      case "ellipse": grow(g.frame.o, Math.max(g.a, g.b)); break;
      case "note": break;
      default:
        if (isSurface(g)) {
          const { u, v } = surfaceWindow(g, 5);
          for (let i = 0; i <= 4; i++)
            for (let j = 0; j <= 4; j++)
              grow(evalSurface(g, u[0] + ((u[1] - u[0]) * i) / 4, v[0] + ((v[1] - v[0]) * j) / 4));
        }
    }
  }
  return found ? { min, max } : null;
}

/** Region infinite geometry is drawn in: the scene box grown ×1.5 into a cube (half-size ≥ 1), or ±5. */
export function viewBox(geoms: Iterable<Geom>): Box {
  const b = sceneBounds(geoms);
  if (!b) return FALLBACK;
  const center = b.min.map((m, i) => (m + b.max[i]) / 2) as Vec3;
  const half = Math.max(1, 1.5 * Math.max(...b.min.map((m, i) => (b.max[i] - m) / 2)));
  return { min: center.map((c) => c - half) as Vec3, max: center.map((c) => c + half) as Vec3 };
}

export const halfSize = (b: Box): number => Math.max(...b.min.map((m, i) => (b.max[i] - m) / 2));

export const sameBox = (a: Box, b: Box): boolean =>
  a.min.every((m, i) => m === b.min[i]) && a.max.every((m, i) => m === b.max[i]);
```

`frontend/src/geom/planar.ts`:

```ts
import type { Geom } from "./types";
import type { Vec3 } from "./vec";

const EPS = 1e-9;
const flat = (p: Vec3) => Math.abs(p[2]) < EPS;
const upright = (z: Vec3) => Math.abs(z[0]) < EPS && Math.abs(z[1]) < EPS;

/** True when the geometry lies in the z = 0 plane (drawable in the 2D plane view). */
export function inPlaneZ0(g: Geom): boolean {
  switch (g.type) {
    case "point": return flat(g.p);
    case "points": return g.positions.every(flat);
    case "polyline": return g.points.every(flat);
    case "line": return flat(g.o) && flat(g.d);
    case "circle": case "ellipse": case "parabola": case "hyperbola": return flat(g.frame.o) && upright(g.frame.z);
    case "arrow": return flat(g.at) && flat(g.vec);
    case "text": return flat(g.at);
    case "note": return true;
    default: return false; // surfaces and meshes are 3D
  }
}
```

- [ ] **Step 4: Run tests and type check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all pass, tsc silent.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/geom frontend/test/tessellate.test.ts
git commit -m "frontend geom: tessellation with view-box clipping, scene bounds, z=0 planarity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend protocol v2 (validation, v1 migration) and store (runs)

**Files:**
- Rewrite: `frontend/src/protocol.ts`
- Rewrite: `frontend/src/store.ts`
- Create: `frontend/test/protocol.test.ts`, `frontend/test/store.test.ts`

**Interfaces:**
- Consumes: Task 5 `Geom`, `CURVE_TYPES`, `Vec3`.
- Produces (`protocol.ts`): `PROTOCOL = 2`; `interface Style { color?; width?; dashed?; opacity? }`; `interface SceneObject { id: string; geom: Geom; label?; group?; source?; style?: Style; extras?; meta? }`; `type ViewMode = "auto" | "2d" | "3d"`; `interface SceneDoc { version: 2; title: string; run: string | null; view: ViewMode; objects: SceneObject[] }`; `interface Problem { id: string; message: string }`; `parseObject(raw: unknown): { object: SceneObject } | { problem: Problem }`; `migrateV1(e: Record<string, unknown>): Record<string, unknown>`; `class VersionError extends Error`; `parseDoc(raw: unknown): { doc: SceneDoc; problems: Problem[] }` (throws `VersionError`); `type ServerEvent`.
- Produces (`store.ts`): `type StoreEvent = { type: "reset" } | { type: "upsert"; objects: SceneObject[] } | { type: "remove"; id: string } | { type: "meta" }`; `class Store` with `objects: Map<string, SceneObject>`, `problems: Map<string, Problem>`, `title`, `view`, `run`, `status`, `onChange(h)`, `reset(doc, problems?)`, `apply(ev: ServerEvent)`, `setStatus(text)`, `loadJson(raw, origin)`, `loadUrl(url): Promise<void>`, `load(): Promise<void>`, `clearAll()`.

- [ ] **Step 1: Write the failing tests**

`frontend/test/protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VersionError, parseDoc, parseObject } from "../src/protocol";

const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

describe("parseObject", () => {
  it("accepts a valid analytic object and pads 2D vectors", () => {
    const r = parseObject({ id: "L", label: "L", geom: { type: "line", o: [0, 1], d: [1, 0] } });
    expect(r).toEqual({ object: { id: "L", label: "L", geom: { type: "line", o: [0, 1, 0], d: [1, 0, 0] } } });
  });

  it.each([
    [{ geom: { type: "point", p: [0, 0, 0] } }, "?", "missing string id"],
    [{ id: "a", geom: { type: "foo" } }, "a", 'unknown type "foo"'],
    [{ id: "a", geom: { type: "circle", frame, r: -1 } }, "a", "circle.r must be positive"],
    [{ id: "a", geom: { type: "parabola", frame, f: 0 } }, "a", "parabola.f must be non-zero"],
    [{ id: "a", geom: { type: "ellipse", frame, a: 1 } }, "a", "ellipse.b is missing or malformed"],
    [{ id: "a", geom: { type: "mesh", vertices: [[0, 0, 0]], indices: [0, 0] } }, "a", "mesh.indices must be triangles indexing vertices"],
    [{ id: "a", geom: { type: "line", o: [0, 0, 0], d: [1, 0, 0], range: [1] } }, "a", "line.range must be [t0, t1]"],
    [{ id: "a", geom: { type: "point", p: [0, NaN, 0] } }, "a", "point.p is missing or malformed"],
  ])("rejects %j", (raw, id, message) => {
    expect(parseObject(raw)).toEqual({ problem: { id, message } });
  });
});

describe("parseDoc", () => {
  it("migrates v1 entities", () => {
    const { doc, problems } = parseDoc({
      version: 1,
      entities: [
        { id: "c", kind: "curve2d", name: "pc", color: "#f00", points: [[0, 0], [1, 1]] },
        { id: "s", kind: "surface", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 2], opacity: 0.5 },
        { id: "q", kind: "points3d", positions: [[0, 0, 0]], size: 3 },
        { id: "x", kind: "hologram" },
      ],
    });
    expect(doc.objects[0]).toEqual({ id: "c", label: "pc", style: { color: "#f00" }, geom: { type: "polyline", points: [[0, 0, 0], [1, 1, 0]] } });
    expect(doc.objects[1].style).toEqual({ opacity: 0.5 });
    expect(doc.objects[2].geom).toEqual({ type: "points", positions: [[0, 0, 0]], size: 3 });
    expect(problems).toEqual([{ id: "x", message: 'unknown type "v1:hologram"' }]);
  });

  it("reads v2 metadata and rejects other versions", () => {
    const { doc } = parseDoc({ version: 2, title: "t", run: "r", view: "2d", objects: [] });
    expect(doc).toEqual({ version: 2, title: "t", run: "r", view: "2d", objects: [] });
    expect(() => parseDoc({ version: 3, objects: [] })).toThrow(VersionError);
  });
});
```

`frontend/test/store.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd frontend && npx vitest run test/protocol.test.ts test/store.test.ts`
Expected: FAIL — `parseObject` / `Store.apply` not exported.

- [ ] **Step 3: Rewrite `frontend/src/protocol.ts`**

```ts
// Scene protocol v2: types, validation and v1 migration. Mirrors protocol/SCENE.md.
import { CURVE_TYPES, Geom } from "./geom/types";
import type { Vec3 } from "./geom/vec";

export const PROTOCOL = 2;

export interface Style {
  color?: string;
  width?: number;
  dashed?: boolean;
  opacity?: number;
}

export interface SceneObject {
  id: string;
  geom: Geom;
  label?: string;
  group?: string;
  source?: string;
  style?: Style;
  extras?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export type ViewMode = "auto" | "2d" | "3d";

export interface SceneDoc {
  version: 2;
  title: string;
  run: string | null;
  view: ViewMode;
  objects: SceneObject[];
}

export interface Problem {
  id: string;
  message: string;
}

export type ServerEvent =
  | { type: "run"; run: string; keep: boolean }
  | { type: "upsert"; objects: unknown[]; title?: string; view?: string }
  | { type: "remove"; id: string }
  | { type: "clear" };

type FieldKind = "vec" | "vecs" | "num" | "nums" | "frame" | "str";

const FIELDS: Record<string, Record<string, FieldKind>> = {
  line: { o: "vec", d: "vec" },
  circle: { frame: "frame", r: "num" },
  ellipse: { frame: "frame", a: "num", b: "num" },
  parabola: { frame: "frame", f: "num" },
  hyperbola: { frame: "frame", a: "num", b: "num" },
  plane: { frame: "frame" },
  cylinder: { frame: "frame", r: "num" },
  cone: { frame: "frame", semi_angle: "num", ref_radius: "num" },
  sphere: { frame: "frame", r: "num" },
  torus: { frame: "frame", R: "num", r: "num" },
  polyline: { points: "vecs" },
  mesh: { vertices: "vecs", indices: "nums" },
  point: { p: "vec" },
  points: { positions: "vecs" },
  arrow: { at: "vec", vec: "vec" },
  text: { at: "vec", text: "str" },
  note: { text: "str" },
};
const POSITIVE = ["r", "a", "b", "R"];
const VIEWS: ReadonlySet<string> = new Set(["auto", "2d", "3d"]);

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function asVec(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || (v.length !== 2 && v.length !== 3) || !v.every(finite)) return null;
  return [v[0], v[1], v.length === 3 ? v[2] : 0];
}

function normalize(value: unknown, kind: FieldKind): unknown {
  switch (kind) {
    case "vec":
      return asVec(value);
    case "vecs": {
      if (!Array.isArray(value)) return null;
      const vecs = value.map(asVec);
      return vecs.every((v) => v !== null) ? vecs : null;
    }
    case "num":
      return finite(value) ? value : null;
    case "nums":
      return Array.isArray(value) && value.every((i) => Number.isInteger(i) && i >= 0) ? value : null;
    case "str":
      return typeof value === "string" ? value : null;
    case "frame": {
      if (typeof value !== "object" || value === null) return null;
      const f = value as Record<string, unknown>;
      const axes = ["o", "x", "y", "z"].map((k) => asVec(f[k]));
      return axes.every((a) => a !== null) ? { o: axes[0], x: axes[1], y: axes[2], z: axes[3] } : null;
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const record = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** Validate one object (v1 entities are migrated first). Never throws. */
export function parseObject(raw: unknown): { object: SceneObject } | { problem: Problem } {
  const r = record(raw);
  if (!r) return { problem: { id: "?", message: "object is not a JSON object" } };
  if (typeof r.kind === "string") return parseObject(migrateV1(r));
  const id = typeof r.id === "string" ? r.id : "?";
  const fail = (message: string) => ({ problem: { id, message } });
  if (id === "?") return fail("missing string id");
  const g = record(r.geom);
  if (!g || typeof g.type !== "string") return fail("missing geom.type");
  const fields = FIELDS[g.type];
  if (!fields) return fail(`unknown type "${g.type}"`);
  const geom: Record<string, unknown> = { ...g };
  for (const [key, kind] of Object.entries(fields)) {
    const value = normalize(g[key], kind);
    if (value === null) return fail(`${g.type}.${key} is missing or malformed`);
    geom[key] = value;
  }
  for (const key of POSITIVE) if (key in fields && (geom[key] as number) <= 0) return fail(`${g.type}.${key} must be positive`);
  if (g.type === "parabola" && geom.f === 0) return fail("parabola.f must be non-zero");
  if (g.type === "mesh") {
    const n = (geom.vertices as Vec3[]).length;
    const idx = geom.indices as number[];
    if (idx.length % 3 !== 0 || idx.some((i) => i >= n)) return fail("mesh.indices must be triangles indexing vertices");
  }
  if (CURVE_TYPES.has(g.type) && g.range !== undefined) {
    const range = g.range;
    if (!Array.isArray(range) || range.length !== 2 || !range.every(finite)) return fail(`${g.type}.range must be [t0, t1]`);
  }
  const object: SceneObject = { id, geom: geom as unknown as Geom };
  const label = str(r.label);
  if (label) object.label = label;
  const group = str(r.group);
  if (group) object.group = group;
  const source = str(r.source);
  if (source) object.source = source;
  const style = record(r.style);
  if (style) object.style = style as Style;
  const extras = record(r.extras);
  if (extras) object.extras = extras;
  const meta = record(r.meta);
  if (meta) object.meta = meta;
  return { object };
}

/** v1 entity → v2 object (see SCENE.md "Compatibility"). */
export function migrateV1(e: Record<string, unknown>): Record<string, unknown> {
  const style: Style = {};
  if (typeof e.color === "string") style.color = e.color;
  if (typeof e.opacity === "number") style.opacity = e.opacity;
  const base: Record<string, unknown> = { id: e.id, label: e.name, style };
  switch (e.kind) {
    case "curve3d":
    case "curve2d":
      return { ...base, geom: { type: "polyline", points: e.points } };
    case "surface":
      return { ...base, geom: { type: "mesh", vertices: e.vertices, indices: e.indices } };
    case "points3d":
    case "points2d":
      return { ...base, geom: { type: "points", positions: e.positions, ...(e.size !== undefined ? { size: e.size } : {}) } };
    default:
      return { ...base, geom: { type: `v1:${String(e.kind)}` } };
  }
}

export class VersionError extends Error {}

/** Parse a v1 or v2 document; invalid objects become problems, other versions throw. */
export function parseDoc(raw: unknown): { doc: SceneDoc; problems: Problem[] } {
  const r = record(raw) ?? {};
  const items = r.version === 1 ? r.entities : r.version === PROTOCOL ? r.objects : undefined;
  if (!Array.isArray(items)) throw new VersionError(`unsupported scene version ${String(r.version)} (this viewer reads 1 and 2)`);
  const objects: SceneObject[] = [];
  const problems: Problem[] = [];
  for (const item of items) {
    const parsed = parseObject(item);
    if ("object" in parsed) objects.push(parsed.object);
    else problems.push(parsed.problem);
  }
  const view = typeof r.view === "string" && VIEWS.has(r.view) ? (r.view as ViewMode) : "auto";
  return { doc: { version: 2, title: str(r.title) ?? "", run: str(r.run) ?? null, view, objects }, problems };
}
```

In the migration `base.label` is `undefined` when `name` is absent; `parseObject` drops it via `str()`. The v1 test's first object has `style: { color: "#f00" }` and no `opacity` key — `migrateV1` only sets keys that exist, matching the expectation. The `"s"` object's `style` is `{ opacity: 0.5 }`. For the `"q"` points object, `style` is `{}` — an empty record is still kept as `style: {}`; the test only checks `geom` there.

- [ ] **Step 4: Rewrite `frontend/src/store.ts`**

```ts
import { Problem, SceneDoc, SceneObject, ServerEvent, VersionError, ViewMode, parseDoc, parseObject } from "./protocol";

export type StoreEvent =
  | { type: "reset" }
  | { type: "upsert"; objects: SceneObject[] }
  | { type: "remove"; id: string }
  | { type: "meta" };

export type StoreHandler = (ev: StoreEvent) => void;

const EMPTY: SceneDoc = { version: 2, title: "", run: null, view: "auto", objects: [] };
const VIEWS: ReadonlySet<string> = new Set(["auto", "2d", "3d"]);

/** Scene state for the page: loading (static or live), run swaps, problems. */
export class Store {
  objects = new Map<string, SceneObject>();
  problems = new Map<string, Problem>();
  title = "";
  view: ViewMode = "auto";
  run: string | null = null;
  status = "";
  private handlers = new Set<StoreHandler>();
  private swapPending = false;

  onChange(handler: StoreHandler): void {
    this.handlers.add(handler);
  }

  private emit(ev: StoreEvent): void {
    for (const handler of this.handlers) handler(ev);
  }

  reset(doc: SceneDoc, problems: Problem[] = []): void {
    this.objects.clear();
    this.problems.clear();
    for (const o of doc.objects) this.objects.set(o.id, o);
    for (const p of problems) this.problems.set(p.id, p);
    this.title = doc.title;
    this.view = doc.view;
    this.run = doc.run;
    this.swapPending = false;
    this.emit({ type: "reset" });
  }

  /** Apply one live server event (see SCENE.md "Runs"). */
  apply(ev: ServerEvent): void {
    switch (ev.type) {
      case "run":
        this.run = ev.run;
        this.swapPending = !ev.keep;
        return;
      case "upsert": {
        const objects: SceneObject[] = [];
        const problems: Problem[] = [];
        for (const raw of ev.objects) {
          const parsed = parseObject(raw);
          if ("object" in parsed) objects.push(parsed.object);
          else problems.push(parsed.problem);
        }
        if (typeof ev.title === "string") this.title = ev.title;
        if (typeof ev.view === "string" && VIEWS.has(ev.view)) this.view = ev.view as ViewMode;
        const swap = this.swapPending;
        if (swap) {
          this.swapPending = false;
          this.objects.clear();
          this.problems.clear();
        }
        for (const o of objects) {
          this.objects.set(o.id, o);
          this.problems.delete(o.id);
        }
        for (const p of problems) this.problems.set(p.id, p);
        this.emit(swap ? { type: "reset" } : { type: "upsert", objects });
        return;
      }
      case "remove":
        this.objects.delete(ev.id);
        this.problems.delete(ev.id);
        this.emit({ type: "remove", id: ev.id });
        return;
      case "clear":
        this.objects.clear();
        this.problems.clear();
        this.emit({ type: "reset" });
        return;
    }
  }

  setStatus(text: string): void {
    this.status = text;
    this.emit({ type: "meta" });
  }

  private fail(message: string): void {
    this.reset(EMPTY, [{ id: "_doc", message }]);
    this.setStatus(message);
  }

  /** Replace the scene with a parsed document; version errors are shown, not thrown. */
  loadJson(raw: unknown, origin: string): boolean {
    try {
      const { doc, problems } = parseDoc(raw);
      this.reset(doc, problems);
      return true;
    } catch (err) {
      if (!(err instanceof VersionError)) throw err;
      this.fail(`${origin}: ${err.message}`);
      return false;
    }
  }

  async loadUrl(url: string): Promise<void> {
    this.setStatus(`loading ${url}`);
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      this.fail(`could not load ${url} (${String(err)})`);
      return;
    }
    if (!res.ok) {
      this.fail(`could not load ${url} (HTTP ${res.status})`);
      return;
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      this.fail(`could not load ${url} (not JSON)`);
      return;
    }
    if (this.loadJson(raw, url)) this.setStatus(`static: ${url}`);
  }

  /** `?scene=<url>`, else the live local server, else the bundled sample. */
  async load(): Promise<void> {
    const sceneUrl = new URLSearchParams(location.search).get("scene");
    if (sceneUrl) return this.loadUrl(sceneUrl);
    if (await this.connectLive()) return;
    await this.loadUrl("sample-scene.json");
  }

  private async fetchLiveScene(): Promise<unknown | null> {
    try {
      const res = await fetch("api/scene");
      return res.ok ? await res.json() : null;
    } catch {
      return null; // static hosting: no API (404 page or not JSON)
    }
  }

  private async connectLive(): Promise<boolean> {
    const raw = await this.fetchLiveScene();
    if (raw === null || !this.loadJson(raw, "live")) return false;
    this.setStatus("live");
    const events = new EventSource("events");
    let dropped = false;
    events.onmessage = (msg) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(msg.data) as ServerEvent;
      } catch {
        console.warn("geomcore-viewer: ignoring malformed event", msg.data);
        return;
      }
      this.apply(ev);
    };
    events.onerror = () => {
      dropped = true;
      this.setStatus("live · reconnecting…");
    };
    events.onopen = () => {
      if (!dropped) return;
      dropped = false; // server restarted: our copy may be stale
      void this.fetchLiveScene().then((fresh) => {
        if (fresh !== null) this.loadJson(fresh, "live");
        this.setStatus("live");
      });
    };
    return true;
  }

  /** The "clear" button: empty the page and, when live, the server's scene. */
  clearAll(): void {
    fetch("api/clear", { method: "POST" }).catch(() => {
      /* static page: there is no server scene to clear */
    });
    this.apply({ type: "clear" });
  }
}
```

- [ ] **Step 5: Run tests and type check**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: tests pass. `tsc` will now report errors in `view2d.ts`, `view3d.ts`, `main.ts` (they still use the v1 `Entity`/`isEntity` API) — that is expected and fixed in Task 8. Confirm the only tsc errors are in those three files.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/protocol.ts frontend/src/store.ts frontend/test/protocol.test.ts frontend/test/store.test.ts
git commit -m "frontend: protocol v2 validation + v1 migration; store with run swaps and load errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend rendering of v2 objects, panel, sample scene, relative base

**Files:**
- Rewrite: `frontend/src/view3d.ts`, `frontend/src/view2d.ts`, `frontend/src/main.ts`
- Create: `frontend/src/ui/colors.ts`, `frontend/src/ui/panel.ts`
- Modify: `frontend/index.html`, `frontend/src/style.css`, `frontend/vite.config.ts`
- Rewrite: `frontend/public/sample-scene.json`

**Interfaces:**
- Consumes: `Store`, `StoreEvent`, `SceneObject`; `tessellateCurve`, `tessellateSurface`, `arrowPolylines`; `sceneBounds`, `viewBox`, `halfSize`, `sameBox`; `inPlaneZ0`; `isCurve`, `isSurface`.
- Produces: `View3D(store, canvas)` with `fit()`; `View2D(store, host)` with `fitRequested()`; `mountPanel(store, list, title, status)`; `colorOf(o: SceneObject): string`, `DEFAULT_COLOR`.

- [ ] **Step 1: Colors and panel**

`frontend/src/ui/colors.ts`:

```ts
import type { SceneObject } from "../protocol";

export const DEFAULT_COLOR = "#30638e";

export const colorOf = (o: SceneObject): string => o.style?.color ?? DEFAULT_COLOR;
```

`frontend/src/ui/panel.ts`:

```ts
import type { Store } from "../store";
import { colorOf } from "./colors";

function row(className: string, text: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = className;
  li.textContent = text;
  return li;
}

/** Side panel: one row per object (swatch, label, type), notes, and rejected objects. */
export function mountPanel(store: Store, list: HTMLElement, title: HTMLElement, status: HTMLElement): void {
  const render = () => {
    title.textContent = store.title || "geomcore-viewer";
    document.title = store.title ? `${store.title} · geomcore-viewer` : "geomcore-viewer";
    status.textContent = store.status;
    const rows: HTMLLIElement[] = [];
    for (const o of store.objects.values()) {
      if (o.geom.type === "note") {
        const warn = o.geom.level === "warn";
        rows.push(row(`note ${warn ? "warn" : "info"}`, `${warn ? "⚠" : "ⓘ"} ${o.geom.text}`));
        continue;
      }
      const li = row("object", "");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = colorOf(o);
      const name = document.createElement("span");
      name.textContent = o.label ?? o.id;
      const type = document.createElement("span");
      type.className = "type";
      type.textContent = o.source ?? o.geom.type;
      li.append(swatch, name, type);
      rows.push(li);
    }
    for (const p of store.problems.values()) rows.push(row("problem", `⚠ ${p.id}: ${p.message}`));
    list.replaceChildren(...rows);
  };
  store.onChange(render);
  render();
}
```

- [ ] **Step 2: Rewrite `frontend/src/view3d.ts`**

```ts
import * as BABYLON from "@babylonjs/core";
import { halfSize, sameBox, sceneBounds, viewBox } from "./geom/bounds";
import { arrowPolylines, tessellateCurve, tessellateSurface } from "./geom/tessellate";
import { isCurve, isSurface } from "./geom/types";
import type { Box, Vec3 } from "./geom/vec";
import type { SceneObject } from "./protocol";
import type { Store, StoreEvent } from "./store";
import { colorOf } from "./ui/colors";

const v3 = (p: Vec3) => new BABYLON.Vector3(p[0], p[1], p[2]);

function color3(css: string): BABYLON.Color3 {
  try {
    return BABYLON.Color3.FromHexString(css.startsWith("#") ? css : `#${css}`);
  } catch {
    return BABYLON.Color3.FromHexString("#30638e");
  }
}

/** Babylon 3D pane, z up and right-handed like geomcore. Phase 1: thin lines, plain markers. */
export class View3D {
  readonly scene: BABYLON.Scene;
  readonly camera: BABYLON.ArcRotateCamera;
  private meshes = new Map<string, BABYLON.AbstractMesh[]>();
  private box: Box = viewBox([]);

  constructor(private store: Store, canvas: HTMLCanvasElement) {
    const engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new BABYLON.Color4(0.96, 0.96, 0.97, 1);
    this.camera = new BABYLON.ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 10, BABYLON.Vector3.Zero(), this.scene);
    this.camera.upVector = new BABYLON.Vector3(0, 0, 1);
    this.camera.attachControl(canvas, true);
    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0.3, 0.5, 1), this.scene);
    store.onChange((ev) => this.onStore(ev));
    window.addEventListener("resize", () => engine.resize());
    engine.runRenderLoop(() => this.scene.render());
    this.rebuild();
    this.fit();
  }

  private geoms() {
    return [...this.store.objects.values()].map((o) => o.geom);
  }

  private onStore(ev: StoreEvent): void {
    if (ev.type === "meta") return;
    const box = viewBox(this.geoms());
    const boxChanged = !sameBox(box, this.box);
    this.box = box;
    // Infinite curves and default surface windows depend on the box: rebuild when it moves.
    if (ev.type === "reset" || boxChanged) this.rebuild();
    else if (ev.type === "upsert") ev.objects.forEach((o) => this.show(o));
    else this.drop(ev.id);
    if (this.autoFit()) this.fit();
  }

  private autoFit(): boolean {
    return (document.getElementById("autofit") as HTMLInputElement | null)?.checked ?? true;
  }

  fit(): void {
    const b = sceneBounds(this.geoms());
    if (!b) return;
    const center = v3(b.min).add(v3(b.max)).scale(0.5);
    this.camera.target.copyFrom(center);
    this.camera.radius = Math.max(v3(b.max).subtract(v3(b.min)).length() / 2, 1e-6) * 3;
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
    if (made.length) this.meshes.set(o.id, made);
  }

  private build(o: SceneObject): BABYLON.AbstractMesh[] {
    const g = o.geom;
    const color = color3(colorOf(o));
    if (isCurve(g)) return [this.lines(o.id, [tessellateCurve(g, this.box)], color)];
    if (g.type === "polyline") return [this.lines(o.id, [g.points], color)];
    if (g.type === "arrow") return [this.lines(o.id, arrowPolylines(g.at, g.vec), color)];
    if (isSurface(g)) {
      const mesh = tessellateSurface(g, halfSize(this.box));
      return [this.surface(o, mesh.positions, mesh.indices, color)];
    }
    if (g.type === "mesh") return [this.surface(o, g.vertices.flat(), g.indices, color)];
    if (g.type === "point") return [this.marker(o.id, g.p, color)];
    if (g.type === "points") return g.positions.map((p, i) => this.marker(`${o.id}#${i}`, p, color, 0.5));
    return []; // text and notes: panel only in Phase 1
  }

  private lines(id: string, polylines: Vec3[][], color: BABYLON.Color3): BABYLON.LinesMesh {
    const mesh = BABYLON.MeshBuilder.CreateLineSystem(`o-${id}`, { lines: polylines.map((l) => l.map(v3)) }, this.scene);
    mesh.color = color;
    return mesh;
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

- [ ] **Step 3: Rewrite `frontend/src/view2d.ts`**

```ts
import * as PIXI from "pixi.js";
import { sameBox, sceneBounds, viewBox } from "./geom/bounds";
import { inPlaneZ0 } from "./geom/planar";
import { arrowPolylines, tessellateCurve } from "./geom/tessellate";
import { Geom, isCurve } from "./geom/types";
import type { Box, Vec3 } from "./geom/vec";
import type { SceneObject } from "./protocol";
import type { Store, StoreEvent } from "./store";
import { colorOf } from "./ui/colors";

const hex = (css: string): number => {
  const m = css.replace("#", "");
  const v = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return Number.isNaN(v) ? 0x30638e : v;
};

/** PixiJS pane for everything lying in z = 0, y up. Phase 2 replaces it with the full plane view. */
export class View2D {
  private app = new PIXI.Application();
  private world = new PIXI.Container();
  private nodes = new Map<string, PIXI.Container>();
  private box: Box = viewBox([]);
  private userMoved = false;

  constructor(private store: Store, private host: HTMLElement) {
    void this.app.init({ resizeTo: host, background: "#f4f6fa", antialias: true }).then(() => {
      host.appendChild(this.app.canvas);
      this.app.stage.addChild(this.world);
      this.enableNav();
      store.onChange((ev) => this.onStore(ev));
      this.fit();
    });
  }

  private planarGeoms(): Geom[] {
    return [...this.store.objects.values()].map((o) => o.geom).filter(inPlaneZ0);
  }

  private onStore(ev: StoreEvent): void {
    if (ev.type === "meta") return;
    const box = viewBox(this.planarGeoms());
    const boxChanged = !sameBox(box, this.box);
    this.box = box;
    if (ev.type === "reset" || boxChanged) this.rebuild();
    else if (ev.type === "upsert") ev.objects.forEach((o) => this.show(o));
    else this.drop(ev.id);
    if (this.autoFit() && !this.userMoved) this.fit();
  }

  private autoFit(): boolean {
    return (document.getElementById("autofit") as HTMLInputElement | null)?.checked ?? true;
  }

  fitRequested(): void {
    this.userMoved = false;
    this.fit();
  }

  private fit(): void {
    const b = sceneBounds(this.planarGeoms());
    if (b) {
      const w = Math.max(b.max[0] - b.min[0], 1e-9);
      const h = Math.max(b.max[1] - b.min[1], 1e-9);
      const pad = 40;
      const width = this.host.clientWidth || 800;
      const height = this.host.clientHeight || 600;
      const s = Math.min((width - pad) / w, (height - pad) / h);
      this.world.scale.set(s, -s); // y up
      this.world.x = (width - w * s) / 2 - b.min[0] * s;
      this.world.y = (height + h * s) / 2 + b.min[1] * s;
    }
    this.rebuild(); // stroke widths are set in world units for the current zoom
  }

  private enableNav(): void {
    const canvas = this.app.canvas;
    let drag: { x: number; y: number } | null = null;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (ev) => {
      drag = { x: ev.clientX, y: ev.clientY };
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      this.userMoved = true;
      this.world.x += ev.clientX - drag.x;
      this.world.y += ev.clientY - drag.y;
      drag = { x: ev.clientX, y: ev.clientY };
    });
    canvas.addEventListener("pointerup", () => (drag = null));
    canvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        this.userMoved = true;
        const factor = Math.exp(-ev.deltaY * 0.0015);
        const rect = canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const sx = this.world.scale.x;
        const wx = (mx - this.world.x) / sx;
        const wy = (my - this.world.y) / -sx;
        const s = Math.min(Math.max(sx * factor, 1e-6), 1e9);
        this.world.scale.set(s, -s);
        this.world.x = mx - wx * s;
        this.world.y = my + wy * s;
      },
      { passive: false },
    );
  }

  private rebuild(): void {
    this.box = viewBox(this.planarGeoms());
    for (const id of [...this.nodes.keys()]) this.drop(id);
    for (const o of this.store.objects.values()) this.show(o);
  }

  private drop(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.world.removeChild(node);
    node.destroy({ children: true });
    this.nodes.delete(id);
  }

  private show(o: SceneObject): void {
    this.drop(o.id);
    const g = o.geom;
    if (!inPlaneZ0(g)) return;
    const color = hex(colorOf(o));
    const px = 1 / Math.max(Math.abs(this.world.scale.x), 1e-9); // one screen pixel in world units
    const gfx = new PIXI.Graphics();
    const stroke = (polylines: Vec3[][]) => {
      for (const line of polylines) {
        gfx.moveTo(line[0][0], line[0][1]);
        for (const p of line.slice(1)) gfx.lineTo(p[0], p[1]);
      }
      gfx.stroke({ width: 2 * px, color });
    };
    if (isCurve(g)) stroke([tessellateCurve(g, this.box)]);
    else if (g.type === "polyline") stroke([g.points]);
    else if (g.type === "arrow") stroke(arrowPolylines(g.at, g.vec));
    else if (g.type === "point") gfx.circle(g.p[0], g.p[1], 4 * px).fill(color);
    else if (g.type === "points") {
      for (const p of g.positions) gfx.circle(p[0], p[1], (g.size ?? 3) * px);
      gfx.fill(color);
    } else return;
    this.nodes.set(o.id, gfx);
    this.world.addChild(gfx);
  }
}
```

- [ ] **Step 4: Rewrite `frontend/src/main.ts`, update HTML/CSS/Vite**

`frontend/src/main.ts`:

```ts
import "./style.css";
import { Store } from "./store";
import { mountPanel } from "./ui/panel";
import { View2D } from "./view2d";
import { View3D } from "./view3d";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

const store = new Store();
const view3d = new View3D(store, byId<HTMLCanvasElement>("canvas3d"));
const view2d = new View2D(store, byId("view2d"));
mountPanel(store, byId("entity-list"), byId("title"), byId("status"));

byId("fit").addEventListener("click", () => {
  view3d.fit();
  view2d.fitRequested();
});
byId("clear").addEventListener("click", () => store.clearAll());

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

void store.load();
```

`frontend/index.html` — replace the `<h1>` and the two pane captions:

```html
      <h1 id="title">geomcore-viewer</h1>
```

```html
      <section id="pane3d"><canvas id="canvas3d"></canvas><h2>3D</h2></section>
      <section id="pane2d"><div id="view2d"></div><h2>plane z = 0</h2></section>
```

(`.swatch` already exists in `style.css`.) Append to `frontend/src/style.css`:

```css
aside li .type { margin-left: auto; color: #888; font-size: 0.75rem; }
aside li.note { color: #444; }
aside li.note.warn, aside li.problem { color: #a4471c; }
```

`frontend/vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs: the same build works on GitHub Pages and from the local server.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
```

- [ ] **Step 5: Rewrite `frontend/public/sample-scene.json`**

```json
{
  "version": 2,
  "title": "Ellipse ∩ circle (sample)",
  "run": null,
  "view": "auto",
  "objects": [
    {"id": "E", "label": "E", "group": "conics", "source": "Ellipse3D",
     "geom": {"type": "ellipse", "frame": {"o": [0, 0, 0], "x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]}, "a": 3, "b": 2},
     "style": {"color": "#d1495b"}},
    {"id": "C", "label": "C", "group": "conics", "source": "Circle3D",
     "geom": {"type": "circle", "frame": {"o": [2, 1, 0], "x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]}, "r": 1.5},
     "style": {"color": "#00798c"}},
    {"id": "L", "label": "L", "group": "conics", "source": "Line3D",
     "geom": {"type": "line", "o": [0, -3, 0], "d": [0.7071067811865475, 0.7071067811865475, 0]},
     "style": {"color": "#30638e"}},
    {"id": "P₁", "label": "P₁", "group": "intersections", "source": "Point3D",
     "geom": {"type": "point", "p": [2.994312451281455, -0.1230951648131442, 0]}, "style": {"color": "#edae49"}},
    {"id": "P₂", "label": "P₂", "group": "intersections", "source": "Point3D",
     "geom": {"type": "point", "p": [0.8184796796924556, 1.9241264700788294, 0]}, "style": {"color": "#edae49"}},
    {"id": "Q₁", "label": "Q₁", "group": "intersections", "source": "Point3D",
     "geom": {"type": "point", "p": [1.1538461538461535, -1.8461538461538465, 0]}, "style": {"color": "#6a4c93"}},
    {"id": "Q₂", "label": "Q₂", "group": "intersections", "source": "Point3D",
     "geom": {"type": "point", "p": [3, 0, 0]}, "style": {"color": "#6a4c93"}}
  ]
}
```

(The points are geomcore's results for `C.intersect_ellipse(E)` and `L.intersect_ellipse(E)`; they are regenerated by `examples/conics_2d.py --save` in Task 9.)

- [ ] **Step 6: Type check, test, build**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc silent, tests pass, Vite build succeeds and `dist/index.html` references `./assets/...`.

- [ ] **Step 7: Smoke test in a browser**

```bash
scripts/bundle-frontend.sh
PYTHONPATH=python .venv/bin/python -m geomcore_viewer serve --port 8799 --no-browser &
```

Open `http://127.0.0.1:8799/` (Playwright MCP: `browser_navigate`, then `browser_take_screenshot`). Expected: panel lists E, C, L, P₁, P₂, Q₁, Q₂ with swatches; the 2D pane shows the ellipse, circle, a line crossing the whole pane, and four dots; the 3D pane shows the same curves; status reads `live` (the local server serves an empty live scene, so it is empty — then load `http://127.0.0.1:8799/?scene=sample-scene.json` to see the sample). Also check the browser console has no errors. Stop the server: `PYTHONPATH=python .venv/bin/python -m geomcore_viewer stop --port 8799`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src frontend/index.html frontend/vite.config.ts frontend/public/sample-scene.json
git commit -m "frontend: draw v2 objects exactly (clipped infinite curves, analytic surfaces), panel, relative base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Examples, docs, CI, end-to-end check

**Files:**
- Create: `examples/conics_2d.py`, `examples/quadrics_3d.py`
- Rewrite: `README.md`
- Modify: `.github/workflows/ci.yml`
- Outside this repo (leave **uncommitted** there; report to the user): `../geomcore/examples/intersection_matrix.py`, `../geomcore/docs/viewer.md`

**Interfaces:**
- Consumes: the whole Python API from Tasks 1–4 and the built frontend from Task 8.

- [ ] **Step 1: `examples/conics_2d.py`**

```python
"""Conics and where they meet — the classroom demo.

Run:   python examples/conics_2d.py            (re-run after every edit; the tab updates in place)
Save:  python examples/conics_2d.py --save frontend/public/sample-scene.json
Needs geomcore (pip install geomcore, or PYTHONPATH=../geomcore/geomcore-py).
"""

from __future__ import annotations

import argparse

from geomcore import Frame3D, Point3D, Vector3D
from geomcore.curves import Circle3D, Ellipse3D, Hyperbola3D, Line3D

import geomcore_viewer as gv

parser = argparse.ArgumentParser()
parser.add_argument("--save", help="write the scene to this JSON file instead of opening the viewer")
args = parser.parse_args()

view = gv.Viewer("Conics and their intersections", spawn=args.save is None)

E = Ellipse3D.from_frame(Frame3D.world(), 3.0, 2.0)
C = Circle3D(Point3D(2.0, 1.0, 0.0), Vector3D.z(), 1.5)
H = Hyperbola3D.from_frame(Frame3D.world(), 1.0, 0.5)
L = Line3D(Point3D(0.0, -3.0, 0.0), Vector3D(1.0, 1.0, 0.0))

view.add(E, label="E", group="conics", foci=True)
view.add(C, label="C", group="conics")
view.add(H, label="H", group="conics", asymptotes=True)
view.add(L, label="L", group="conics")

view.add(C.intersect_ellipse(E), label="P", group="intersections")
view.add(L.intersect_ellipse(E), label="Q", group="intersections")
view.add(L.intersect_circle(C), label="R", group="intersections")
view.add(L.intersect_hyperbola(H), label="S", group="intersections")

if args.save:
    print(f"saved {view.save(args.save)}")
```

With `--save`, `spawn=False` makes the run offline: the first `add` warns once that no server answers (expected) and everything is saved.

- [ ] **Step 2: `examples/quadrics_3d.py`**

```python
"""Sphere ∩ cylinder and plane ∩ cone — intersection curves in 3D.

Run:  python examples/quadrics_3d.py   (needs geomcore)
"""

from __future__ import annotations

from geomcore import Frame3D, Point3D, Vector3D
from geomcore.surfaces import Cone, Cylinder, Plane, Sphere

import geomcore_viewer as gv

view = gv.Viewer("Quadric intersections")

S = Sphere(Point3D.origin(), 3.0)
Y = Cylinder(Point3D.origin(), Vector3D.z(), 2.0)
view.add(S, label="S", opacity=0.4, group="sphere ∩ cylinder")
view.add(Y, label="Y", opacity=0.4, v=(-3.5, 3.5), group="sphere ∩ cylinder")
view.add(S.intersect_cylinder(Y), label="SY", group="sphere ∩ cylinder")

K = Cone.from_frame(Frame3D(Point3D(9.0, 0.0, 0.0), Vector3D.z(), Vector3D.x()), 0.4, 2.0)
P = Plane(Point3D(9.0, 0.0, 1.0), Vector3D.z())
view.add(K, label="K", opacity=0.4, v=(-4.0, 4.0), group="plane ∩ cone")
view.add(P, label="Π", opacity=0.3, u=(-4.0, 4.0), v=(-4.0, 4.0), group="plane ∩ cone")
view.add(P.intersect_cone(K), label="ΠK", group="plane ∩ cone")
```

- [ ] **Step 3: Run both examples against the live server and look**

```bash
scripts/bundle-frontend.sh
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python examples/conics_2d.py
```

Expected: prints `geomcore-viewer: http://127.0.0.1:8765`, the browser opens, the panel lists E, C, H, L, P₁, P₂, Q₁, Q₂, R₁, R₂, S₁, S₂ (no notes); the 2D pane shows the line and hyperbola running to the pane edges. Take a Playwright screenshot of `http://127.0.0.1:8765/`. Re-run the script: the picture stays (no empty flash), objects identical. Then:

```bash
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python examples/quadrics_3d.py
```

Expected: the tab swaps to the quadric scene (new run); 3D pane shows the translucent sphere, cylinder, cone, plane and the intersection circles. Screenshot it. Then regenerate the sample:

```bash
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python examples/conics_2d.py --save frontend/public/sample-scene.json
PYTHONPATH=python .venv/bin/python -m geomcore_viewer stop
```

- [ ] **Step 4: Rewrite `README.md`**

````markdown
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
````

- [ ] **Step 5: CI — `.github/workflows/ci.yml`**

Replace the `frontend` and `python` jobs (keep `rust` unchanged) and add `wheel`:

```yaml
  frontend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci
      - run: npm test
      - run: npm run build
  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install pytest
      - run: pytest python/tests -q
        env: { PYTHONPATH: python }
  wheel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: npm ci
        working-directory: frontend
      - run: scripts/bundle-frontend.sh
      - run: pip install build && python -m build python/
      - run: unzip -l python/dist/*.whl | grep -q 'geomcore_viewer/_frontend/index.html'
```

Verify locally that the wheel contains the frontend:

```bash
.venv/bin/pip install -q build && .venv/bin/python -m build python/ && unzip -l python/dist/*.whl | grep _frontend/index.html
rm -rf python/dist
```

Expected: one matching line.

- [ ] **Step 6: Port geomcore's `examples/intersection_matrix.py` and `docs/viewer.md` (other repo, leave uncommitted)**

In `../geomcore/examples/intersection_matrix.py`:
1. Imports: drop `from geomcore_viewer.sampling import …` and `sample_surface`/`shift`/`WINDOWS` sampling use; import `Transform` from `geomcore` and `import geomcore_viewer as gv`.
2. Every pair builder returns geomcore objects instead of sampled points: replace each `sample_curve(X.eval_point, a, b, n)` with `X`, and each list comprehension `[sample_curve(c.eval_point, …) for c in payload]` with `list(payload)`. Example — `pair_plane_sphere` becomes:

```python
def pair_plane_sphere():
    s1 = canonical("Plane")
    s2 = canonical("Sphere")
    kind, payload = s1.intersect_sphere(s2)
    assert kind == "circle", kind
    return (s1, "Plane"), (s2, "Sphere"), (payload, "circle")
```

3. Replace `main()`'s body from `viewer = Viewer()` through the end of the cell loop with:

```python
    view = gv.Viewer("Surface intersection matrix", spawn=args.serve)
    with_curve, pending = [], []
    for i, row in enumerate(TYPES):
        for j, col in enumerate(TYPES):
            (s1, k1), second, curve_info = build_cell(row, col)
            move = Transform.translation(Vector3D(j * CELL_STEP, -i * CELL_STEP, 0.0))
            tag = f"{row}×{col}"
            _, _, (u0, u1), (v0, v1) = WINDOWS[k1]
            view.add(s1.transformed(move), label=f"{tag} {k1}#1", group=tag,
                     color=SURFACE_COLORS[0], opacity=SURFACE_OPACITY, u=(u0, u1), v=(v0, v1))
            if second is not None:
                s2, k2 = second
                _, _, (u0, u1), (v0, v1) = WINDOWS[k2]
                view.add(s2.transformed(move), label=f"{tag} {k2}#2", group=tag,
                         color=SURFACE_COLORS[1], opacity=SURFACE_OPACITY, u=(u0, u1), v=(v0, v1))
            if curve_info is not None:
                curves, kind = curve_info
                curves = curves if isinstance(curves, list) else [curves]
                view.add(*[c.transformed(move) for c in curves], label=f"{tag} {kind}", group=tag, color=CURVE_COLOR)
                with_curve.append(f"({row},{col})")
            else:
                pending.append(f"({row},{col})")

    out = Path(args.out) if args.out else Path(__file__).with_suffix(".scene.json")
    view.save(out)
    print(f"saved {out} ({len(view.objects)} objects)")
    print(f"cells with intersection curves ({len(with_curve)}): {' '.join(with_curve)}")
    print(f"cells pending analytic intersection ({len(pending)}): {' '.join(pending)}")
```

and delete the old `if args.serve:` block plus the `--frontend`/`--port` arguments (the viewer now finds or starts its own server; `--serve` just means "go live"). Update the module docstring's Usage accordingly. Lines (`two_lines`, plane∩plane `line`) are infinite now and are drawn across the view — no `-7..7` sampling needed.

Run it: `cd ../geomcore && PYTHONPATH=geomcore-py:../geomcore-viewer/python python3 examples/intersection_matrix.py --out /tmp/claude-1000/-home-gabriel-Documentos-open-source-geomcore-viewer/60fb7073-93ca-4288-9098-6a63676370a5/scratchpad/matrix.json` → expected: `saved … objects` plus the two cell lists, no exception. Then with `--serve` and take a screenshot of the tab.

In `../geomcore/docs/viewer.md`, replace the "From your own code" Python block with:

```python
from geomcore import Frame3D, Point3D, Vector3D
from geomcore.curves import Circle3D, Ellipse3D
import geomcore_viewer as gv

view = gv.Viewer("Ellipse ∩ circle")          # starts the local viewer and opens a tab
E = Ellipse3D.from_frame(Frame3D.world(), 3.0, 2.0)
C = Circle3D(Point3D(2, 1, 0), Vector3D.z(), 1.5)
view.add(E, label="E")
view.add(C, label="C")
view.add(C.intersect_ellipse(E), label="P")   # intersection points P₁, P₂
```

and the sentence before it with: "The embedded page above is static. From a script, a debugger or a notebook, `view.add(...)` sends geomcore objects to a local viewer tab that updates live:". Leave the Rust block (phase 4 updates it).

- [ ] **Step 7: Full verification**

```bash
PYTHONPATH=python:../geomcore/geomcore-py .venv/bin/python -m pytest python/tests -q
PYTHONPATH=python .venv/bin/python -m pytest python/tests -q          # CI-like: real-geomcore tests skip
(cd frontend && npm test && npx tsc --noEmit && npm run build)
(cd clients/rust && cargo test -q)
```

Expected: everything passes; the CI-like run reports the real-geomcore tests as skipped.

- [ ] **Step 8: Commit (this repo only)**

```bash
git add examples README.md .github/workflows/ci.yml frontend/public/sample-scene.json
git commit -m "examples, README and CI for viewer v2 phase 1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
