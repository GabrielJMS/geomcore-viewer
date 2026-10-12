import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from geomcore_viewer import spawn
from geomcore_viewer.__main__ import main
from geomcore_viewer import Viewer
from geomcore_viewer.server import APP, DEFAULT_PORT, Server
from geomcore_viewer.spawn import ensure_server, probe, refused_hint, stop_server


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
    assert spawn._children == {}  # the exited server process was reaped, not left as a zombie


def test_foreign_listener_is_reported(tmp_path):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), lambda *a: SimpleHTTPRequestHandler(*a, directory=str(tmp_path)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        assert probe(url) == "foreign"
        with pytest.raises(RuntimeError, match="not a geomcore-viewer v2 server") as excinfo:
            ensure_server(url)
        assert "set GEOMCORE_VIEWER_URL=http://127.0.0.1:<other port> or pass url=" in str(excinfo.value)
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


def _raw_listener(handler):
    """Serve one raw TCP connection on 127.0.0.1 with ``handler(conn)``; return (url, sock)."""
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)

    def run():
        conn, _ = srv.accept()
        try:
            handler(conn)
        except OSError:
            pass
        finally:
            conn.close()

    threading.Thread(target=run, daemon=True).start()
    return f"http://127.0.0.1:{srv.getsockname()[1]}", srv


def test_non_http_listener_is_foreign():
    def speak_ssh(conn):
        conn.sendall(b"SSH-2.0-OpenSSH\r\n")

    url, srv = _raw_listener(speak_ssh)
    try:
        assert probe(url) == "foreign"
    finally:
        srv.close()


def test_hung_listener_is_unresponsive():
    release = threading.Event()

    def hang(conn):
        release.wait(5)

    url, srv = _raw_listener(hang)
    try:
        assert probe(url, timeout=0.3) == "unresponsive"
        with pytest.raises(RuntimeError, match="did not answer"):
            ensure_server(url)
    finally:
        release.set()
        srv.close()


def test_cli_stop_defaults_to_the_port_of_the_environment_url(monkeypatch, tmp_path, capsys):
    srv = Server(tmp_path, port=0).start()
    try:
        monkeypatch.setenv("GEOMCORE_VIEWER_URL", srv.url)
        main(["stop"])
        assert f"stopped {srv.url}" in capsys.readouterr().out
    finally:
        srv.stop()


def test_cli_explicit_port_beats_the_environment_url(monkeypatch, tmp_path, capsys):
    srv = Server(tmp_path, port=0).start()
    try:
        monkeypatch.setenv("GEOMCORE_VIEWER_URL", srv.url)
        free = _free_port()
        main(["stop", "--port", str(free)])
        assert f"no viewer running at http://127.0.0.1:{free}" in capsys.readouterr().out
        assert probe(srv.url) == "ours"
    finally:
        srv.stop()


class _FakeServer:
    ports: list = []

    def __init__(self, directory, port):
        self.ports.append(port)
        self.url = f"http://127.0.0.1:{port}"
        self.httpd = self

    def serve_forever(self):
        raise KeyboardInterrupt

    def server_close(self):
        pass


@pytest.mark.parametrize(
    ("env", "argv", "expected"),
    [
        ("http://127.0.0.1:8799", [], 8799),
        ("http://127.0.0.1:8799", ["--port", "8123"], 8123),
        (None, [], DEFAULT_PORT),
        ("  ", [], DEFAULT_PORT),
        ("http://127.0.0.1", [], 80),  # no port in the URL means 80, as for the client
    ],
)
def test_cli_serve_port_default(monkeypatch, env, argv, expected):
    monkeypatch.setattr("geomcore_viewer.__main__.Server", _FakeServer)
    _FakeServer.ports = []
    if env is None:
        monkeypatch.delenv("GEOMCORE_VIEWER_URL", raising=False)
    else:
        monkeypatch.setenv("GEOMCORE_VIEWER_URL", env)
    main(["serve", "--no-browser", *argv])
    assert _FakeServer.ports == [expected]


def test_spawned_server_runs_from_the_home_directory(monkeypatch):
    import os

    calls = []

    class FakePopen:
        def __init__(self, cmd, **kwargs):
            calls.append((cmd, kwargs))

        def poll(self):
            return 0

    monkeypatch.setattr(spawn.subprocess, "Popen", FakePopen)
    monkeypatch.setattr(spawn, "_children", {})
    spawn._spawn(12345)
    [(cmd, kwargs)] = calls
    assert kwargs["cwd"] == os.path.expanduser("~")  # not the script's directory, which would stay busy
    assert cmd[-3:] == ["--port", "12345", "--no-browser"]


class _Refusing(BaseHTTPRequestHandler):
    """A geomcore-viewer seen through a tunnel that changed the port: every request gets its 403."""

    def do_GET(self):
        body = json.dumps({"error": "request is not from this server's own origin", "app": APP}).encode()
        self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def test_a_refusing_viewer_gets_the_tunnel_hint():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Refusing)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}"
    try:
        assert probe(url) == "refused"
        with pytest.raises(RuntimeError, match=f"ssh -L {port}:127.0.0.1:{port} <host>"):
            ensure_server(url)
        with pytest.warns(RuntimeWarning, match=f"ssh -L {port}:127.0.0.1:{port} <host>"):
            Viewer(url=url, spawn=False, open_browser=False).text((0, 0, 0), "hello")
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_a_403_cut_short_is_foreign():
    def refuse_then_hang_up(conn):
        conn.settimeout(2)
        request = b""
        while b"\r\n\r\n" not in request:  # read the whole request, so closing does not reset the connection
            chunk = conn.recv(4096)
            if not chunk:
                return
            request += chunk
        conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"app\"")

    url, srv = _raw_listener(refuse_then_hang_up)
    try:
        assert probe(url) == "foreign"
    finally:
        srv.close()


def test_the_tunnel_hint_keeps_the_port():
    assert "ssh -L 9000:127.0.0.1:9000 <host>" in refused_hint("http://127.0.0.1:9000")
    assert "ssh -L 80:127.0.0.1:80 <host>" in refused_hint("http://127.0.0.1")


def test_spawning_waits_at_most_three_seconds():
    import inspect

    assert inspect.signature(ensure_server).parameters["timeout"].default == 3.0


@pytest.mark.parametrize("command", ["serve", "stop"])
def test_cli_reports_a_malformed_environment_url(monkeypatch, capsys, command):
    monkeypatch.setenv("GEOMCORE_VIEWER_URL", "http://127.0.0.1:87x5")
    with pytest.raises(SystemExit) as exc:
        main([command])
    assert exc.value.code == 2
    assert "GEOMCORE_VIEWER_URL='http://127.0.0.1:87x5' has a malformed port" in capsys.readouterr().err


def test_cli_explicit_port_ignores_a_malformed_environment_url(monkeypatch, capsys):
    monkeypatch.setenv("GEOMCORE_VIEWER_URL", "http://127.0.0.1:87x5")
    port = _free_port()
    main(["stop", "--port", str(port)])
    assert f"no viewer running at http://127.0.0.1:{port}" in capsys.readouterr().out
