# ============================================================================
# 12_publication_figures.py – CUT as a pipeline stage.
# The publication composites are a frontend concern now: the multi-panel view
# composes the live figures and exports them (R1's PNG map cut step 12 and the
# GO emap/cnet/heatplots as bloat). This script writes the sources note only,
# so the stage list and the 13-step count stay stable.
# ============================================================================
from utils import *

write_note(
    "Publication figures are composed in the workbench (multi-panel view) from the "
    "live figures backed by these tables:\n"
    " - Figure 1: PCA_coordinates.csv + DG_identity_score_per_sample.csv\n"
    " - Figure 2: DE_all_genes_complete.csv (volcano)\n"
    " - Figure 3: 09_GO_ORA/*_complete.csv + 10_GSEA/GSEA_all_collections_wald_and_sensitivity.csv\n"
    " - Figure 4: axis_scores_per_sample.csv\n"
    "Figure 5 is a CONCEPTUAL MODEL (hypothesis) – draw manually from "
    "convergent_candidates_DE_and_literature.csv + top pathways; label explicitly as "
    "'model/hypothesis', not a result.\n",
    "Figure_sources.txt", "13_publication_figures")
say("12 done. Publication composites are live views; sources documented. No plots.")
