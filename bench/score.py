"""Run every benchmark and the correctness gate for one checkout; print JSON.

    backend/.venv/bin/python bench/score.py [--root DIR] [--skip-gate] [--save-baseline]

Output: {"gate": {...}, "metrics": {...}, "ratios": {...}, "score": float}
  gate     pass/fail per stage + test counts (backend_tests, frontend_tests)
  metrics  raw numbers from backend_bench.py and ui_bench.mjs (lower is better)
  ratios   metric / baseline (bench/baseline.json in the *main* repo)
  score    geometric mean of ratios; < 1.0 means better than baseline
"""
from __future__ import annotations

import argparse, json, math, re, subprocess, sys
from pathlib import Path

MAIN = Path(__file__).resolve().parents[1]
BASELINE = MAIN / "bench" / "baseline.json"
# Timings are noisy; payload and audit numbers are exact.
NOISY = re.compile(r"_ms$")


def sh(cmd: list[str], cwd: Path, timeout: int = 1200, stdout_only: bool = False) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout if stdout_only else p.stdout + p.stderr


def gate(root: Path) -> dict:
    py = str(MAIN / "backend/.venv/bin/python")
    g: dict = {}
    rc, out = sh([py, "-m", "pytest", "tests/", "-q", "-p", "no:cacheprovider",
                  "--deselect", "tests/test_source.py"], root / "backend")
    g["backend"] = rc == 0
    g["backend_tests"] = int(m.group(1)) if (m := re.search(r"(\d+) passed", out)) else 0
    if rc: g["backend_log"] = out[-3000:]
    fe = root / "frontend"
    for name, cmd in [("typecheck", ["npx", "tsc", "--noEmit", "-p", "tsconfig.app.json"]),
                      ("lint", ["npm", "run", "lint", "--silent"]),
                      ("frontend", ["npx", "vitest", "run"])]:
        rc, out = sh(cmd, fe)
        g[name] = rc == 0
        if name == "frontend":
            g["frontend_tests"] = int(m.group(1)) if (m := re.search(r"Tests\s+(\d+) passed", out)) else 0
        if rc: g[f"{name}_log"] = out[-3000:]
    g["ok"] = all(g[k] for k in ("backend", "typecheck", "lint", "frontend"))
    return g


def _last_json(out: str) -> dict:
    return json.loads([l for l in out.splitlines() if l.startswith("{")][-1])


def metrics(root: Path) -> dict:
    py = str(MAIN / "backend/.venv/bin/python")
    m: dict = {}
    rc, out = sh([py, str(root / "bench/backend_bench.py"), "--reps", "7"], root, stdout_only=True)
    m.update(_last_json(out) if rc == 0 else {"backend_bench_error": 1})
    rc, out = sh(["node", str(root / "bench/ui_bench.mjs")], root, stdout_only=True)
    m.update(_last_json(out) if rc == 0 else {"ui_bench_error": 1})
    return m


def compare(m: dict, base: dict) -> tuple[dict, float]:
    ratios = {}
    for k, b in base.items():
        if k in m:
            # +1 smoothing so a count going 2 -> 0 is a finite, large win.
            ratios[k] = round((m[k] + 1) / (b + 1) if not NOISY.search(k) else m[k] / max(b, 1e-6), 4)
    score = math.exp(sum(math.log(max(r, 1e-3)) for r in ratios.values()) / max(len(ratios), 1))
    return ratios, round(score, 4)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=MAIN)
    ap.add_argument("--skip-gate", action="store_true")
    ap.add_argument("--save-baseline", action="store_true")
    a = ap.parse_args()
    root = a.root.resolve()
    res: dict = {"gate": {"ok": True} if a.skip_gate else gate(root), "metrics": metrics(root)}
    if a.save_baseline:
        BASELINE.write_text(json.dumps(res["metrics"], indent=1) + "\n")
    base = json.loads(BASELINE.read_text()) if BASELINE.exists() else res["metrics"]
    res["ratios"], res["score"] = compare(res["metrics"], base)
    print(json.dumps(res))


if __name__ == "__main__":
    sys.exit(main())
