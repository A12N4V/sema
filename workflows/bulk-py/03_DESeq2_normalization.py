# ============================================================================
# 03_DESeq2_normalization.py – PyDESeq2 fit + VST/normalized expression
# Thin wrapper: the fit lives in plethos.normalize. The dispersion table backs
# the live dispersion figure (replaces dispersion_estimates.png).
# Outputs: 03_normalized_expression/* ; 16_objects/{dds,norm,vst}.pkl
# ============================================================================
from utils import *
from plethos import normalize as pn

counts_filt = load_obj("counts_filt"); meta = load_obj("meta")
NE = "03_normalized_expression"

design, covars = pn.make_design(meta, CFG.GROUP_COL, CFG.COVARS)
say("DESeq2 design: %s", design)

dds = pn.fit(counts_filt, meta, design, CFG.GROUP_COL, CFG.GROUP_REF, CFG.N_CPUS)
norm = pn.normalized_counts(dds)
vstm = pn.vst(dds)

save_table(norm.rename_axis("gene_id").reset_index(), "normalized_counts", NE)
save_table(vstm.rename_axis("gene_id").reset_index(), "VST_expression", NE)
save_table(pn.size_factors(dds).assign(group=meta[CFG.GROUP_COL].astype(str).values), "size_factors", NE)
save_table(pn.dispersion_table(dds), "dispersion_estimates", NE)
save_table(meta[CFG.GROUP_COL].astype(str).rename("group").rename_axis("sample").reset_index(),
           "sample_groups", NE)

save_obj(dds, "dds"); save_obj(norm, "norm"); save_obj(vstm, "vst")
say("03 done. DESeq2 fit + VST + dispersion table saved. Design: %s", design)
