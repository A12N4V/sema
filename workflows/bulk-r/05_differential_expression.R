## ============================================================================
## 05_differential_expression.R  —  DESeq2 DE (T vs V) + apeglm shrinkage
## Criteria: primary  padj<FDR & |log2FC_MLE|>=LFC_MIN
##           exploratory pvalue<P_NOMINAL & |log2FC_MLE|>=LFC_MIN
## Outputs : 05_differential_expression/* ; 16_R_objects/res.rds
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("DESeq2","apeglm"))
suppressPackageStartupMessages(library(DESeq2))

dds <- load_rds("dds"); annot <- load_rds("annot")
DE <- "05_differential_expression"
coefn <- paste0(CFG$GROUP_COL, "_", CFG$GROUP_TEST, "_vs_", CFG$GROUP_REF)

## MLE results (used for padj + |log2FC| thresholds and Wald stat for GSEA)
res_mle <- as.data.frame(results(dds, name = coefn))
## apeglm-shrunken LFC (used for ranking/visualization ONLY)
res_shr <- as.data.frame(lfcShrink(dds, coef = coefn, type = "apeglm"))

res <- data.frame(
  gene_id       = rownames(res_mle),
  symbol        = annot[rownames(res_mle), "symbol"],
  baseMean      = res_mle$baseMean,
  log2FC_MLE    = res_mle$log2FoldChange,   # threshold + sign
  lfcSE_MLE     = res_mle$lfcSE,
  stat_Wald     = res_mle$stat,             # GSEA ranking (primary)
  pvalue        = res_mle$pvalue,
  padj          = res_mle$padj,             # NA where independent filtering / all-zero / outlier
  log2FC_apeglm = res_shr$log2FoldChange,   # ranking/viz (labelled)
  lfcSE_apeglm  = res_shr$lfcSE,
  stringsAsFactors = FALSE)

## direction + significance flags (NA padj is NOT replaced)
sig_fdr  <- !is.na(res$padj)   & res$padj   < CFG$FDR       & abs(res$log2FC_MLE) >= CFG$LFC_MIN
sig_expl <- !is.na(res$pvalue) & res$pvalue < CFG$P_NOMINAL & abs(res$log2FC_MLE) >= CFG$LFC_MIN
res$sig_FDR         <- sig_fdr
res$sig_exploratory <- sig_expl
res$direction_FDR   <- ifelse(sig_fdr  & res$log2FC_MLE > 0, "up_in_T",
                       ifelse(sig_fdr  & res$log2FC_MLE < 0, "down_in_T", "ns"))
res$direction_expl  <- ifelse(sig_expl & res$log2FC_MLE > 0, "up_in_T",
                       ifelse(sig_expl & res$log2FC_MLE < 0, "down_in_T", "ns"))
res <- res[order(res$padj, res$pvalue), ]
save_rds(res, "res")

## ---- tables ---------------------------------------------------------------
save_table(res, "DE_all_genes_complete", file.path(DE, "complete_tables"))
save_table(res[sig_fdr, ],                         "DE_significant_FDR",           file.path(DE, "significant_FDR"))
save_table(res[sig_fdr & res$log2FC_MLE > 0, ],    "DE_significant_FDR_up_in_T",   file.path(DE, "significant_FDR"))
save_table(res[sig_fdr & res$log2FC_MLE < 0, ],    "DE_significant_FDR_down_in_T", file.path(DE, "significant_FDR"))
save_table(res[sig_expl, ],                        "DE_exploratory_pvalue",           file.path(DE, "exploratory_pvalue"))
save_table(res[sig_expl & res$log2FC_MLE > 0, ],   "DE_exploratory_pvalue_up_in_T",   file.path(DE, "exploratory_pvalue"))
save_table(res[sig_expl & res$log2FC_MLE < 0, ],   "DE_exploratory_pvalue_down_in_T", file.path(DE, "exploratory_pvalue"))

## ---- summary --------------------------------------------------------------
summ <- data.frame(
  metric = c("genes_tested","genes_with_padj",
             "FDR_significant","FDR_up_in_T","FDR_down_in_T",
             "exploratory_significant","exploratory_up_in_T","exploratory_down_in_T",
             "FDR_threshold","LFC_threshold","nominal_p_threshold"),
  value  = c(nrow(res), sum(!is.na(res$padj)),
             sum(sig_fdr), sum(res$direction_FDR=="up_in_T"), sum(res$direction_FDR=="down_in_T"),
             sum(sig_expl), sum(res$direction_expl=="up_in_T"), sum(res$direction_expl=="down_in_T"),
             CFG$FDR, CFG$LFC_MIN, CFG$P_NOMINAL))
save_table(summ, "DE_summary", DE)
writeLines(c(
  "Why padj = NA can occur in DESeq2 (values NOT imputed):",
  " 1. All-zero counts across samples -> gene removed from testing (baseMean = 0).",
  " 2. Independent filtering: low-count genes with little power are set to NA to gain FDR power.",
  " 3. Cook's-distance outlier: a gene with an extreme count in one sample has its p-value set NA.",
  "These NAs are legitimate 'not tested / filtered', not missing data, and must not be replaced by 0 or 1."),
  P(DE, "README_padj_NA.txt"))

say("05 done. FDR DEGs=%d (up=%d, down=%d) | exploratory=%d. NA padj kept as-is.",
    sum(sig_fdr), sum(res$direction_FDR=="up_in_T"), sum(res$direction_FDR=="down_in_T"), sum(sig_expl))
