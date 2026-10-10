#!/usr/bin/env sh
# Copy geomcore's golden fixtures used by the frontend evaluator tests.
# Usage: scripts/refresh-fixtures.sh [path/to/geomcore/tests/fixtures]
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../../geomcore/tests/fixtures}"
dst="$here/../frontend/test/fixtures"
mkdir -p "$dst"
cp "$src/curves_analytic.json" "$src/surfaces_analytic.json" "$dst/"
echo "copied fixtures from $src"
