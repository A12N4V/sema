## ============================================================================
## config.R  —  central configuration (edit here, then run run_all.R)
## DG bulk RNA-seq · contrast T vs V (all 10 samples; T4 kept in main analysis)
## ============================================================================
## Everything downstream reads from this file. Change paths/params ONLY here.

if (!exists("PROJ_ROOT")) {
  a  <- commandArgs(trailingOnly = FALSE)
  fa <- sub("^--file=", "", a[grep("^--file=", a)])
  here <- if (length(fa)) normalizePath(dirname(fa)) else getwd()
  ## if run interactively from project root, fall back gracefully
  PROJ_ROOT <- if (basename(here) == "scripts") normalizePath(file.path(here, ".."))
               else normalizePath(here)
}

CFG <- new.env()

## ---- INPUT FILES ----------------------------------------------------------
CFG$COUNTS_FILE <- file.path(PROJ_ROOT, "00_input", "gene_count.xls")  # Novogene matrix
CFG$META_FILE   <- file.path(PROJ_ROOT, "01_metadata", "metadata.csv") # sample,group[,covars]
## Novogene "gene_count.xls" is TAB-separated despite the .xls extension.
CFG$SEP         <- "\t"                 # "\t" for Novogene .xls; "," for a plain CSV
CFG$GENE_ID_COL <- "gene_id"            # 1st/ID column (Ensembl gene IDs)
CFG$SYMBOL_COL  <- "gene_name"          # symbol column IN the Novogene file (if present)
CFG$BIOTYPE_COL <- "gene_biotype"       # optional; used for QC summaries
## Non-count annotation columns to strip before building the count matrix:
CFG$ANNOT_COLS  <- c("gene_name","gene_chr","gene_start","gene_end","gene_strand",
                     "gene_length","gene_biotype","gene_description","tf_family")

## ---- DESIGN ---------------------------------------------------------------
CFG$SPECIES     <- "mouse"
CFG$GROUP_COL   <- "group"
CFG$GROUP_REF   <- "V"                  # reference (denominator): control
CFG$GROUP_TEST  <- "T"                  # test (numerator): experimental. log2FC>0 = up in T
CFG$COVARS      <- character(0)         # e.g. c("sex","batch"); must exist in metadata & be complete
CFG$EXCLUDE     <- c("T4")             # main analysis excludes T4
CFG$SENSITIVITY_EXCLUDE <- c("T4")      # sample(s) examined ONLY in the with/without sensitivity run

## ---- FILTERING ------------------------------------------------------------
CFG$FILTER_MIN  <- 10                   # min counts ...
CFG$FILTER_FRAC <- 0.5                  # ... in >= this fraction of samples
CFG$PROTEIN_CODING_ONLY <- FALSE        # set TRUE to restrict to protein_coding for enrichment

## ---- STATISTICAL CRITERIA -------------------------------------------------
CFG$FDR         <- 0.05                 # padj threshold (primary DEG)
CFG$LFC_MIN     <- 0.30                 # |log2FC| threshold (primary + exploratory)
CFG$P_NOMINAL   <- 0.05                 # nominal p threshold (exploratory only)
## DEG (primary)      : padj   < FDR       & |log2FC_MLE| >= LFC_MIN
## DEG (exploratory)  : pvalue < P_NOMINAL & |log2FC_MLE| >= LFC_MIN
## Thresholds use MLE log2FC (results()); apeglm shrinkage is used for viz/ranking (labelled).

## ---- ENRICHMENT -----------------------------------------------------------
CFG$GO_QVAL      <- 0.05
CFG$GSEA_MINSIZE <- 10
CFG$GSEA_MAXSIZE <- 500
CFG$GSEA_FDR     <- 0.05
CFG$TOP_N_TERMS  <- 15

## ---- REPRODUCIBILITY ------------------------------------------------------
CFG$SEED        <- 1234
set.seed(CFG$SEED)

## ---- AESTHETICS -----------------------------------------------------------
## Two colour-blind-safe palettes (V dark, T coloured). Switch with CFG$PALETTE.
CFG$PALETTES <- list(
  orange = c(V = "#4D4D4D", T = "#E69F00"),   # V grey, T orange (Okabe-Ito)
  green  = c(V = "#000000", T = "#009E73")    # V black, T green  (Okabe-Ito)
)
CFG$PALETTE <- "green"                   # active palette ("green" or "orange")
CFG$PAL     <- CFG$PALETTES[[CFG$PALETTE]]
CFG$DIVERGE <- c(low = "#2166AC", mid = "white", high = "#B2182B")  # z-score / LFC heatmaps
CFG$BASE_PT <- 8                         # base font size (pt) for figures

## ---- OUTPUT FOLDERS (created automatically) -------------------------------
CFG$DIRS <- c(
  "00_input","01_metadata","02_quality_control","03_normalized_expression",
  "04_PCA_clustering","05_differential_expression","05_differential_expression/complete_tables",
  "05_differential_expression/significant_FDR","05_differential_expression/exploratory_pvalue",
  "06_volcano_plots","07_heatmaps","08_DG_identity_enrichment",
  "09_GO_ORA","09_GO_ORA/BP","09_GO_ORA/CC","09_GO_ORA/MF",
  "10_GSEA","11_pathway_visualization","12_candidate_genes","13_publication_figures",
  "14_supplementary_figures","15_reports","16_R_objects","signatures")
invisible(lapply(CFG$DIRS, function(d) dir.create(file.path(PROJ_ROOT, d),
                                                  showWarnings = FALSE, recursive = TRUE)))

## convenience: absolute path inside project
P <- function(...) file.path(PROJ_ROOT, ...)
message("config.R loaded. PROJ_ROOT = ", PROJ_ROOT,
        " | contrast = ", CFG$GROUP_TEST, " vs ", CFG$GROUP_REF,
        " | palette = ", CFG$PALETTE)
