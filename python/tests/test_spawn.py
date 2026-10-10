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
