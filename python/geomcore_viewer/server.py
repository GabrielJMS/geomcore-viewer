"""Local server: serves the built frontend + scene API + SSE fan-out.

Stdlib only. Static hosting (GitHub Pages) skips this entirely and loads
a scene document instead — see protocol/SCENE.md.
"""

from __future__ import annotations

import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

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


class _State:
    def __init__(self) -> None:
        self.entities: dict[str, dict] = {}
        self.subscribers: list[queue.Queue[str]] = []
        self.lock = threading.Lock()

    def snapshot(self) -> dict:
        with self.lock:
            return {"version": 1, "entities": list(self.entities.values())}

    def upsert(self, entity: dict) -> None:
        with self.lock:
            self.entities[entity["id"]] = entity
            payload = f"data: {json.dumps({'type': 'upsert', 'entity': entity})}\n\n"
            for sub in self.subscribers:
                sub.put(payload)

    def clear(self) -> None:
        with self.lock:
            self.entities.clear()
            payload = 'data: {"type": "clear"}\n\n'
            for sub in self.subscribers:
                sub.put(payload)


def make_handler(frontend_dir: Path, state: _State) -> type[BaseHTTPRequestHandler]:
    root = frontend_dir.resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = "geomcore-viewer/0.1"

        def log_message(self, *args: object) -> None:
            pass

        def _send_json(self, obj: object, status: int = 200) -> None:
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/scene":
                self._send_json(state.snapshot())
                return
            # The bundled frontend is built with the Pages base
            # (vite `base: "/geomcore-viewer/"`); strip it for local serving.
            if path == "/geomcore-viewer" or path.startswith("/geomcore-viewer/"):
                path = path[len("/geomcore-viewer") :] or "/"
            if path == "/events":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                sub: queue.Queue[str] = queue.Queue()
                with state.lock:
                    state.subscribers.append(sub)
                try:
                    while True:
                        self.wfile.write(sub.get().encode())
                except (ConnectionError, BrokenPipeError):
                    pass
                finally:
                    with state.lock:
                        state.subscribers.remove(sub)
                return
            target = root / (path.lstrip("/") or "index.html")
            try:
                data = target.resolve().relative_to(root) and target.read_bytes()
            except (OSError, ValueError):
                self.send_error(404)
                return
            assert isinstance(data, bytes)
            self.send_response(200)
            self.send_header("Content-Type", _MIME.get(target.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            if path == "/api/add":
                try:
                    entity = json.loads(raw)
                    assert isinstance(entity.get("id"), str) and isinstance(entity.get("kind"), str)
                except (ValueError, AssertionError):
                    self._send_json({"error": "entity needs string id and kind"}, 400)
                    return
                state.upsert(entity)
                self._send_json({"ok": True})
                return
            if path == "/api/clear":
                state.clear()
                self._send_json({"ok": True})
                return
            self.send_error(404)

    return Handler


class Server:
    """Background local server. Use :meth:`start` / :meth:`stop` or as a context manager."""

    def __init__(self, frontend_dir: str | Path, port: int = 8765) -> None:
        self.state = _State()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(Path(frontend_dir), self.state))
        self.port = self.httpd.server_address[1]
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> "Server":
        self._thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()

    def __enter__(self) -> "Server":
        return self.start()

    def __exit__(self, *args: object) -> None:
        self.stop()
