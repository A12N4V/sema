# ============================================================================
# 02_QC_filtering.py – raw-count QC + expression filter.
# Thin wrapper: the logic lives in plethos.qc. No plots – the per-sample
# quantile columns back the live QC boxplot (PNG map: QC_raw_count_boxplot).
# Outputs: 02_quality_control/QC_per_sample_summary.csv, QC_filter_summary.txt
#          16_objects/{counts_filt,qc_tab}.pkl
# ============================================================================
from utils import *
from plethos import qc as pqc

counts = load_obj("counts"); meta = load_obj("meta"); annot = load_obj("annot")
QC = "02_quality_control"

qc = pqc.qc_per_sample(counts, meta[CFG.GROUP_COL])
save_table(qc, "QC_per_sample_summary", QC)

counts_filt = pqc.filter_genes(counts, CFG.FILTER_MIN, CFG.FILTER_FRAC, CFG.PROTEIN_CODING_ONLY, annot["biotype"])
say("Filter: >=%d counts in >=%.0f%% samples -> %d / %d genes kept (%.1f%%).",
    CFG.FILTER_MIN, 100 * CFG.FILTER_FRAC, len(counts_filt), len(counts), 100 * len(counts_filt) / len(counts))

write_note(f"genes_input: {counts.shape[0]}\ngenes_kept: {counts_filt.shape[0]}\n"
           f"filter: >={CFG.FILTER_MIN} in >={100 * CFG.FILTER_FRAC:.0f}% samples\n",
           "QC_filter_summary.txt", QC)
save_obj(counts_filt, "counts_filt"); save_obj(qc, "qc_tab")
say("02 done. QC summary (with log10-count quantiles) + filtered matrix saved. No plots – the workbench draws them live.")
