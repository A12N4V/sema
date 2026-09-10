#!/usr/bin/env bash
# One-command dev environment: FastAPI (:8123) + Vite (:5173, proxies /api).
#   ./dev.sh
# First time on this machine? Run ./scripts/setup.sh, or just run this: it will
# offer to do the setup for you.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x backend/.venv/bin/uvicorn ] || [ ! -d frontend/node_modules ]; then
  echo "dependencies are not installed yet."
  read -r -p "run ./scripts/setup.sh now? [Y/n] " reply
  case "${reply:-y}" in
    [nN]*) echo "ok, run ./scripts/setup.sh when you are ready."; exit 1 ;;
    *)     ./scripts/setup.sh ;;
  esac
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

( cd backend && exec ./.venv/bin/uvicorn app.main:app --reload --port 8123 ) &
pids+=($!)
( cd frontend && exec npm run dev ) &
pids+=($!)

echo "──────────────────────────────────────────────"
echo "  Sema dev up:  http://localhost:5173"
echo "  API docs:       http://localhost:8123/docs"
echo "──────────────────────────────────────────────"
wait
