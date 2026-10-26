from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

MARK = re.compile(r"##HODOS (start|done|fail) (\S+)")


@dataclass
class Ctx:
    run_dir: Path
    input_dir: Path
    params: dict
    stage_ids: list[str]
    log: Callable[[str], None]
    stage: Callable[[str, str], None]
    is_cancelled: Callable[[], bool]
    procs: list = field(default_factory=list)

    @property
    def cancelled(self) -> bool:
        return self.is_cancelled()


def copy_inputs(src: Path, proj: Path) -> None:
    """The Novogene pair and any signature tables, where the scripts look for them."""
    for sub, name in (("00_input", "gene_count.xls"), ("01_metadata", "metadata.csv")):
        (proj / sub).mkdir(parents=True, exist_ok=True)
        if (src / name).exists():
            shutil.copy2(src / name, proj / sub / name)
    (proj / "signatures").mkdir(parents=True, exist_ok=True)
    for f in (src / "signatures").glob("*.csv") if (src / "signatures").exists() else []:
        shutil.copy2(f, proj / "signatures" / f.name)


def stream(ctx: Ctx, cmd: list[str], cwd: Path, env: dict | None = None) -> bool:
    """Run a script that prints ##HODOS markers; follow its stages and log."""
    ctx.log("$ " + " ".join(Path(c).name if i == 0 else c for i, c in enumerate(cmd)))
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, bufsize=1)
    ctx.procs.append(p)
    for line in p.stdout:
        m = MARK.match(line)
        if m:
            ctx.stage(m.group(2), {"start": "running", "done": "done", "fail": "failed"}[m.group(1)])
        ctx.log(line.rstrip("\n"))
    return p.wait() == 0 and not ctx.cancelled
