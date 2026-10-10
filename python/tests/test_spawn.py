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
