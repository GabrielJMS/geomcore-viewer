"""Serve a frontend directory: ``python -m geomcore_viewer serve --dir frontend/dist``."""

import argparse
import webbrowser

from .server import Server


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True, help="built frontend directory (frontend/dist)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    with Server(args.dir, args.port) as server:
        print(f"serving {args.dir} at {server.url}")
        if not args.no_browser:
            webbrowser.open(server.url)
        try:
            input("press enter to stop\n")
        except (EOFError, KeyboardInterrupt):
            pass


if __name__ == "__main__":
    main()
