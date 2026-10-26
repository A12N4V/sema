"""One module per way of running a workflow. Each exposes

    prepare(run_dir, input_dir)            lay out the run folder once
    execute(ctx)                           run ctx.stage_ids; True on success
    bundle(params, stages) -> {name: bytes}   the files that rerun it elsewhere

and reports progress only through ctx: ctx.log(line), ctx.stage(id, state),
ctx.cancelled. Nothing else in the app knows how an engine works.
"""
from . import notebook, python_scripts, rscript

ENGINES = {"python": python_scripts, "R": rscript, "notebook": notebook}
