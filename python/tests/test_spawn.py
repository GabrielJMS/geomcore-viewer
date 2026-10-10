import socket
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from geomcore_viewer import spawn
from geomcore_viewer.__main__ import main
from geomcore_viewer.server import DEFAULT_PORT, Server
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
        ("http://127.0.0.1", [], DEFAULT_PORT),
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
