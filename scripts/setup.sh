#!/usr/bin/env bash
# First run. Installs everything and leaves you one command from a workbench.
#
#   ./scripts/setup.sh              deps only
#   ./scripts/setup.sh --with-e2e   also install the Playwright browser
#
# Safe to re-run: every step is a no-op once it has been done.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_E2E=0
[ "${1:-}" = "--with-e2e" ] && WITH_E2E=1

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()   { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

bold "Sema setup"

# ---------------------------------------------------------------- uv
step "uv (Python package manager)"
if command -v uv >/dev/null 2>&1; then
  ok "uv $(uv --version | awk '{print $2}')"
else
  warn "not found, installing from astral.sh"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # the installer drops it in ~/.local/bin, which may not be on PATH yet
  export PATH="$HOME/.local/bin:$PATH"
  command -v uv >/dev/null 2>&1 || die "uv install failed; see https://docs.astral.sh/uv/"
  ok "uv installed"
fi

# ---------------------------------------------------------------- backend
step "backend"
# uv reads backend/.python-version and fetches CPython 3.11 itself if the
# machine does not have it. MNE's dependency chain is not solid on 3.13+, which
# is why the version is pinned rather than left to whatever `python3` is.
(cd backend && uv sync --group dev)
ok "backend/.venv ready ($(cd backend && ./.venv/bin/python -c 'import mne; print("mne", mne.__version__)'))"

# ---------------------------------------------------------------- frontend
step "frontend"
command -v node >/dev/null 2>&1 || die "node not found: install Node 20+ (https://nodejs.org)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "node $NODE_MAJOR is too old, need 20+"
(cd frontend && npm install --no-fund --no-audit)
ok "frontend/node_modules ready (node $(node -v))"

if [ "$WITH_E2E" = "1" ]; then
  step "browser for the end-to-end suite"
  (cd frontend && npx playwright install chromium)
  ok "chromium ready"
fi

# ---------------------------------------------------------------- smoke test
step "smoke test"
if (cd backend && ./.venv/bin/python -c "
from app.core.demo import make_demo_raw
raw = make_demo_raw()
assert raw.info['nchan'] > 0
print(f\"  synthetic recording: {raw.info['nchan']} ch @ {raw.info['sfreq']:g} Hz, {raw.times[-1]:.0f}s\")
" 2>/dev/null); then
  ok "MNE loads and the sample recording builds"
else
  warn "sample recording failed to build; ./dev.sh will still start, check the log"
fi

cat <<'EOF'

──────────────────────────────────────────────────────────
  Ready.

    ./dev.sh              start it, then open localhost:5173
    ./scripts/check.sh    run the tests

  The app opens on a launcher: click "Synthetic sample" to
  get a recording without downloading anything.
──────────────────────────────────────────────────────────
EOF
