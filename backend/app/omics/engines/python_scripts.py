"""The Python port of the bulk scripts (workflows/bulk-py), run as the authors run run_all.R."""
from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path

from ..workflows import BULK_PY, REPO, _split_comment
from .common import Ctx, copy_inputs, stream

GENESETS = Path(os.environ.get("HODOS_GENESETS", REPO / "omics-data" / "inputs" / "genesets"))


def render_config(overrides: dict) -> str:
    """config.py with overridden values swapped in place, comments kept."""
    out = []
    for line in (BULK_PY / "config.py").read_text().splitlines():
        m = re.match(r"^([A-Z_][A-Z0-9_]*)(\s*=\s*)(.+)$", line)
        if m and m.group(1) in overrides:
            _, comment = _split_comment(m.group(3))
            line = f"{m.group(1)}{m.group(2)}{overrides[m.group(1)]!r}"
            line += f"  # {comment}  [hodos: edited]" if comment else "  # [hodos: edited]"
        out.append(line)
    return "\n".join(out) + "\n"


def prepare(run_dir: Path, input_dir: Path) -> None:
    proj = run_dir / "project"
    shutil.copytree(BULK_PY, proj / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
    copy_inputs(input_dir, proj)


def execute(ctx: Ctx) -> bool:
    proj = ctx.run_dir / "project"
    (proj / "scripts" / "config.py").write_text(render_config(ctx.params))
    a, b = ctx.stage_ids[0][:2], ctx.stage_ids[-1][:2]
    GENESETS.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PROJ_ROOT": str(proj), "HODOS_GENESETS": str(GENESETS),
           "PYTHONUNBUFFERED": "1", "MPLBACKEND": "Agg"}
    return stream(ctx, [sys.executable, "scripts/run_all.py", a, b], proj, env)


def bundle(params: dict, stages: list[str]) -> dict[str, bytes]:
    files = {f"scripts/{f.name}": f.read_bytes() for f in BULK_PY.glob("*.py") if f.name != "config.py"}
    # The plethos package travels with the scripts so the bundle reproduces the
    # run outside Hodos (import plethos resolves via utils.py's sys.path).
    for f in sorted((BULK_PY / "plethos").glob("*.py")):
        files[f"scripts/plethos/{f.name}"] = f.read_bytes()
    files["scripts/config.py"] = render_config(params).encode()
    files["run.sh"] = (
        "#!/usr/bin/env bash\n# Put gene_count.xls in 00_input/, metadata.csv in 01_metadata/, signature CSVs in signatures/.\n"
        "# Needs: pip install pydeseq2 gseapy scipy openpyxl lxml\n"
        "set -euo pipefail\ncd \"$(dirname \"$0\")\"\nmkdir -p 00_input 01_metadata signatures\n"
        "# stock macOS ships python3 only; $PYTHON overrides (e.g. a venv)\n"
        "PY=${PYTHON:-$(command -v python3 || command -v python)}\n"
        f"PROJ_ROOT=\"$PWD\" \"$PY\" scripts/run_all.py {stages[0][:2]} {stages[-1][:2]}\n").encode()
    return files
