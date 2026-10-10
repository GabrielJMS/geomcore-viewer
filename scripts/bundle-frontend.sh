#!/usr/bin/env sh
# Build the frontend and copy it into the Python package (shipped in the wheel).
set -eu
cd "$(dirname "$0")/.."
(cd frontend && npm run build)
rm -rf python/geomcore_viewer/_frontend
cp -r frontend/dist python/geomcore_viewer/_frontend
echo "bundled frontend into python/geomcore_viewer/_frontend"
