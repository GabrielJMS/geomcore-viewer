"""Client: build a scene incrementally, push it live, or save it to disk."""

from __future__ import annotations

import json
import urllib.request
import webbrowser
from pathlib import Path


class Viewer:
    """Append entities; they appear in the open viewer page as they arrive.

    ``frontend_dir`` is only needed for :meth:`serve` — pass the built
    ``frontend/dist`` directory (or the installed package data once published).
    """

    def __init__(self, url: str = "http://127.0.0.1:8765") -> None:
        self.url = url.rstrip("/")
        self.entities: dict[str, dict] = {}

    # -- entities ---------------------------------------------------------
    def _upsert(self, entity: dict) -> dict:
        self.entities[entity["id"]] = entity
        try:
            req = urllib.request.Request(
                f"{self.url}/api/add",
                data=json.dumps(entity).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=2)
        except OSError:
            pass  # no local server — entity stays local until save()/serve()
        return entity

    def add_curve3d(self, id: str, points, color: str = "#ff5533", name: str = "") -> dict:
        return self._upsert({"id": id, "kind": "curve3d", "points": list(points), "color": color, "name": name or id})

    def add_curve2d(self, id: str, points, color: str = "#ff5533", name: str = "") -> dict:
        return self._upsert({"id": id, "kind": "curve2d", "points": list(points), "color": color, "name": name or id})

    def add_surface(self, id: str, vertices, indices, color: str = "#4d94ff", name: str = "") -> dict:
        return self._upsert(
            {"id": id, "kind": "surface", "vertices": list(vertices), "indices": list(indices),
             "color": color, "name": name or id}
        )

    def add_points3d(self, id: str, positions, color: str = "#ffffff", size: int = 2, name: str = "") -> dict:
        return self._upsert(
            {"id": id, "kind": "points3d", "positions": list(positions),
             "color": color, "size": size, "name": name or id}
        )

    def add_points2d(self, id: str, positions, color: str = "#66ccff", size: int = 3, name: str = "") -> dict:
        return self._upsert(
            {"id": id, "kind": "points2d", "positions": list(positions),
             "color": color, "size": size, "name": name or id}
        )

    def clear(self) -> None:
        self.entities.clear()
        try:
            urllib.request.urlopen(f"{self.url}/api/clear", data=b"{}", timeout=2)
        except OSError:
            pass

    # -- persistence / serving --------------------------------------------
    def scene(self) -> dict:
        return {"version": 1, "entities": list(self.entities.values())}

    def save(self, path: str | Path) -> Path:
        out = Path(path)
        out.write_text(json.dumps(self.scene()))
        return out

    def serve(self, frontend_dir: str | Path, port: int = 8765, open_browser: bool = True):
        """Serve the viewer locally and push all buffered entities to it."""
        from .server import Server

        server = Server(frontend_dir, port).start()
        self.url = server.url
        for entity in self.entities.values():
            self._upsert(entity)
        if open_browser:
            webbrowser.open(server.url)
        return server
