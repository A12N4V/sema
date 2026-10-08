# Sema agent program

You are improving **Sema**, a browser workbench over MNE-Python (FastAPI backend
in `backend/app`, React + Vite + Tailwind frontend in `frontend/src`). Read
`docs/ARCHITECTURE.md` before touching structure; it says what bites.

## Rules
- Work only inside the current directory. Never touch `bench/baseline.json`,
  `bench/score.py`, `bench/*_bench.*`, `backend/tests/test_bench_guards.py`,
  `backend/tests/test_api_robustness.py`, or anything in `agents/`. Never weaken
  an assertion in `frontend/e2e/*.spec.ts` (adding new ones is welcome).
  Gaming the measurement (e.g. moving inline styles into ref callbacks, hiding
  content to dodge overlap checks) is a discard.
- Do not delete or weaken existing tests. Add tests for behaviour you change.
- Nothing reimplements signal processing; MNE does it. Keep numeric results
  identical (or within the tolerances the guard tests state).
- Match the surrounding code style and comment density. Small, legible diffs
  beat clever rewrites. One coherent idea per attempt.
- No new runtime dependencies unless the win is large and you say why.

## Measuring
- Gate (must be green): `backend/.venv/bin/python bench/score.py --root .`
  runs backend pytest, tsc, oxlint, vitest, then the benchmarks.
- Quick loops: `backend/.venv/bin/python -m pytest backend/tests -q -x --deselect backend/tests/test_source.py`
  (run from `backend/`: `cd backend && .venv/bin/python -m pytest tests -q -x`),
  `cd frontend && npx vitest run`, `backend/.venv/bin/python bench/backend_bench.py`,
  `node bench/ui_bench.mjs --no-build`.
- Browser: `cd frontend && npx playwright test e2e/ux.spec.ts` (UX floor),
  `node bench/ux_bench.mjs --shots` then read `bench/out/ux_detail.json` (per
  page@viewport breakdown) and look at `bench/out/ux/*.png`.
- Ops: `backend/.venv/bin/python bench/ops_bench.py`.
- Fast gate while iterating: `bench/score.py --root . --no-e2e`; run the full
  one (with Playwright) once before you commit.
- All metrics are lower-is-better. Timings (`*_ms`) are noisy (±20%); payload
  (`*_kb`) and UI audit counts are exact.
