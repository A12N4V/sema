"""Agent team + autoresearch loop over Sema, driven by MiniMax Code (mcode) with
GLM via OpenRouter. Each agent works in its own git worktree; its change is kept
only if the gate is green and bench/score.py says it helped.

    python3 agents/team.py setup                  # one-time: private mcode profile + OpenRouter provider
    python3 agents/team.py wave [--only a,b]      # run the TASKS below in parallel; winners become candidates
    python3 agents/team.py merge <branch> <task>  # merge a reviewed candidate if it is still strictly better
    python3 agents/team.py loop --iters 10        # autoresearch: one hypothesis at a time, keep/discard
    python3 agents/team.py watch                  # tail every agent's tool calls, messages and verdicts live

Everything lands on the branch `agents/integration` (never main). Every attempt
is appended to agents/results.tsv; transcripts and scores go to agents/.state/runs/.
"""
from __future__ import annotations

import argparse, concurrent.futures as cf, threading, datetime as dt, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "agents" / ".state"
WT = ROOT / "agents" / ".wt"
RESULTS = ROOT / "agents" / "results.tsv"
PROGRAM = ROOT / "agents" / "program.md"
MCODE = Path(os.environ.get("MCODE", next((p for p in (
    Path.home() / "deferential/.build/minimax-code/bin/mcode",
    Path.home() / ".kula-team/mcode-npm/node_modules/.bin/mcode") if p.exists()),
    Path.home() / "deferential/.build/minimax-code/bin/mcode")))
# Run under a spend meter (meter_proxy.py -- python3 agents/team.py ...): it hands the
# child DEF_METER_TOKEN and serves the OpenRouter API on 127.0.0.1:$METER_PORT.
BASE_URL = os.environ.get("SEMA_AGENT_BASE_URL") or (
    f"http://127.0.0.1:{os.environ.get('METER_PORT', '47391')}/api/v1" if os.environ.get("DEF_METER_TOKEN")
    else "https://openrouter.ai/api/v1")
MODEL = os.environ.get("SEMA_AGENT_MODEL", "z-ai/glm-5.3-flash")
INTEGRATION = "agents/integration"
GIT_LOCK = threading.Lock()
# Benchmarks must run one at a time: parallel agents scoring together compete for CPU
# and every *_ms metric looks like a regression.
SCORE_LOCK = threading.Lock()  # git worktree add/remove race on .git/index.lock
PY = str(ROOT / "backend/.venv/bin/python")
MAX_STEPS = int(os.environ.get("SEMA_AGENT_STEPS", "80"))
TIMEOUT_MIN = int(os.environ.get("SEMA_AGENT_TIMEOUT_MIN", "30"))
# A non-focus metric may get this much worse (timing noise) before we reject.
NOISE = {"ms": 1.35, "other": 1.02}

