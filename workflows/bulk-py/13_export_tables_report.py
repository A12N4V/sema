# ============================================================================
# 13_export_tables_report.py – sensitivity (with/without flagged samples),
# report, versions. Thin wrapper: the refit lives in plethos.sensitivity.
# No scatter plot – the live xy view draws from
# sensitivity_with_without_T4_LFC.csv (PNG map: sensitivity family).
# Outputs: 15_reports/*
# ============================================================================
from utils import *
from plethos import sensitivity as psens
from importlib.metadata import version, PackageNotFoundError

RP = "15_reports"
res = load_obj("res"); meta = load_obj("meta"); counts_filt = load_obj("counts_filt")

sens_note = "No sensitivity samples configured."
if CFG.SENSITIVITY_EXCLUDE:
    already = set(CFG.SENSITIVITY_EXCLUDE) & set(CFG.EXCLUDE)
    if already:
        # In the R original this case silently refits the same samples (EXCLUDE and
        # SENSITIVITY_EXCLUDE were both T4), so "with/without" compared nothing.
        say("WARNING: %s already excluded from the main analysis; the sensitivity refit removes nothing new.",
            ",".join(sorted(already)))
    r2 = psens.refit_without(counts_filt, meta, CFG.SENSITIVITY_EXCLUDE, CFG.GROUP_COL,
                             CFG.GROUP_REF, CFG.GROUP_TEST, CFG.N_CPUS)
    merged, lfc_cor, n_full, n_sens = psens.compare_refits(res, r2, CFG.FDR, CFG.LFC_MIN)
    save_table(merged, "sensitivity_with_without_T4_LFC", RP)
    sens_note = (f"Sensitivity (excluding {','.join(CFG.SENSITIVITY_EXCLUDE)}): LFC correlation full-vs-reduced = "
                 f"{lfc_cor:.3f}; FDR DEGs full={n_full}, reduced={n_sens}.")
say(sens_note)

pk = ["pydeseq2", "gseapy", "scipy", "numpy", "pandas"]
def v(p):
    try: return version(p)
    except PackageNotFoundError: return None
save_table(pd.DataFrame({"Package": pk, "Version": [v(p) for p in pk]}), "package_versions", RP)
write_note(f"python {sys.version}\n" + "\n".join(f"{p} {v(p)}" for p in pk) + "\n",
           "sessionInfo.txt", RP)

summ = pd.read_csv(P("05_differential_expression", "DE_summary.csv"))
write_note("\n".join([
    f"run_date: {time.ctime()}", f"engine: python port (pydeseq2 {v('pydeseq2')})",
    f"contrast: {CFG.GROUP_TEST} vs {CFG.GROUP_REF} (log2FC>0 = up in {CFG.GROUP_TEST})",
    f"n_samples_main: {counts_filt.shape[1]}", f"main_excluded: {','.join(CFG.EXCLUDE) or 'none'}",
    f"criteria_primary: padj < {CFG.FDR} & |log2FC_MLE| >= {CFG.LFC_MIN}",
    f"criteria_exploratory: pvalue < {CFG.P_NOMINAL} & |log2FC_MLE| >= {CFG.LFC_MIN}", "", "DE summary:",
    *[f"{m} = {x}" for m, x in zip(summ.metric, summ.value)], "", sens_note]) + "\n",
    "run_summary.txt", RP)
say("13 done. Sensitivity, package versions, run summary written. No plots.")
