# ============================================================================
# run_all.py – execute the DG bulk RNA-seq pipeline end-to-end (Python port of run_all.R).
# USAGE (from the project root, with the scripts in scripts/):
#   python scripts/run_all.py          # full pipeline
#   python scripts/run_all.py 05 09    # run only scripts 05..09
# ============================================================================
import runpy
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from utils import CFG, say  # noqa: E402

steps = sorted(p.stem for p in HERE.glob("[01][0-9]_*.py"))
if len(sys.argv) == 3:
    a, b = int(sys.argv[1]), int(sys.argv[2])
    steps = [s for s in steps if a <= int(s[:2]) <= b]

say("PROJECT: %s", CFG.PROJ_ROOT)
say("Contrast: %s vs %s  |  primary DEG: padj<%.2f & |log2FC|>=%.2f", CFG.GROUP_TEST, CFG.GROUP_REF, CFG.FDR, CFG.LFC_MIN)
for f in (CFG.COUNTS_FILE, CFG.META_FILE):
    if not Path(f).exists():
        sys.exit(f"Missing input: {f}")

t0 = time.time()
for s in steps:
    print(f"##HODOS start {s}", flush=True)
    try:
        runpy.run_path(str(HERE / f"{s}.py"), run_name="__main__")
    except SystemExit as e:
        if e.code not in (None, 0):
            print(f"!! ERROR in {s}: {e.code}", flush=True); print(f"##HODOS fail {s}", flush=True); sys.exit(1)
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f"!! ERROR in {s}: {e}", flush=True); print(f"##HODOS fail {s}", flush=True); sys.exit(1)
    print(f"##HODOS done {s}", flush=True)
say("ALL DONE in %.1f min. Outputs under %s", (time.time() - t0) / 60, CFG.PROJ_ROOT)