# focus: metric-name regexes the task is judged on. "tests" = judged on test count growth.
TASKS: dict[str, dict] = {
    "wire": {
        "focus": [r"^window_.*_kb$", r"^overview_kb$", r"^psd_kb$"],
        "brief": "Shrink time-series JSON payloads (/viewer/window, /viewer/overview, /spectral/psd). "
                 "Start in backend/app/core/wire.py. Ideas: round µV to 2 decimals, avoid per-channel "
                 "Python float lists, drop redundant fields. The frontend parser (frontend/src/api, "
                 "lib/plot) must keep working; tests/test_bench_guards.py pins fidelity (0.01 µV).",
    },
    "speed": {
        "focus": [r"^filter_op_ms$", r"^topomap_png_ms$", r"^window_30s_ms$", r"^psd_ms$", r"^demo_session_ms$"],
        "brief": "Make the hot backend paths faster: the filter op (backend/app/core/operations, "
                 "services/ledger.py), topomap PNG rendering (core/render.py, core/topomap.py), the 30 s "
                 "window (core/wire.py, utils/decimate.py) and PSD. Profile first (cProfile on "
                 "bench/backend_bench.py), fix the real hotspot, keep results identical.",
    },
    "omics-wire": {
        "focus": [r"^omics_.*_kb$"],
        "brief": "Shrink the Plethos/Karyon figure payloads: the UMAP spec (clusters/umap and "
                 "/live/umap_gene, ~0.75 MB of JSON) and the volcano (genes/de, ~340 kB). Start in "
                 "backend/app/omics/figures.py (_f, sn_embedding, bulk_de) and live.py. Ideas: fewer "
                 "decimals where the plot cannot show them, a shared index instead of repeated "
                 "category strings, typed arrays as base64. The renderers in frontend/src/omics/figures "
                 "must draw the same picture; backend/tests/omics must stay green.",
    },
    "omics-speed": {
        "focus": [r"^omics_.*_ms$"],
        "brief": "Make the Plethos/Karyon live endpoints faster, above all /live/umap_gene (~600 ms) "
                 "and /live/de_rethreshold (~50 ms), then the figure specs. backend/app/omics/live.py "
                 "and figures.py. Profile first (cProfile on bench/omics_bench.py): the h5ad read and "
                 "pickle loads are the usual suspects – cache what is immutable per run, read only "
                 "the columns needed. Numbers must stay identical; backend/tests/omics must stay green.",
    },
    "icons": {
        "focus": [r"^icon_", r"^raw_hex_colors$", r"^unlabeled_icon_btns$", r"^inline_styles$"],
        "brief": "Iconography and UI consistency in frontend/src. Put every lucide icon on one size "
                 "scale (12 inline/dense, 14 default, 16 toolbar, 20/24 hero only); prefer a shared "
                 "constant or <Icon> wrapper in components/ui/primitives.tsx. Give every icon-only "
                 "button an aria-label. Move hard-coded hex colours and inline styles to theme tokens "
                 "(lib/theme.ts, index.css). Do not change behaviour; vitest must stay green.",
    },
    "a11y": {
        "focus": [r"^ux_axe_", r"^ux_small_targets$", r"^ux_tiny_text$"],
        "brief": "Accessibility, measured in a real browser on every page at phone/tablet/desktop "
                 "(bench/ux_bench.mjs; per-page detail in bench/out/ux_detail.json, screenshots in "
                 "bench/out/ux/). Biggest wins: colour-contrast (raise faint text tokens in "
                 "frontend/src/index.css / lib/theme.ts until WCAG AA 4.5:1, keep the look), page "
                 "landmarks (one <main>, one <h1> per page, labelled regions), 24px minimum hit areas "
                 "for icon buttons (padding, not bigger icons), text no smaller than 11px.",
    },
    "layout": {
        "focus": [r"^ux_overlaps$", r"^ux_cls$", r"^ux_offscreen_ctrls$", r"^ux_clipped_text$", r"^ux_overflow_px$"],
        "brief": "Layout quality across phone (390), tablet (820) and desktop (1440); see "
                 "bench/out/ux_detail.json for which page/viewport is worst and look at the "
                 "screenshots in bench/out/ux/. Known: the channels table overlaps controls on phone "
                 "and tablet; epochs/evoked pages shift layout by ~0.3-0.37 CLS on load (reserve space "
                 "for figures with fixed aspect boxes / skeletons); some controls sit off-screen on "
                 "phone. Fix the layout, don't hide content. Lessons from earlier attempts: global "
                 "rules (min-size on every button, raising the smallest text size) made dense rows "
                 "(channel table, ribbon, container strip) collide and were rejected; fix specific "
                 "components and check ux_overlaps per page in ux_detail.json after every change. Add e2e assertions in "
                 "frontend/e2e/ux.spec.ts for what you fix.",
    },
    "ops": {
        "focus": [r"^op_.*_ms$", r"^ops_total_ms$"],
        "brief": "Make the registered operations faster end to end (bench/ops_bench.py; slowest now: "
                 "detect_bad_channels ~345ms, label_ica, fit_ica, annotate_muscle, filter). Look at "
                 "what Sema does around the MNE call (copies of Raw, ledger snapshots, autoderive, "
                 "precompute invalidation) before touching the MNE call itself. Results must be identical.",
    },
    "tests": {
        "focus": "tests",
        "brief": "Add meaningful tests where coverage is thin. Backend: services/persistence.py, "
                 "services/jobs.py, core/autoderive.py, core/filters.py, api/export.py error paths. "
                 "Frontend: lib/derivation.ts, lib/ops.ts, store edge cases, components/ops/ParamForm. "
                 "Do NOT change production code. Each test must assert real behaviour, not just 'no crash'. "
                 "A previous attempt was rejected for 4 failing tests (filters reference-to-one-channel, "
                 "job manager progress/sweep timing, persistence best-effort save) and an unused import "
                 "that broke tsc: run each new test file and `npx tsc --noEmit -p tsconfig.app.json` "
                 "before committing; if a test exposes a real bug, mark it xfail with the reason.",
    },
}


