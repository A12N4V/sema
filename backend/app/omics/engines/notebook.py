"""The snRNA notebook, cell by cell in a Jupyter kernel, unmodified.

Two cells are added, both tagged: the parameters after the authors'
configuration cell, and the figure theme after their environment cell (it has
to come after, because that cell calls sns.set_theme and sc.set_figure_params).
"""
from __future__ import annotations

import base64
from pathlib import Path

import nbformat

from ..workflows import SNRNA_NB, all_workflows
from .common import Ctx

CONFIG_CELL, ENV_CELL = 1, 3     # in the original notebook

# Mirrors frontend/src/index.css, like workflows/bulk-py/utils.py.
_DARK = dict(bg="#0a0b0e", fg="#e8eaee", dim="#9297a2", seam="#23262e")
THEME_CELL = f"""# Figure theme injected by hodos (FIG_THEME = "dark"): the workbench ground.
import matplotlib.pyplot as plt
if FIG_THEME == "dark":
    _t = {_DARK!r}
    plt.rcParams.update({{
        "figure.facecolor": _t["bg"], "axes.facecolor": _t["bg"], "savefig.facecolor": _t["bg"],
        "savefig.edgecolor": _t["bg"], "text.color": _t["fg"], "axes.labelcolor": _t["fg"],
        "axes.titlecolor": _t["fg"], "axes.edgecolor": _t["dim"], "xtick.color": _t["dim"],
        "ytick.color": _t["dim"], "grid.color": _t["seam"], "legend.facecolor": _t["bg"],
        "legend.edgecolor": _t["seam"], "legend.labelcolor": _t["fg"], "patch.edgecolor": _t["dim"],
    }})
"""


GENESETS = SNRNA_NB.parents[1] / "signatures" / "genesets" / "MSIG_GO_BP.json"


def params_cell(overrides: dict, input_dir: Path, output_dir: Path) -> str:
    lines = ["# Parameters injected by hodos. Everything above is the authors' configuration cell.",
             f"CELLBENDER_ROOT = Path({str(input_dir)!r})",
             f"OUTPUT_ROOT = Path({str(output_dir)!r})",
             "DATA_ROOT = CELLBENDER_ROOT.parent",
             f"FIG_THEME = {overrides.get('FIG_THEME', 'dark')!r}"]
    # The workbench ships MSigDB GO:BP for mouse, so pathways run offline unless
    # the analyst points GENESETS_LOCAL elsewhere (or at "" for live Enrichr).
    lines.append(f"GENESETS_LOCAL = {str(GENESETS)!r}")
    lines += [f"{k} = {v!r}" for k, v in overrides.items() if k != "FIG_THEME"]
    lines += ['GROUP = {s: ("VEH" if s.startswith("VEH") else "THC") for s in SAMPLES}',
              "assert set(SAMPLES) == set(GROUP)",
              "assert 0 <= START_STAGE <= 3"]
    return "\n".join(lines)


def parameterised(overrides: dict, input_dir: Path, output_dir: Path) -> nbformat.NotebookNode:
    nb = nbformat.read(SNRNA_NB, as_version=4)
    nbformat.validator.normalize(nb)
    p = nbformat.v4.new_code_cell(params_cell(overrides, input_dir, output_dir))
    p.metadata["tags"] = ["injected-parameters"]
    t = nbformat.v4.new_code_cell(THEME_CELL)
    t.metadata["tags"] = ["injected-theme"]
    nb.cells.insert(ENV_CELL + 1, t)       # after the environment cell
    nb.cells.insert(CONFIG_CELL + 1, p)    # after the configuration cell
    return nb


def shifted(i: int) -> int:
    """Original cell index -> index in the parameterised notebook."""
    return i + (i > CONFIG_CELL) + (i > ENV_CELL)


def prepare(run_dir: Path, input_dir: Path) -> None:
    (run_dir / "output").mkdir(exist_ok=True)


def execute(ctx: Ctx) -> bool:
    from nbclient import NotebookClient

    wf = all_workflows()["snrna"]
    nb = parameterised(ctx.params, ctx.input_dir, ctx.run_dir / "output")
    cell_stage = {shifted(i): s.id for s in wf.stages for i in s.cells}
    last = max(shifted(i) for s in wf.stages if s.id in ctx.stage_ids for i in s.cells)
    nb.cells = nb.cells[: last + 1]
    figs = ctx.run_dir / "_cells"
    figs.mkdir(exist_ok=True)
    seen: list[str] = []

    def on_start(cell, cell_index, **_):
        if ctx.cancelled:
            raise RuntimeError("cancelled")
        sid = cell_stage.get(cell_index)
        if sid and (not seen or seen[-1] != sid):
            if seen:
                ctx.stage(seen[-1], "done")
            seen.append(sid)
            ctx.stage(sid, "running")
            ctx.log(f"##HODOS start {sid}")

    def on_done(cell, cell_index, **_):
        sid = cell_stage.get(cell_index, "setup")
        for k, o in enumerate(cell.get("outputs", [])):
            if o.output_type == "stream":
                ctx.log(o.text.rstrip("\n"))
            elif o.output_type == "error":
                ctx.log(f"!! {o.ename}: {o.evalue}")
            elif o.output_type in ("display_data", "execute_result"):
                data = o.get("data", {})
                if "image/png" in data:
                    name = f"{sid}_cell{cell_index:02d}_{k}.png"
                    (figs / name).write_bytes(base64.b64decode(data["image/png"]))
                    ctx.log(f"[figure] _cells/{name}")
                elif "text/plain" in data:
                    ctx.log(data["text/plain"][:4000])

    client = NotebookClient(nb, timeout=None, kernel_name="python3",
                            resources={"metadata": {"path": str(ctx.run_dir)}},
                            on_cell_start=on_start, on_cell_executed=on_done)
    ctx.procs.append(client)
    ok = True
    try:
        client.execute()
    except Exception as exc:
        ok = False
        msg = str(exc).strip().splitlines()
        ctx.log(f"!! notebook stopped: {msg[-1] if msg else exc}")
    finally:
        nbformat.write(nb, ctx.run_dir / "executed.ipynb")
    if seen:
        ctx.stage(seen[-1], "done" if ok else "failed")
    return ok and not ctx.cancelled


def bundle(params: dict, stages: list[str]) -> dict[str, bytes]:
    nb = parameterised(params, Path("cellbender_inputs"), Path("results"))
    return {
        "AdoTHC_hippocampus_scanpy_AUTOMATED.ipynb": nbformat.writes(nb).encode(),
        "run.sh": ("#!/usr/bin/env bash\n# Put the eight *_lr5e5_filtered.h5 files in cellbender_inputs/.\n"
                   "set -euo pipefail\ncd \"$(dirname \"$0\")\"\n"
                   "jupyter nbconvert --to notebook --execute --ExecutePreprocessor.timeout=-1 "
                   "--output executed.ipynb AdoTHC_hippocampus_scanpy_AUTOMATED.ipynb\n").encode(),
    }
