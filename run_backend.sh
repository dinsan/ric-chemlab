#!/usr/bin/env bash
# Builds the C++ core (if g++ exists), installs Python deps, starts the API on :8000
set -e
cd "$(dirname "$0")"
if command -v g++ >/dev/null; then ./cpp/build.sh; else echo "g++ not found - using slower NumPy fallback"; fi
cd backend
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
