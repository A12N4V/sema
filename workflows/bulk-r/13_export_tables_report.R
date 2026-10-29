## ============================================================================
## 13_export_tables_report.R  —  sensitivity (with/without T4), report, sessionInfo
## Outputs: 15_reports/*, 14_supplementary_figures/*
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("DESeq2"))
suppressPackageStartupMessages(library(DESeq2))
RP <- "15_reports"; SUP <- "14_supplementary_figures"

res <- load_rds("res"); meta <- load_rds("meta"); counts_filt <- load_rds("counts_filt")
coefn <- paste0(CFG$GROUP_COL, "_", CFG$GROUP_TEST, "_vs_", CFG$GROUP_REF)

## ---- sensitivity: refit WITHOUT the flagged sample(s) --------------------
sens_note <- "No sensitivity samples configured."
if (length(CFG$SENSITIVITY_EXCLUDE)) {
  keep <- setdiff(colnames(counts_filt), CFG$SENSITIVITY_EXCLUDE)
  m2 <- meta[keep, , drop=FALSE]; c2 <- counts_filt[, keep, drop=FALSE]
  covars <- CFG$COVARS[CFG$COVARS %in% colnames(m2)]
  covars <- covars[vapply(covars, function(c) !any(is.na(m2[[c]])) && length(unique(m2[[c]]))>1, logical(1))]
  d2 <- DESeqDataSetFromMatrix(c2, m2, design = stats::as.formula(paste("~", paste(c(covars, CFG$GROUP_COL), collapse=" + "))))
  d2 <- suppressMessages(DESeq(d2))
  r2 <- as.data.frame(results(d2, name = coefn))
  merged <- merge(data.frame(gene_id=rownames(res), lfc_full=res$log2FC_MLE, padj_full=res$padj),
                  data.frame(gene_id=rownames(r2), lfc_sens=r2$log2FoldChange, padj_sens=r2$padj),
                  by="gene_id")
  lfc_cor <- cor(merged$lfc_full, merged$lfc_sens, use="complete.obs")
  n_full <- sum(res$sig_FDR)
  n_sens <- sum(!is.na(r2$padj) & r2$padj < CFG$FDR & abs(r2$log2FoldChange) >= CFG$LFC_MIN)
  save_table(merged, "sensitivity_with_without_T4_LFC", RP)
  sens_note <- sprintf("Sensitivity (excluding %s): LFC correlation full-vs-reduced = %.3f; FDR DEGs full=%d, reduced=%d.",
                       paste(CFG$SENSITIVITY_EXCLUDE, collapse=","), lfc_cor, n_full, n_sens)
  ## scatter of LFCs
  need_pkg("ggplot2"); library(ggplot2)
  gs <- ggplot(merged, aes(lfc_full, lfc_sens)) + geom_point(size=.4, alpha=.4) +
    geom_abline(slope=1, intercept=0, colour="#D73027", linewidth=.3) +
    labs(x="log2FC (all samples)", y=sprintf("log2FC (excl. %s)", paste(CFG$SENSITIVITY_EXCLUDE, collapse=",")),
         title=sprintf("Sensitivity: r=%.3f", lfc_cor)) + theme_pub()
  save_plot(gs, "sensitivity_LFC_scatter", SUP, 80, 78)
}
say(sens_note)

## ---- package versions -----------------------------------------------------
pk <- as.data.frame(installed.packages()[, c("Package","Version")]); rownames(pk) <- NULL
key <- pk[pk$Package %in% c("DESeq2","apeglm","fgsea","msigdbr","clusterProfiler","enrichplot",
                            "org.Mm.eg.db","ComplexHeatmap","ggplot2","GSVA","singscore"), ]
save_table(key, "package_versions", RP)
writeLines(capture.output(sessionInfo()), P(RP, "sessionInfo.txt"))

## ---- machine-readable run summary ----------------------------------------
summ <- utils::read.csv(P("05_differential_expression","DE_summary.csv"))
writeLines(c(
  paste("run_date:", Sys.time()),
  paste("contrast:", CFG$GROUP_TEST, "vs", CFG$GROUP_REF, "(log2FC>0 = up in", CFG$GROUP_TEST, ")"),
  paste("n_samples_main:", ncol(counts_filt)),
  paste("main_excluded:", if (length(CFG$EXCLUDE)) paste(CFG$EXCLUDE, collapse=",") else "none"),
  paste("criteria_primary: padj <", CFG$FDR, "& |log2FC_MLE| >=", CFG$LFC_MIN),
  paste("criteria_exploratory: pvalue <", CFG$P_NOMINAL, "& |log2FC_MLE| >=", CFG$LFC_MIN),
  "", "DE summary:",
  paste(summ$metric, summ$value, sep=" = "),
  "", sens_note),
  P(RP, "run_summary.txt"))
say("13 done. Sensitivity, package versions, sessionInfo, run summary written.")
say("Pipeline complete. See 15_reports/ for the biological summary and limitations (BIOLOGICAL_REPORT.md).")