def sh(cmd, cwd=ROOT, check=True, **kw) -> str:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, **kw)
    if check and p.returncode:
        raise RuntimeError(f"{' '.join(map(str, cmd))}\n{p.stdout}\n{p.stderr}")
    return p.stdout.strip()


def openrouter_key() -> str:
    if k := os.environ.get("DEF_METER_TOKEN") or os.environ.get("OPENROUTER_API_KEY"):
        return k
    cfg = json.loads((Path.home() / ".config/opencode/config.json").read_text())
    return cfg["provider"]["openrouter"]["options"]["apiKey"]


def mcode_env() -> dict:
    return {**os.environ, "MINIMAX_DATA_DIR": str(STATE / "mcode"), "MCODE_DISABLE_TELEMETRY": "1",
            "OPENROUTER_API_KEY": openrouter_key()}


def setup() -> None:
    (STATE / "mcode").mkdir(parents=True, exist_ok=True)
    env = mcode_env()
    if "custom_provider:openrouter" not in sh([MCODE, "provider", "list"], env=env, check=False):
        sh([MCODE, "provider", "add", "--name", "openrouter", "--base-url", BASE_URL,
            "--api-format", "openai-completions", "--model", MODEL, "--api-key-env", "OPENROUTER_API_KEY",
            "--context-limit", "200000", "--output-limit", "16384"], env=env)
    # Merge agents/mcode.yaml (features off, no data contribution) into the profile and pick the model.
    sh(["uv", "run", "--quiet", "--with", "pyyaml", "python", "-c", f"""
import yaml
p={str(STATE / 'mcode/config.yaml')!r}; b=yaml.safe_load(open(p)); o=yaml.safe_load(open({str(ROOT / 'agents/mcode.yaml')!r}))
def m(a,c):
    for k,v in c.items(): a[k]=m(a.get(k,{{}}),v) if isinstance(v,dict) and isinstance(a.get(k),dict) else v
    return a
m(b,o); b['defaultModel']='custom_provider:openrouter/{MODEL}'; yaml.safe_dump(b,open(p,'w'),sort_keys=False)
"""])
    print("mcode profile ready at", STATE / "mcode")


def ensure_integration() -> None:
    if not sh(["git", "branch", "--list", INTEGRATION]):
        sh(["git", "branch", INTEGRATION, "HEAD"])


def make_worktree(name: str, base: str) -> Path:
    with GIT_LOCK:
        return _make_worktree(name, base)


def _make_worktree(name: str, base: str) -> Path:
    path = WT / name
    if path.exists():
        sh(["git", "worktree", "remove", "--force", str(path)], check=False)
    branch = f"agents/{name}"
    sh(["git", "worktree", "add", "-B", branch, str(path), base])
    # Share the heavy, gitignored environments instead of reinstalling per agent.
    for rel in ("backend/.venv", "frontend/node_modules"):
        if not (path / rel).exists():
            (path / rel).symlink_to(ROOT / rel)
    return path


