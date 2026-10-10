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


def _listen(server, count, events, ready):
    with urllib.request.urlopen(f"{server.url}/events", timeout=10) as res:
        for raw in res:
            line = raw.decode().strip()
            if line == ": connected":
                ready.set()
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))
                if len(events) == count:
                    return


def test_sse_event_sequence(server):
    events = []
    ready = threading.Event()
    t = threading.Thread(target=_listen, args=(server, 5, events, ready), daemon=True)
    t.start()
    assert ready.wait(5)
    _send(f"{server.url}/api/objects", {"run": "r1", "objects": [_obj("a")]})
    _send(f"{server.url}/api/objects/a", method="DELETE")
    _send(f"{server.url}/api/clear")
    t.join(5)
    assert [e["type"] for e in events] == ["scene", "run", "upsert", "remove", "clear"]
    assert events[0]["doc"]["objects"] == []
    assert events[1] == {"type": "run", "run": "r1", "keep": False}
    assert events[2]["objects"][0]["id"] == "a"


def test_connecting_starts_with_the_full_scene(server):
    _send(f"{server.url}/api/objects", {"run": "r1", "title": "T", "view": "2d", "objects": [_obj("a"), _obj("b")]})
    events = []
    ready = threading.Event()
    t = threading.Thread(target=_listen, args=(server, 2, events, ready), daemon=True)
    t.start()
    assert ready.wait(5)
    _send(f"{server.url}/api/objects", {"run": "r1", "objects": [_obj("c")]})
    t.join(5)
    assert [e["type"] for e in events] == ["scene", "upsert"]
    assert events[0]["doc"]["version"] == PROTOCOL
    assert [o["id"] for o in events[0]["doc"]["objects"]] == ["a", "b"]
    assert (events[0]["doc"]["title"], events[0]["doc"]["view"], events[0]["doc"]["run"]) == ("T", "2d", "r1")
    assert events[1]["objects"][0]["id"] == "c"


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


def _raw(server, method, path, body=None, headers=None, host=None):
    """One request with exactly the given headers (no implicit Content-Type)."""
    conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=5)
    conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    conn.putheader("Host", host if host is not None else f"127.0.0.1:{server.port}")
    for key, value in (headers or {}).items():
        conn.putheader(key, value)
    data = body.encode() if isinstance(body, str) else body
    if data is not None:
        conn.putheader("Content-Length", str(len(data)))
    conn.endheaders(data)
    res = conn.getresponse()
    out = res.status, dict(res.getheaders()), res.read()
    conn.close()
    return out


def test_post_requires_json_content_type(server):
    body = json.dumps({"objects": [_obj("evil")]})
    status, _, payload = _raw(server, "POST", "/api/objects", body, {"Content-Type": "text/plain"})
    assert status == 415
    assert json.loads(payload) == {"error": "Content-Type must be application/json"}
    assert _ids(server) == []
    assert _raw(server, "POST", "/api/objects", body)[0] == 415  # no Content-Type at all


def test_clear_and_shutdown_need_json_content_type_too(server):
    _send(f"{server.url}/api/objects", {"objects": [_obj("a")]})
    assert _raw(server, "POST", "/api/clear")[0] == 415
    assert _raw(server, "POST", "/api/clear", "{}", {"Content-Type": "text/plain"})[0] == 415
    assert _raw(server, "POST", "/api/shutdown", "{}", {"Content-Type": "text/plain"})[0] == 415
    assert _ids(server) == ["a"]
    assert server._thread.is_alive()


def test_json_content_type_with_charset_is_accepted(server):
    body = json.dumps({"objects": [_obj("a")]})
    status, _, _ = _raw(server, "POST", "/api/objects", body, {"Content-Type": "Application/JSON; charset=utf-8"})
    assert status == 200 and _ids(server) == ["a"]


@pytest.mark.parametrize("origin", ["http://evil.example", "https://127.0.0.1:{port}", "http://127.0.0.1:1", "null"])
def test_foreign_origin_is_refused_on_every_method(server, origin):
    origin = origin.format(port=server.port)
    headers = {"Content-Type": "application/json", "Origin": origin}
    assert _raw(server, "POST", "/api/objects", json.dumps({"objects": [_obj("evil")]}), headers)[0] == 403
    assert _raw(server, "POST", "/api/clear", "{}", headers)[0] == 403
    assert _raw(server, "DELETE", "/api/objects/a", None, headers)[0] == 403
    assert _raw(server, "GET", "/api/scene", None, {"Origin": origin})[0] == 403
    assert _raw(server, "GET", "/events", None, {"Origin": origin})[0] == 403
    assert _raw(server, "GET", "/", None, {"Origin": origin})[0] == 403
    assert _ids(server) == []


@pytest.mark.parametrize("name", ["127.0.0.1", "localhost"])
def test_local_origin_is_accepted(server, name):
    origin = f"http://{name}:{server.port}"
    status, _, _ = _raw(server, "POST", "/api/objects", json.dumps({"objects": [_obj("a")]}),
                        {"Content-Type": "application/json", "Origin": origin})
    assert status == 200
    assert _raw(server, "GET", "/api/scene", None, {"Origin": origin})[0] == 200


@pytest.mark.parametrize("host", ["evil.example", "evil.example:{port}", "127.0.0.1", "localhost", "127.0.0.1:1", ""])
def test_foreign_host_is_refused_on_every_route(server, host):
    host = host.format(port=server.port)
    assert _raw(server, "GET", "/api/health", host=host)[0] == 403
    assert _raw(server, "GET", "/api/scene", host=host)[0] == 403
    assert _raw(server, "GET", "/", host=host)[0] == 403
    assert _raw(server, "GET", "/events", host=host)[0] == 403
    assert _raw(server, "POST", "/api/clear", "{}", {"Content-Type": "application/json"}, host=host)[0] == 403


def test_localhost_host_is_accepted(server):
    assert _raw(server, "GET", "/api/health", host=f"localhost:{server.port}")[0] == 200


def test_no_cross_origin_read_header(server):
    for path in ("/api/scene", "/api/health", "/"):
        _, headers, _ = _raw(server, "GET", path)
        assert "Access-Control-Allow-Origin" not in headers
    _, headers, _ = _raw(server, "POST", "/api/clear", "{}", {"Content-Type": "application/json"})
    assert "Access-Control-Allow-Origin" not in headers
    with urllib.request.urlopen(f"{server.url}/events", timeout=5) as res:
        assert res.headers.get("Access-Control-Allow-Origin") is None
