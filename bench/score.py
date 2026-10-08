"""Run every benchmark and the correctness gate for one checkout; print JSON.

    backend/.venv/bin/python bench/score.py [--root DIR] [--skip-gate] [--save-baseline]

Output: {"gate": {...}, "metrics": {...}, "ratios": {...}, "score": float}
  gate     pass/fail per stage + test counts (backend_tests, frontend_tests)
  metrics  raw numbers from backend_bench.py and ui_bench.mjs (lower is better)
  ratios   metric / baseline (bench/baseline.json in the *main* repo)
  score    geometric mean of ratios; < 1.0 means better than baseline

Benchmarks: backend_bench.py (endpoint latency/payload), ops_bench.py (every
registered op), ui_bench.mjs (icon/style audit + bundle), ux_bench.mjs (real
browser: a11y, layout, tap targets, CLS, interaction timings). Gate: pytest,
tsc, oxlint, vitest, and the full Playwright suite (e2e/*.spec.ts).
"""
from __future__ import annotations

import argparse, json, math, os, re, socket, subprocess, sys
from pathlib import Path

MAIN = Path(__file__).resolve().parents[1]
BASELINE = MAIN / "bench" / "baseline.json"
# Timings are noisy; payload and audit numbers are exact.
NOISY = re.compile(r"_ms$")


def sh(cmd: list[str], cwd: Path, timeout: int = 1200, stdout_only: bool = False,
       env: dict | None = None) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout,
                       env={**os.environ, **(env or {})})
    return p.returncode, p.stdout if stdout_only else p.stdout + p.stderr


def free_port() -> str:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return str(s.getsockname()[1])


def gate(root: Path, e2e: bool = True) -> dict:
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
    stages = ["backend", "typecheck", "lint", "frontend"]
    if e2e:
        # Fresh ports: never reuse a server some other checkout started.
        rc, out = sh(["npx", "playwright", "test", "--reporter=line"], fe, timeout=1800,
                     env={"SEMA_API_PORT": free_port(), "SEMA_WEB_PORT": free_port()})
        g["e2e"] = rc == 0
        g["e2e_tests"] = int(m.group(1)) if (m := re.search(r"(\d+) passed", out)) else 0
        if rc: g["e2e_log"] = out[-4000:]
        stages.append("e2e")
    g["ok"] = all(g[k] for k in stages)
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
    rc, out = sh([py, str(root / "bench/ops_bench.py")], root, stdout_only=True)
    m.update(_last_json(out) if rc == 0 else {"ops_bench_error": 1})
    # ui_bench just built frontend/dist, so the UX run serves that build.
    rc, out = sh(["node", str(root / "bench/ux_bench.mjs"), "--root", str(root), "--no-build", "--shots"],
                 root, stdout_only=True, timeout=1800)
    m.update(_last_json(out) if rc == 0 else {"ux_bench_error": 1})
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
    ap.add_argument("--no-e2e", action="store_true", help="gate without the Playwright suite (fast loop)")
    ap.add_argument("--save-baseline", action="store_true")
    a = ap.parse_args()
    root = a.root.resolve()
    res: dict = {"gate": {"ok": True} if a.skip_gate else gate(root, e2e=not a.no_e2e), "metrics": metrics(root)}
    if a.save_baseline:
        BASELINE.write_text(json.dumps(res["metrics"], indent=1) + "\n")
    base = json.loads(BASELINE.read_text()) if BASELINE.exists() else res["metrics"]
    res["ratios"], res["score"] = compare(res["metrics"], base)
    print(json.dumps(res))


if __name__ == "__main__":
    sys.exit(main())