def drop_worktree(path: Path) -> None:
    with GIT_LOCK:
        sh(["git", "worktree", "remove", "--force", str(path)], check=False)
        shutil.rmtree(path, ignore_errors=True)


def score(path: Path) -> dict:
    tag = path.name if path != ROOT else "integration"
    if SCORE_LOCK.locked():
        say(tag, "waiting for the scorer", "\x1b[2m")
    with SCORE_LOCK:
        say(tag, "scoring: gate + benches", "\x1b[33m")
        t0 = time.time()
        res = _score(path)
        say(tag, f"scored in {(time.time() - t0) / 60:.0f}m · gate {'green' if res['gate'].get('ok') else 'RED'} · "
                 f"score {res.get('score')}", "\x1b[33m")
        return res


def _score(path: Path) -> dict:
    out = sh([PY, str(ROOT / "bench/score.py"), "--root", str(path)], check=False, timeout=2400)
    try:
        return json.loads([l for l in out.splitlines() if l.startswith("{")][-1])
    except (IndexError, ValueError):
        return {"gate": {"ok": False, "error": out[-2000:]}, "metrics": {}, "ratios": {}, "score": 99}


def prompt(name: str, task: dict, base_score: dict, history: str = "") -> str:
    focus = task["focus"]
    return f"""{PROGRAM.read_text()}

## Your assignment: `{name}`
{task['brief']}

You are judged on: {'growth in backend_tests + frontend_tests (with the gate green)' if focus == 'tests'
                    else ', '.join(f'`{f}`' for f in focus)}.

Current metrics of the code you start from (lower is better):
```json
{json.dumps(base_score.get('metrics', {}), indent=0)}
```
{history}
Work in the current directory only. When you are finished, run
`backend/.venv/bin/python bench/score.py --root .` yourself, make sure "gate" ok is true,
then `git add -A && git commit -m "<what and why>"`. Reply with a 3-line summary.
"""


MIN_CREDIT = float(os.environ.get("SEMA_AGENT_MIN_CREDIT", "0.5"))


