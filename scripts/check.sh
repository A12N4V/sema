#!/usr/bin/env bash
# One command to answer "is anything broken?", run it before and after a change.
#
#   ./scripts/check.sh          everything except the browser suite
#   ./scripts/check.sh fast     also skip the slow source-localisation tests
#   ./scripts/check.sh e2e      everything plus Playwright against real servers
#
# Exits non-zero on the first failing stage, so it works as a pre-commit hook
# or a CI step as-is.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-all}"
FAILED=()

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAILED+=("$1"); }

run() { # run <name> <dir> <cmd...>
  local name="$1" dir="$2"; shift 2
  bold "▸ $name"
  if (cd "$dir" && "$@" >/tmp/sema-check.$$.log 2>&1); then
    pass "$name"
  else
    fail "$name"
    tail -30 /tmp/sema-check.$$.log | sed 's/^/    /'
  fi
  rm -f /tmp/sema-check.$$.log
}

PY="$ROOT/backend/.venv/bin/python"
[ -x "$PY" ] || { echo "no venv at $PY, run ./scripts/setup.sh first"; exit 1; }

if [ "$MODE" = "fast" ]; then
  run "backend tests (fast)" "$ROOT/backend" "$PY" -m pytest tests/ -q \
      --deselect tests/test_source.py
else
  run "backend tests" "$ROOT/backend" "$PY" -m pytest tests/ -q
fi

run "frontend typecheck" "$ROOT/frontend" npx tsc --noEmit -p tsconfig.app.json
run "frontend lint"      "$ROOT/frontend" npm run lint --silent
run "frontend tests"     "$ROOT/frontend" npm test --silent

# The browser suite starts (or reuses) both servers and drives a real Chromium,
# so it costs ~2 min. Opt in before a commit, not on every save.
if [ "$MODE" = "e2e" ]; then
  run "browser tests" "$ROOT/frontend" npx playwright test
fi

echo
if [ ${#FAILED[@]} -eq 0 ]; then
  bold "all clear"
else
  bold "${#FAILED[@]} failing: ${FAILED[*]}"
  exit 1
fi
