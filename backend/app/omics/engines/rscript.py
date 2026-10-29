"""The original R scripts, through Rscript."""
from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path

from ..workflows import BULK_DIR, R_PARAM_NAMES, _split_comment, parse_config_r, to_r
from .common import Ctx, copy_inputs, stream


def find_rscript() -> str | None:
    for c in [os.environ.get("HODOS_RSCRIPT"), shutil.which("Rscript"),
              "/opt/homebrew/bin/Rscript", "/usr/local/bin/Rscript",
              "/Library/Frameworks/R.framework/Resources/bin/Rscript"]:
        if c and Path(c).exists():
            return c
    return None


def render_config(overrides: dict) -> str:
    """config.R with overridden values swapped in place. Settings that exist only
    in the Python port (FIG_THEME, N_CPUS, ...) have no R line and are skipped."""
    kinds = {p.name: p.type for p in parse_config_r((BULK_DIR / "config.R").read_text())}
    out = []
    for line in (BULK_DIR / "config.R").read_text().replace("\r\n", "\n").splitlines():
        m = re.match(r"^(CFG\$(\w+)\s*<-\s*)(.+)$", line)
        if m and m.group(2) in overrides and m.group(2) in kinds:
            _, comment = _split_comment(m.group(3))
            line = m.group(1) + to_r(kinds[m.group(2)], overrides[m.group(2)])
            line += f"   # {comment}  [hodos: edited]" if comment else "   # [hodos: edited]"
        out.append(line)
    return "\n".join(out) + "\n"


def prepare(run_dir: Path, input_dir: Path) -> None:
    proj = run_dir / "project"
    shutil.copytree(BULK_DIR, proj / "scripts")
    copy_inputs(input_dir, proj)


def execute(ctx: Ctx) -> bool:
    rscript = find_rscript()
    if not rscript:
        ctx.log("!! Rscript not found. Install R (brew install r) and run "
                "workflows/bulk-r/00_install_packages.R once, or switch the engine to Python.")
        return False
    ignored = sorted(set(ctx.params) - R_PARAM_NAMES)
    if ignored:
        ctx.log(f"note: {', '.join(ignored)} exist only in the Python port; the R scripts ignore them.")
    proj = ctx.run_dir / "project"
    (proj / "scripts" / "config.R").write_text(render_config(ctx.params))
    steps = ", ".join(f'"{s}"' for s in ctx.stage_ids)
    # run_all.R, with its `scripts/` paths resolved against the run folder.
    (proj / "_hodos_run.R").write_text(f"""PROJ_ROOT <- normalizePath({json.dumps(str(proj))})
setwd(PROJ_ROOT)
source("scripts/config.R")
source("scripts/utils.R")
for (s in c({steps})) {{
  cat("##HODOS start", s, "\\n")
  ok <- tryCatch({{ source(file.path("scripts", paste0(s, ".R")), local = new.env()); TRUE }},
                 error = function(e) {{ message("!! ERROR in ", s, ": ", conditionMessage(e)); FALSE }})
  cat("##HODOS", if (ok) "done" else "fail", s, "\\n")
  if (!ok) quit(status = 1)
}}
""")
    return stream(ctx, [rscript, "--vanilla", "_hodos_run.R"], proj)


def bundle(params: dict, stages: list[str]) -> dict[str, bytes]:
    files = {f"scripts/{f.name}": f.read_bytes() for f in BULK_DIR.glob("*.R") if f.name != "config.R"}
    files["scripts/config.R"] = render_config(params).encode()
    a, b = int(stages[0][:2]), int(stages[-1][:2])
    files["run.sh"] = (
        "#!/usr/bin/env bash\n# Put gene_count.xls in 00_input/, metadata.csv in 01_metadata/, signature CSVs in signatures/.\n"
        "set -euo pipefail\ncd \"$(dirname \"$0\")\"\nmkdir -p 00_input 01_metadata signatures\n"
        "Rscript -e 'PROJ_ROOT <- getwd(); source(\"scripts/config.R\"); source(\"scripts/utils.R\"); "
        "for (s in sub(\"\\\\.R$\", \"\", sort(list.files(\"scripts\", \"^(0[1-9]|1[0-3])_.*\\\\.R$\")))) "
        f"{{ n <- as.integer(substr(s, 1, 2)); if (n >= {a} && n <= {b}) "
        "{ message(\"== \", s); source(file.path(\"scripts\", paste0(s, \".R\")), local = new.env()) } }'\n"
    ).encode()
    return files
