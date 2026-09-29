import json
import math
import threading
import time
import urllib.request

import pytest

from geomcore_viewer import Server, Viewer, sample_curve, sample_surface_grid


class P3:
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


def _circle(t):
    return P3(2 * math.cos(t), 2 * math.sin(t), 0.0)


def test_sample_curve_3d():
    pts = sample_curve(_circle, 0.0, 2 * math.pi, n=8)
    assert len(pts) == 9
    assert pts[0][0] == pytest.approx(2.0)
    assert all(len(p) == 3 for p in pts)


def test_sample_surface_grid():
    verts, idx = sample_surface_grid(lambda u, v: P3(u, v, u * v), 0, 1, 0, 1, nu=4, nv=2)
    assert len(verts) == 5 * 3
    assert len(idx) % 3 == 0 and len(idx) == 4 * 2 * 6


def test_server_roundtrip(tmp_path):
    frontend = tmp_path / "dist"
    frontend.mkdir()
    (frontend / "index.html").write_text("<html></html>")
    server = Server(frontend, port=0).start()
    try:
        viewer = Viewer(server.url)
        viewer.add_curve3d("c", sample_curve(_circle, 0.0, math.pi, n=4))
        with urllib.request.urlopen(f"{server.url}/api/scene", timeout=5) as res:
            scene = json.loads(res.read())
        assert scene["version"] == 1
        assert [e["id"] for e in scene["entities"]] == ["c"]
        viewer.clear()
        time.sleep(0.1)
        with urllib.request.urlopen(f"{server.url}/api/scene", timeout=5) as res:
            assert json.loads(res.read())["entities"] == []
    finally:
        server.stop()
        server._thread.join(timeout=5)


def test_sse_broadcast(tmp_path):
    (tmp_path / "index.html").write_text("<html></html>")
    server = Server(tmp_path, port=0).start()
    try:
        received: list[str] = []

        def listen():
            with urllib.request.urlopen(f"{server.url}/events", timeout=10) as res:
                received.append(res.readline().decode())

        t = threading.Thread(target=listen, daemon=True)
        t.start()
        time.sleep(0.3)
        Viewer(server.url).add_curve2d("p", [[0.0, 1.0], [1.0, 2.0]])
        t.join(timeout=5)
        assert received and '"p"' in received[0] and "upsert" in received[0]
    finally:
        server.stop()
