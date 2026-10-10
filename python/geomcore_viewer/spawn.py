"""Find or start the background viewer server — one per port, shared by every run."""

from __future__ import annotations

import http.client
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from .server import APP, PROTOCOL

_children: list[subprocess.Popen] = []  # keep handles so they aren't reported as leaked


def _timed_out(err: OSError) -> bool:
    reason = err.reason if isinstance(err, urllib.error.URLError) else err
    return isinstance(reason, (TimeoutError, socket.timeout))


def probe(url: str, timeout: float = 0.5) -> str:
    """``"ours"`` (a v2 geomcore-viewer answers), ``"foreign"`` (something else
    answers), ``"unresponsive"`` (something accepts the connection but does not
    answer within ``timeout``) or ``"none"`` (nothing listens)."""
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=timeout) as res:
            doc = json.loads(res.read())
    except urllib.error.HTTPError:
        return "foreign"
    except (ValueError, http.client.HTTPException):
        return "foreign"
    except OSError as err:
        return "unresponsive" if _timed_out(err) else "none"
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
            "or another application). Stop it, or "
            "set GEOMCORE_VIEWER_URL=http://127.0.0.1:<other port> or pass url=."
        )
    parsed = urlparse(url)
    if parsed.hostname not in ("127.0.0.1", "localhost"):
        raise RuntimeError(f"no geomcore-viewer at {url} (only local servers are started automatically)")
    if state == "unresponsive":
        raise RuntimeError(
            f"{url} accepted the connection but did not answer /api/health in time (a hung server?). "
            "Stop it with `python -m geomcore_viewer stop`, or pass Viewer(url=...)"
        )
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
