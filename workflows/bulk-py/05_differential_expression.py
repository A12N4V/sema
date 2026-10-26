# ============================================================================
# 05_differential_expression.py – PyDESeq2 DE (T vs V) + apeGLM-type shrinkage
# Thin wrapper: the fit and thresholds live in plethos.de. No plots – the
# volcano, MA and histogram views draw from DE_all_genes_complete.csv
# (PNG map: 05/06 families).
# Criteria: primary  padj<FDR & |log2FC_MLE|>=LFC_MIN
#           exploratory pvalue<P_NOMINAL & |log2FC_MLE|>=LFC_MIN
# Outputs : 05_differential_expression/* ; 16_objects/res.pkl
# ============================================================================
from utils import *
from plethos import de as pde

dds = load_obj("dds"); annot = load_obj("annot")
DE = "05_differential_expression"

mle = pde.results(dds, CFG.GROUP_COL, CFG.GROUP_TEST, CFG.GROUP_REF, CFG.FDR, shrink=True, n_cpus=CFG.N_CPUS)
res = pde.threshold(mle, CFG.FDR, CFG.LFC_MIN, CFG.P_NOMINAL, merge_symbols=True, annot=annot)
save_obj(res, "res")

CT, SF, EX = f"{DE}/complete_tables", f"{DE}/significant_FDR", f"{DE}/exploratory_pvalue"
save_table(res, "DE_all_genes_complete", CT)
for name, tab in pde.subset_tables(res, CFG.FDR, CFG.LFC_MIN, CFG.P_NOMINAL).items():
    out = SF if name.startswith("DE_significant") else EX
    save_table(tab, name, out)
save_table(pde.summary_counts(res, CFG.FDR, CFG.LFC_MIN, CFG.P_NOMINAL), "DE_summary", DE)

write_note(
    "Why padj = NA can occur in DESeq2 (values NOT imputed):\n"
    " 1. All-zero counts across samples -> gene removed from testing (baseMean = 0).\n"
    " 2. Independent filtering: low-count genes with little power are set to NA to gain FDR power.\n"
    " 3. Cook's-distance outlier: a gene with an extreme count in one sample has its p-value set NA.\n"
    "These NAs are legitimate 'not tested / filtered', not missing data, and must not be replaced by 0 or 1.\n",
    "README_padj_NA.txt", DE)
say("05 done. FDR DEGs=%d (up=%d, down=%d) | exploratory=%d. NA padj kept as-is.",
    res.sig_FDR.sum(), (res.direction_FDR == "up_in_T").sum(), (res.direction_FDR == "down_in_T").sum(),
    res.sig_exploratory.sum())
