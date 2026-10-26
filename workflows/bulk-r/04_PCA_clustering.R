## ============================================================================
## 04_PCA_clustering.R  —  PCA, correlation, distances, clustering, outlier QC
## Outputs: 04_PCA_clustering/* ; 16_R_objects/{pca,cook_tab}.rds
## No samples are removed automatically (see report for with/without sensitivity).
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("DESeq2","ggplot2","ggrepel","matrixStats","pheatmap"))
suppressPackageStartupMessages({library(DESeq2); library(ggplot2)})

vsd <- load_rds("vsd"); dds <- load_rds("dds"); meta <- load_rds("meta")
V <- assay(vsd); grp <- meta[[CFG$GROUP_COL]]; pal <- CFG$PAL
PC <- "04_PCA_clustering"; ord <- colnames(V)

## ---- PCA on top-variable genes -------------------------------------------
pca_df <- function(ngenes = 500) {
  rv  <- matrixStats::rowVars(V); sel <- order(rv, decreasing = TRUE)[seq_len(min(ngenes, length(rv)))]
  p   <- prcomp(t(V[sel, ]))
  ve  <- 100 * p$sdev^2 / sum(p$sdev^2)
  list(d = data.frame(sample = rownames(p$x), group = grp, p$x[, 1:min(3,ncol(p$x))]),
       ve = ve, ngenes = length(sel))
}
pc <- pca_df(500); save_rds(pc, "pca")

pca_plot <- function(pc, x="PC1", y="PC2", labels=TRUE, ellipse=FALSE) {
  d <- pc$d; ve <- pc$ve; xi <- as.integer(sub("PC","",x)); yi <- as.integer(sub("PC","",y))
  g <- ggplot(d, aes(.data[[x]], .data[[y]], colour = group, fill = group)) +
    { if (ellipse && min(table(grp))>=3)
        stat_ellipse(type="norm", geom="polygon", alpha=.10, level=.9, linewidth=.2, show.legend=FALSE) } +
    geom_point(size = 2.4) +
    scale_colour_manual(values = pal) + scale_fill_manual(values = pal) +
    labs(x = sprintf("%s (%.1f%%)", x, ve[xi]), y = sprintf("%s (%.1f%%)", y, ve[yi])) +
    theme_pub() + theme(legend.position = c(.99,.99), legend.justification = c(1,1))
  if (labels) g <- g + ggrepel::geom_text_repel(aes(label = sample), size = 2.4,
                        colour = "grey30", show.legend = FALSE, min.segment.length = 0)
  g
}
save_plot(pca_plot(pc, "PC1","PC2", labels=TRUE ), "PCA_PC1_PC2_labeled",   PC, 85, 78)
save_plot(pca_plot(pc, "PC1","PC2", labels=FALSE), "PCA_PC1_PC2_unlabeled", PC, 85, 78)
## ellipses ONLY as an optional view (n>=3 per group); flagged in the legend as descriptive
save_plot(pca_plot(pc, "PC1","PC2", labels=TRUE, ellipse=TRUE), "PCA_PC1_PC2_ellipse", PC, 85, 78)
if (ncol(pc$d) >= 5) save_plot(pca_plot(pc, "PC1","PC3", labels=TRUE), "PCA_PC1_PC3_labeled", PC, 85, 78)

## ---- sample-sample correlation + heatmap ---------------------------------
Cmat <- cor(V, method = "pearson")
save_table(data.frame(sample = rownames(Cmat), Cmat, check.names = FALSE), "sample_correlation_matrix", PC)
save_grid(function() pheatmap::pheatmap(Cmat, main = "Sample Pearson correlation (VST)",
              display_numbers = TRUE, number_format = "%.3f",
              annotation_col = data.frame(group = grp, row.names = colnames(V)),
              annotation_colors = list(group = pal), silent = FALSE),
          "correlation_heatmap", PC, 130, 120)

## ---- euclidean distance + hierarchical clustering ------------------------
D <- dist(t(V)); Dm <- as.matrix(D)
save_table(data.frame(sample = rownames(Dm), Dm, check.names = FALSE), "sample_distance_matrix", PC)
save_grid(function() pheatmap::pheatmap(Dm, clustering_distance_rows = D,
              clustering_distance_cols = D, main = "Sample Euclidean distance (VST)",
              annotation_col = data.frame(group = grp, row.names = colnames(V)),
              annotation_colors = list(group = pal)),
          "distance_heatmap", PC, 120, 110)
save_grid(function() plot(hclust(D, method = "average"),
              main = "Hierarchical clustering (VST, average linkage)", xlab = "", sub = ""),
          "hierarchical_clustering", PC, 120, 90)

## ---- outlier diagnostics (identify only; DO NOT remove) ------------------
Cn <- Cmat; diag(Cn) <- NA; med_cor <- apply(Cn, 1, median, na.rm = TRUE)
mad_z <- 0.6745 * (med_cor - median(med_cor)) / (median(abs(med_cor - median(med_cor))) + 1e-9)
cook <- assays(dds)[["cooks"]]
max_cook <- if (!is.null(cook)) apply(cook, 2, max, na.rm = TRUE) else NA
out_tab <- data.frame(sample = ord, group = grp, median_corr = med_cor,
                      corr_modified_z = mad_z, max_cooks = max_cook,
                      flag_corr = ifelse(mad_z < -3.5, "review", ""))
save_table(out_tab, "outlier_diagnostics", PC); save_rds(out_tab, "cook_tab")

## Cook's distance boxplot (DESeq2 diagnostic)
if (!is.null(cook)) save_grid(function()
  boxplot(log10(cook + 1), las = 2, main = "Cook's distance per sample (log10)",
          col = pal[as.character(grp)]), "cooks_distance_boxplot", PC, 100, 80)

## covariate association with PCs (only if informative covariates exist)
covar_avail <- tryCatch(load_rds("covar_avail"), error = function(e) character(0))
if (length(covar_avail)) {
  assoc <- do.call(rbind, lapply(covar_avail, function(cv){
    val <- meta[ord, cv]
    r1 <- suppressWarnings(cor(as.numeric(as.factor(val)), pc$d$PC1))
    r2 <- suppressWarnings(cor(as.numeric(as.factor(val)), pc$d$PC2))
    data.frame(covariate = cv, cor_PC1 = r1, cor_PC2 = r2) }))
  save_table(assoc, "covariate_PC_association", PC)
  say("Covariate-PC association written for: %s", paste(covar_avail, collapse=", "))
} else say("No informative covariates (sex/batch/RIN/date) -> batch/covariate QC skipped, documented.")

say("04 done. PCA/correlation/clustering/outlier diagnostics saved (no samples removed).")
