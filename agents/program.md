# Sema agent program

You are improving **Sema**, a browser workbench over MNE-Python (FastAPI backend
in `backend/app`, React + Vite + Tailwind frontend in `frontend/src`). Read
`docs/ARCHITECTURE.md` before touching structure; it says what bites.

## Rules
- Work only inside the current directory. Never touch `bench/baseline.json`,
  `bench/score.py`, `bench/*_bench.*`, `backend/tests/test_bench_guards.py`,
  or anything in `agents/`. Gaming the measurement is a discard.
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
- All metrics are lower-is-better. Timings (`*_ms`) are noisy (±20%); payload
  (`*_kb`) and UI audit counts are exact.
