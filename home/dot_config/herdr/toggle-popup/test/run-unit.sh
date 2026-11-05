#!/bin/sh
# Run the unit tests. test/ is not a package, so a plain `python3 -m unittest`
# finds no tests: this script runs discovery in this folder.
# Usage: ./run-unit.sh [PYTHON], for example: ./run-unit.sh python3.11
set -eu
cd "$(dirname "$0")"
PYTHONDONTWRITEBYTECODE=1 exec "${1:-python3}" -m unittest discover -s .
