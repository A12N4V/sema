## ============================================================================
## run_all.R  —  execute the DG bulk RNA-seq pipeline end-to-end.
## USAGE (from the project root DG_bulk_RNAseq/):
##   Rscript run_all.R           # full pipeline
##   Rscript run_all.R 05 09     # run only scripts 05..09
## Or in RStudio: setwd() to DG_bulk_RNAseq/, then source("run_all.R").
## ============================================================================

## -- locate project root & set working directory to it ---------------------
args0 <- commandArgs(trailingOnly = FALSE)
fa <- sub("^--file=", "", args0[grep("^--file=", args0)])
root <- if (length(fa)) normalizePath(dirname(fa)) else getwd()
setwd(root)
PROJ_ROOT <- root

source("scripts/config.R")   # defines CFG, folders, PROJ_ROOT
source("scripts/utils.R")    # helpers (say, save_plot, ...)

## -- which steps to run -----------------------------------------------------
steps <- c(
  "01_load_data_metadata","02_QC_filtering","03_DESeq2_normalization",
  "04_PCA_clustering","05_differential_expression","06_volcano_MA_heatmaps",
  "07_DG_identity_scores","08_GO_ORA","09_GSEA","10_targeted_signatures",
  "11_integrated_analysis","12_publication_figures","13_export_tables_report")
cargs <- commandArgs(trailingOnly = TRUE)
if (length(cargs) == 2) {
  sel <- as.integer(cargs); idx <- which(as.integer(substr(steps,1,2)) >= sel[1] &
                                         as.integer(substr(steps,1,2)) <= sel[2])
  steps <- steps[idx]
}

## -- pre-flight checks ------------------------------------------------------
say("PROJECT: %s", PROJ_ROOT)
say("Contrast: %s vs %s  |  primary DEG: padj<%.2f & |log2FC|>=%.2f",
    CFG$GROUP_TEST, CFG$GROUP_REF, CFG$FDR, CFG$LFC_MIN)
if (!file.exists(CFG$COUNTS_FILE)) stop("Place the Novogene counts at: ", CFG$COUNTS_FILE, call. = FALSE)
if (!file.exists(CFG$META_FILE))   stop("Provide metadata at: ", CFG$META_FILE, call. = FALSE)

## -- run --------------------------------------------------------------------
t0 <- Sys.time()
for (s in steps) {
  say("======== RUNNING %s ========", s)
  ok <- tryCatch({ source(file.path("scripts", paste0(s, ".R")), local = new.env()); TRUE },
                 error = function(e) { message("!! ERROR in ", s, ": ", conditionMessage(e)); FALSE })
  if (!ok) stop("Pipeline halted at ", s, " (see message above).", call. = FALSE)
}
say("ALL DONE in %.1f min. Outputs under %s", as.numeric(difftime(Sys.time(), t0, units="mins")), PROJ_ROOT)
