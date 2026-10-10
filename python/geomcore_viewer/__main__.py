"""Command line: ``python -m geomcore_viewer serve|stop`` (installed as ``geomcore-viewer``)."""

from __future__ import annotations

import argparse
import webbrowser

from .server import Server, default_port
from .spawn import stop_server


def main(argv: list[str] | None = None) -> None:
    port_help = "default: the port of $GEOMCORE_VIEWER_URL, else 8765"
    parser = argparse.ArgumentParser(prog="geomcore-viewer")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="serve the viewer in the foreground")
    serve.add_argument("--dir", default=None, help="frontend directory (default: the bundled build)")
    serve.add_argument("--port", type=int, default=default_port(), help=port_help)
    serve.add_argument("--no-browser", action="store_true")
    stop = commands.add_parser("stop", help="stop a running viewer server")
    stop.add_argument("--port", type=int, default=default_port(), help=port_help)
    args = parser.parse_args(argv)

    if args.command == "serve":
        server = Server(args.dir, args.port)
        print(f"geomcore-viewer at {server.url} (Ctrl-C to stop)", flush=True)
        if not args.no_browser:
            webbrowser.open(server.url)
        try:
            server.httpd.serve_forever()
        except KeyboardInterrupt:
            pass  # Ctrl-C is the documented way to stop a foreground server
        finally:
            server.httpd.server_close()
    else:
        url = f"http://127.0.0.1:{args.port}"
        print(f"stopped {url}" if stop_server(url) else f"no viewer running at {url}")


if __name__ == "__main__":
    main()
