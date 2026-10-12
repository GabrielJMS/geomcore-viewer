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

_children: dict[int, subprocess.Popen] = {}  # servers this process started, by port; reaped in stop_server


def _timed_out(err: OSError) -> bool:
    reason = err.reason if isinstance(err, urllib.error.URLError) else err
    return isinstance(reason, (TimeoutError, socket.timeout))


def _refused(err: urllib.error.HTTPError) -> bool:
    """A 403 from a geomcore-viewer whose Host check rejected the URL (a tunnel to another port)."""
    if err.code != 403:
        return False
    try:
        doc = json.loads(err.read())
    except (ValueError, OSError, http.client.HTTPException):  # e.g. IncompleteRead: the body was cut short
        return False
    return isinstance(doc, dict) and doc.get("app") == APP


def refused_hint(url: str) -> str:
    """What to tell the user when a geomcore-viewer refuses ``url``."""
    port = urlparse(url).port or 80
    return (
        f"the geomcore-viewer at {url} refused the request: it only answers to its own address, "
        f"so an SSH tunnel must keep the port (ssh -L {port}:127.0.0.1:{port} <host>)"
    )


def probe(url: str, timeout: float = 0.5) -> str:
    """``"ours"`` (a v2 geomcore-viewer answers), ``"refused"`` (a geomcore-viewer
    answers but rejects this URL's host, e.g. through a tunnel that changes the
    port), ``"foreign"`` (something else answers), ``"unresponsive"`` (something
    accepts the connection but does not answer within ``timeout``) or ``"none"``
    (nothing listens)."""
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=timeout) as res:
            doc = json.loads(res.read())
    except urllib.error.HTTPError as err:
        return "refused" if _refused(err) else "foreign"
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
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        cwd=os.path.expanduser("~"),  # do not keep the script's directory busy (unmounting, deleting)
        **detach,
    )
    stale = _children.get(port)
    if stale is not None:
        stale.poll()  # a server that exited on its own: reap before dropping the handle
    _children[port] = proc
    return proc


def ensure_server(url: str, timeout: float = 3.0) -> bool:
    """Make sure a geomcore-viewer answers at ``url``; return True if this call started it.

    Raises RuntimeError when another application holds the port, when a
    geomcore-viewer refuses ``url`` (a tunnel that changes the port), when
    ``url`` is not local, or when the started server does not answer within
    ``timeout`` (spec: ≤ 3 s).
    """
    state = probe(url)
    if state == "ours":
        return False
    if state == "refused":
        raise RuntimeError(refused_hint(url))
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
            _children.pop(port, None)
            raise RuntimeError(
                f"the viewer server exited with code {proc.returncode}; "
                f"run `python -m geomcore_viewer serve --port {port}` to see why"
            )
        time.sleep(0.05)
    raise RuntimeError(f"the viewer server did not answer at {url} within {timeout:.0f} s")


def stop_server(url: str) -> bool:
    """Ask the server at ``url`` to shut down; False when nothing answered."""
    req = urllib.request.Request(f"{url}/api/shutdown", data=b"{}", method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=2):
            pass
    except OSError:
        return False
    port = urlparse(url).port or 80
    child = _children.pop(port, None)
    if child is not None:
        try:
            child.wait(timeout=2)  # reap it so it does not linger as a zombie
        except subprocess.TimeoutExpired:
            _children[port] = child
    return True