def credit_remaining() -> float | None:
    """OpenRouter key's remaining limit in USD (None = unlimited or unknown)."""
    import urllib.request
    req = urllib.request.Request("https://openrouter.ai/api/v1/key",
                                 headers={"Authorization": f"Bearer {openrouter_key()}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)["data"].get("limit_remaining")
    except Exception:
        return None


def run_agent(name: str, path: Path, text: str, run_dir: Path) -> int:
    """Run mcode, retrying (with backoff) when the provider connection drops
    before the agent did anything; an outage is not an attempt."""
    for i in range(3):
        rc = _run_agent_once(name, path, text, run_dir)
        transient = "Connection error" in (run_dir / "transcript.txt").read_text()[-2000:]
        if rc == 0 or not transient or sh(["git", "status", "--porcelain"], cwd=path):
            return rc
        say(name, f"provider connection error; retry {i + 1}/2 in {60 * (i + 1)}s", "\x1b[31m")
        time.sleep(60 * (i + 1))
    return rc


FEED = STATE / "feed.log"
_feed_lock = threading.Lock()
_TINT = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m", "\x1b[34m", "\x1b[91m"]


def say(tag: str, msg: str, colour: str = "") -> None:
    """One line to stdout and to agents/.state/feed.log (`team.py watch` tails it)."""
    ts = dt.datetime.now().strftime("%H:%M:%S")
    tint = _TINT[sum(map(ord, tag)) % len(_TINT)]
    line = f"\x1b[2m{ts}\x1b[0m {tint}{tag:<10}\x1b[0m {colour}{msg}\x1b[0m"
    with _feed_lock:
        print(line, flush=True)
        STATE.mkdir(parents=True, exist_ok=True)
        with FEED.open("a") as f:
            f.write(line + "\n")


def _tool_line(tc: dict) -> str:
    inp = tc.get("input") or {}
    for key in ("command", "path", "file_path", "pattern", "query"):
        if inp.get(key):
            return f"{tc.get('name')} {str(inp[key]).splitlines()[0][:110]}"
    return str(tc.get("name"))


def _run_agent_once(name: str, path: Path, text: str, run_dir: Path) -> int:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "prompt.md").write_text(text)
    say(name, f"start · {path.name} · ≤{MAX_STEPS} steps · {TIMEOUT_MIN}m", "\x1b[33m")
    proc = subprocess.Popen(
        [MCODE, "exec", "--cwd", str(path), "--prompt-mode", "coding", "--permission", "full",
         "--max-steps", str(MAX_STEPS), "--timeout", f"{TIMEOUT_MIN}m", "--output-format", "stream-json",
         "--input", "-", "-o", str(run_dir / "summary.txt")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env={**mcode_env(), "NO_COLOR": "1"})
    killer = threading.Timer(TIMEOUT_MIN * 60 + 120, proc.kill)
    killer.start()
    proc.stdin.write(text)
    proc.stdin.close()
    tools = 0
    # transcript.txt keeps the raw event stream; the feed gets one readable line per event.
    with open(run_dir / "transcript.txt", "w") as log:
        for line in proc.stdout:
            log.write(line)
            log.flush()
            try:
                e = json.loads(line)
            except Exception:
                if line.strip():
                    say(name, line.strip()[:140], "\x1b[2m")
                continue
            it = e.get("item") or {}
            if e.get("type") == "item.completed" and it.get("type") == "tool_call":
                tc = it.get("toolCall", {})
                tools += 1
                ok = tc.get("status") == 2
                say(name, ("✓ " if ok else "✗ ") + _tool_line(tc), "\x1b[2m" if ok else "\x1b[31m")
            elif e.get("type") == "item.completed" and it.get("type") == "agent_message":
                first = (it.get("content") or "").strip().splitlines()
                if first:
                    say(name, "» " + first[0][:150])
            elif e.get("type") == "exec.completed":
                say(name, f"done · {(e.get('result') or {}).get('status', '?')} · {tools} tool calls", "\x1b[33m")
    rc = proc.wait()
    killer.cancel()
    return rc


def judge(task: dict, base: dict, new: dict) -> tuple[bool, str]:
    if not new["gate"].get("ok"):
        failed = [k for k in ("backend", "typecheck", "lint", "frontend", "e2e") if new["gate"].get(k) is False]
        return False, f"gate failed: {','.join(failed) or new['gate'].get('error', '?')[:80]}"
    bm, nm = base["metrics"], new["metrics"]
    focus = task["focus"]
    if focus == "tests":
        grew = sum(new["gate"].get(k, 0) - base["gate"].get(k, 0) for k in ("backend_tests", "frontend_tests"))
        return (grew > 0, f"+{grew} tests")
    is_focus = lambda k: any(re.search(f, k) for f in focus)  # noqa: E731
    gains, regress = [], []
    for k, b in bm.items():
        if k not in nm:
            continue
        r = (nm[k] + 1e-9) / (b + 1e-9) if b else (1.0 if nm[k] == 0 else 2.0)
        if is_focus(k):
            gains.append(r)
        elif r > NOISE["ms" if k.endswith("_ms") or k == "ux_cls" else "other"]:
            regress.append(f"{k}x{r:.2f}")
    g = (sum(gains) / len(gains)) if gains else 1.0
    if regress:
        return False, f"regressed {' '.join(regress[:4])}"
    return (g <= 0.97, f"focus mean ratio {g:.3f}")


def log_result(name: str, sha: str, kept: bool, why: str, new: dict) -> None:
    if not RESULTS.exists():
        RESULTS.write_text("time\tagent\tcommit\tstatus\tscore\tbackend_tests\tfrontend_tests\tnote\n")
    with RESULTS.open("a") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M}\t{name}\t{sha}\t{'keep' if kept else 'discard'}\t"
                f"{new.get('score', '')}\t{new['gate'].get('backend_tests', '')}\t"
                f"{new['gate'].get('frontend_tests', '')}\t{why}\n")
    write_progress()


def write_progress() -> None:
    """Mirror results.tsv into .state/PROGRESS.md for the live board (progress.py)."""
    try:
        rows = [r.split("\t") for r in RESULTS.read_text().splitlines()[1:] if r.strip()]
        kept = sum(r[3] == "keep" for r in rows)
        out = [f"## sema autoresearch · {len(rows)} attempts · {kept} kept"]
        out += [f"- [{'x' if r[3] == 'keep' else '!'}] {r[0][5:]} {r[1]} · {r[3]} · score {r[4]} · {r[7][:70]}" for r in rows[-12:]]
        (STATE / "PROGRESS.md").write_text("\n".join(out) + "\n")
    except Exception:
        pass


def attempt(name: str, task: dict, base_ref: str, base_score: dict, history: str = "") -> tuple[bool, str]:
    free_gb = shutil.disk_usage(ROOT).free / 1e9
    if free_gb < 6:  # a full disk wedges every process on the machine, not just this loop
        raise RuntimeError(f"only {free_gb:.1f} GB free; refusing to start {name}")
    if (credit := credit_remaining()) is not None and credit < MIN_CREDIT:
        raise RuntimeError(f"OpenRouter credit ${credit:.2f} < ${MIN_CREDIT}; refusing to start {name}")
    stamp = f"{dt.datetime.now():%m%d-%H%M%S}-{name}"
    run_dir = STATE / "runs" / stamp
    path = make_worktree(stamp, base_ref)
    t0 = time.time()
    try:
        rc = run_agent(name, path, prompt(name, task, base_score, history), run_dir)
        sh(["git", "add", "-A"], cwd=path)
        # The agent may or may not have committed; capture anything left over.
        sh(["git", "commit", "-q", "-m", f"agent {name}: uncommitted remainder"], cwd=path, check=False)
        if sh(["git", "rev-parse", "HEAD"], cwd=path) == sh(["git", "rev-parse", base_ref]):
            kept, why, new = False, f"no changes (mcode rc={rc})", {"gate": {}, "score": ""}
        else:
            new = score(path)
            kept, why = judge(task, base_score, new)
            if not kept and why.startswith("regressed") and all(m.split("x")[0].endswith("_ms") for m in why.split()[1:]):
                new = score(path)  # timing-only regression: measure again before believing it
                kept, why = judge(task, base_score, new)
        (run_dir / "score.json").write_text(json.dumps(new, indent=1))
        sha = sh(["git", "rev-parse", "--short", "HEAD"], cwd=path)
        log_result(name, sha, kept, f"{why} ({(time.time() - t0) / 60:.0f}m)", new)
        say(name, f"{'KEEP' if kept else 'discard'}: {why}", "\x1b[32m" if kept else "\x1b[31m")
        return kept, f"agents/{stamp}"
    finally:
        drop_worktree(path)  # branch survives for inspection; the checkout does not


def merge_into_integration(branch: str, task: dict | None = None, current: dict | None = None) -> bool:
    """Merge only if, measured after the merge against integration as it is
    *now*: the gate is green, test counts didn't drop, the task's focus metrics
    still improve, nothing else regresses, and the overall score improves."""
    current = current or score_ref(INTEGRATION)
    path = make_worktree("_integrate", INTEGRATION)
    try:
        sh(["git", "checkout", "-q", "-B", "_integrate_tmp"], cwd=path)
        if subprocess.run(["git", "merge", "--no-edit", "-q", branch], cwd=path).returncode:
            say("merge", f"merge conflict on {branch}; skipped")
            return False
        res = score(path)
        (STATE / "runs").mkdir(parents=True, exist_ok=True)
        (STATE / "runs" / f"merge-{branch.replace('/', '_')}.json").write_text(json.dumps(res, indent=1))
        if not res["gate"].get("ok"):
            failed = [k for k in ("backend", "typecheck", "lint", "frontend", "e2e") if not res["gate"].get(k, True)]
            say("merge", f"{branch} breaks the gate after merge ({','.join(failed)}); skipped")
            return False
        for k in ("backend_tests", "frontend_tests", "e2e_tests"):
            if res["gate"].get(k, 0) < current["gate"].get(k, 0):
                say("merge", f"{branch}: {k} dropped {current['gate'][k]} -> {res['gate'].get(k)}; skipped")
                return False
        if task is not None:
            ok, why = judge(task, current, res)
            if not ok:
                say("merge", f"{branch}: not better after merge ({why}); skipped")
                return False
        if task is None or task["focus"] != "tests":
            if res["score"] >= current["score"]:
                say("merge", f"{branch}: overall score {res['score']} not better than {current['score']}; skipped")
                return False
        sh(["git", "branch", "-f", INTEGRATION, "HEAD"], cwd=path)
        say("merge", f"{branch}: merged, score {current['score']} -> {res['score']}")
        return True
    finally:
        drop_worktree(path)
        sh(["git", "branch", "-D", "_integrate_tmp"], check=False)


def wave(only: list[str] | None, merge: bool = False) -> None:
    ensure_integration()
    base = score_ref(INTEGRATION)
    tasks = {k: v for k, v in TASKS.items() if not only or k in only}
    with cf.ThreadPoolExecutor(max_workers=min(4, len(tasks))) as ex:
        futs = {ex.submit(attempt, n, t, INTEGRATION, base): n for n, t in tasks.items()}
        winners = []
        for f in cf.as_completed(futs):
            try:
                kept, branch = f.result()
            except Exception as e:  # one broken agent must not sink the wave
                say(futs[f], f"crashed: {e}", "\x1b[31m")
                continue
            if kept:
                winners.append((branch, tasks[futs[f]]))
    if not merge:
        print("candidates (review, then `team.py merge <branch> <task>`):", [b for b, _ in winners])
        return
    for b, t in winners:
        merge_into_integration(b, t)


def score_ref(ref: str) -> dict:
    path = make_worktree("_base", ref)
    try:
        return score(path)
    finally:
        drop_worktree(path)


def loop(iters: int) -> None:
    """Autoresearch: each iteration an agent reads the results log, picks the
    most promising untried idea for the weakest metric, and is kept or discarded."""
    ensure_integration()
    base = score_ref(INTEGRATION)
    names = [n for n in TASKS if n != "tests"]
    for i in range(iters):
        name = names[i % len(names)]
        history = ("\n## Previous attempts (results.tsv) — do not repeat a discarded idea\n```\n"
                   + (RESULTS.read_text()[-4000:] if RESULTS.exists() else "none") + "\n```\n")
        kept, branch = attempt(name, TASKS[name], INTEGRATION, base, history)
        if kept and merge_into_integration(branch, TASKS[name], base):
            base = score_ref(INTEGRATION)
            print(f"iteration {i + 1}: integration score now {base['score']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup")
    w = sub.add_parser("wave"); w.add_argument("--only", default="")
    w.add_argument("--merge", action="store_true", help="merge winners without review")
    mg = sub.add_parser("merge"); mg.add_argument("branch"); mg.add_argument("task")
    lp = sub.add_parser("loop"); lp.add_argument("--iters", type=int, default=10)
    sub.add_parser("watch", help="follow every agent's activity live")
    a = ap.parse_args()
    if a.cmd == "watch":
        FEED.touch()
        os.execvp("tail", ["tail", "-n", "60", "-F", str(FEED)])
    if a.cmd == "setup":
        setup()
    elif a.cmd == "wave":
        wave([s for s in a.only.split(",") if s] or None, a.merge)
    elif a.cmd == "merge":
        merge_into_integration(a.branch, TASKS[a.task])
    else:
        loop(a.iters)


if __name__ == "__main__":
    sys.exit(main())
