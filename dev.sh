#!/usr/bin/env bash
# One-command dev environment: FastAPI (:8123) + Vite (:5173, proxies /api).
#   ./dev.sh
set -euo pipefail
cd "$(dirname "$0")"

BACKEND_VENV="backend/venv/bin"
if [ ! -x "$BACKEND_VENV/uvicorn" ]; then
  echo "backend venv missing — run:  cd backend && python3.11 -m venv venv && ./venv/bin/pip install -r requirements.txt"
  exit 1
fi
if [ ! -d frontend/node_modules ]; then
  echo "installing frontend deps…"
  (cd frontend && npm install)
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

( cd backend && exec ./venv/bin/uvicorn app.main:app --reload --port 8123 ) &
pids+=($!)
( cd frontend && exec npm run dev ) &
pids+=($!)

echo "──────────────────────────────────────────────"
echo "  EEGvis dev up:  http://localhost:5173"
echo "  API docs:       http://localhost:8123/docs"
echo "──────────────────────────────────────────────"
wait
