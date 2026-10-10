from __future__ import annotations

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
