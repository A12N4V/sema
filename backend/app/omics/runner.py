"""Runs: a folder per run, a ledger per folder, one run executing at a time.

How a workflow is executed lives in app/engines; this module only owns the run
folder, the ledger, and the one-at-a-time lock.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .engines import ENGINES
from .engines.common import Ctx
from .engines.rscript import find_rscript  # noqa: F401  (re-exported for /capabilities)
from .workflows import REPO, Workflow, all_workflows, coerce

RUNS = Path(os.environ.get("HODOS_RUNS", REPO / "omics-data" / "runs"))
INPUTS = Path(os.environ.get("HODOS_INPUTS", REPO / "omics-data" / "inputs"))

_lock = threading.Lock()
_active: dict[str, "Execution"] = {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def resolve_params(wf: Workflow, overrides: dict) -> dict:
    by = {p.name: p for p in wf.params}
    unknown = set(overrides) - set(by)
    if unknown:
        raise ValueError(f"unknown parameter(s): {', '.join(sorted(unknown))}")
    out = {}
    for k, v in overrides.items():
        c = coerce(by[k], v)
        if c != by[k].default:
            out[k] = c
    return out


class Run:
    def __init__(self, path: Path):
        self.path = path

    @property
    def id(self) -> str:
        return self.path.name

    def load(self) -> dict:
        m = json.loads((self.path / "run.json").read_text())
        m.setdefault("engine", "notebook" if m["workflow"] == "snrna" else "R")   # runs from before engines
        return m

    def save(self, meta: dict) -> None:
        tmp = self.path / "run.tmp"
        tmp.write_text(json.dumps(meta, indent=2, default=str))
        tmp.replace(self.path / "run.json")

    def log(self, text: str) -> None:
        with open(self.path / "log.txt", "a", encoding="utf-8") as f:
            f.write(text if text.endswith("\n") else text + "\n")

    @property
    def outputs(self) -> Path:
        return self.path / ("project" if self.load()["workflow"] == "bulk" else "output")


def get_run(run_id: str) -> Run:
    if not re.fullmatch(r"[\w-]+", run_id) or not (RUNS / run_id / "run.json").exists():
        raise KeyError(run_id)
    return Run(RUNS / run_id)


def list_runs() -> list[dict]:
    if not RUNS.exists():
        return []
    out = []
    for p in sorted(RUNS.iterdir(), reverse=True):
        if (p / "run.json").exists():
            m = json.loads((p / "run.json").read_text())
            out.append({k: m.get(k) for k in ("id", "workflow", "engine", "created", "status", "source", "label")})
    return out


def input_dir(workflow: str, source: str) -> Path:
    return INPUTS / (f"{workflow}-demo" if source == "demo" else workflow)


def create_run(workflow: str, source: str, engine: str | None = None, label: str = "") -> Run:
    wf = all_workflows()[workflow]
    engine = engine or wf.engine
    if engine not in wf.engines:
        raise ValueError(f"{wf.name} runs on {', '.join(wf.engines)}, not {engine}")
    rid = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    path = RUNS / rid
    path.mkdir(parents=True)
    src = input_dir(workflow, source)
    ENGINES[engine].prepare(path, src)
    run = Run(path)
    run.save({
        "id": rid, "workflow": workflow, "engine": engine, "source": source, "label": label or wf.name,
        "input_dir": str(src), "created": now(), "status": "idle",
        "stages": {s.id: "pending" for s in wf.stages}, "ledger": [],
    })
    return run


class Execution(threading.Thread):
    def __init__(self, run: Run, engine: str, overrides: dict, stage_ids: list[str]):
        super().__init__(daemon=True)
        self.run_, self.engine = run, engine
        self.cancelled = False
        self.ctx = Ctx(run.path, Path(run.load()["input_dir"]), overrides, stage_ids,
                       log=run.log, stage=self._stage, is_cancelled=lambda: self.cancelled)

    def _stage(self, sid: str, state: str) -> None:
        m = self.run_.load()
        if sid in m["stages"]:
            m["stages"][sid] = state
            self.run_.save(m)

    def cancel(self) -> None:
        self.cancelled = True
        for p in self.ctx.procs:
            try:
                if hasattr(p, "terminate"):
                    p.terminate()
                elif getattr(p, "km", None) is not None:
                    p.km.interrupt_kernel()
            except Exception:
                pass

    def run(self) -> None:
        t0 = time.time()
        try:
            ok = ENGINES[self.engine].execute(self.ctx)
            status = "cancelled" if self.cancelled else ("done" if ok else "failed")
        except Exception as exc:   # surface anything unexpected in the log, never swallow it
            self.run_.log(f"!! hodos: {type(exc).__name__}: {exc}")
            status = "cancelled" if self.cancelled else "failed"
        m = self.run_.load()
        for k, v in m["stages"].items():
            if v == "running":
                m["stages"][k] = "failed" if status == "failed" else "pending"
        m["status"] = status
        m["ledger"][-1].update(status=status, finished=now(), seconds=round(time.time() - t0, 1))
        self.run_.save(m)
        _active.pop(self.run_.id, None)


def execute(run: Run, overrides: dict, stage_from: str | None, stage_to: str | None) -> dict:
    meta = run.load()
    wf = all_workflows()[meta["workflow"]]
    ids = [s.id for s in wf.stages]
    a = ids.index(stage_from) if stage_from else 0
    b = ids.index(stage_to) if stage_to else len(ids) - 1
    if a > b:
        raise ValueError("first stage comes after the last")
    clean = resolve_params(wf, overrides)
    with _lock:
        if _active:
            raise RuntimeError(f"run {next(iter(_active))} is still executing; one at a time")
        selected = ids[a: b + 1]
        if meta["engine"] == "notebook":
            selected = ids[: b + 1]          # a fresh kernel always replays from the top
        meta["status"] = "running"
        for s in selected:
            meta["stages"][s] = "pending"
        meta["ledger"].append({"n": len(meta["ledger"]) + 1, "started": now(), "params": clean,
                               "stages": [selected[0], selected[-1]], "status": "running",
                               "source": meta["source"], "engine": meta["engine"]})
        run.save(meta)
        ex = Execution(run, meta["engine"], clean, selected)
        _active[run.id] = ex
        ex.start()
    return run.load()


def cancel(run: Run) -> bool:
    ex = _active.get(run.id)
    if not ex:
        return False
    ex.cancel()
    return True


def is_active(run_id: str) -> bool:
    return run_id in _active


def export_bundle(run: Run, entry: int | None = None) -> dict[str, bytes]:
    meta = run.load()
    if not meta["ledger"]:
        raise ValueError("nothing has been run yet")
    e = meta["ledger"][(entry or len(meta["ledger"])) - 1]
    files = ENGINES[e.get("engine", meta["engine"])].bundle(e["params"], e["stages"])
    files["ledger.json"] = json.dumps(meta["ledger"], indent=2).encode()
    files["run.sh"] = files["run.sh"].replace(
        b"set -euo", f"# Reproduces hodos run {run.id}, ledger entry {e['n']}.\nset -euo".encode(), 1)
    return files
