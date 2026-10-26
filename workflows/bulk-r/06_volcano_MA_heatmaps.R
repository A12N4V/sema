## ============================================================================
## 06_volcano_MA_heatmaps.R  —  volcano (FDR & p), MA, p/padj hist, LFC dist,
##                              top-DEG heatmaps (25/50/100), candidate expression
## Outputs: 06_volcano_plots/*, 07_heatmaps/*, 05_.../ (hist/MA)
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("ggplot2","ggrepel","pheatmap"))
library(ggplot2)

res <- load_rds("res"); vstm <- load_rds("vst"); meta <- load_rds("meta"); annot <- load_rds("annot")
VP <- "06_volcano_plots"; HM <- "07_heatmaps"; DE <- "05_differential_expression"
grp <- meta[[CFG$GROUP_COL]]; pal <- CFG$PAL
VOL <- c(up_in_T = "#D73027", down_in_T = "#1B9E77", ns = "#BDBDBD")

## ---- volcano (generic) ----------------------------------------------------
volcano <- function(sig_col, dir_col, yval, ylab, title, n_label = 12) {
  d <- res[is.finite(res$log2FC_MLE) & !is.na(res[[yval]]), ]
  d$cls <- d[[dir_col]]
  xL <- min(max(1, max(abs(d$log2FC_MLE[d$cls!="ns"]), na.rm = TRUE) * 1.05), 10)
  yy  <- -log10(d[[yval]]); yL <- max(yy[is.finite(yy)], na.rm = TRUE) * 1.05
  lab <- head(d[d$cls != "ns", ][order(d[[yval]][d$cls!="ns"]), ], n_label)
  ggplot(d, aes(log2FC_MLE, -log10(.data[[yval]]), colour = cls)) +
    geom_point(size = .6, alpha = .6) +
    scale_colour_manual(values = VOL, breaks = c("up_in_T","down_in_T"),
                        labels = c("up in T","down in T"), name = NULL) +
    geom_vline(xintercept = c(-CFG$LFC_MIN, CFG$LFC_MIN), linetype = 2, colour = "grey60", linewidth = .3) +
    geom_hline(yintercept = -log10(CFG$FDR), linetype = 2, colour = "grey60", linewidth = .3) +
    ggrepel::geom_text_repel(data = lab, aes(label = symbol), size = 2, fontface = "italic",
                             colour = "grey20", max.overlaps = 20, show.legend = FALSE) +
    annotate("text", x=-xL, y=yL, hjust=0, vjust=1, size=2.4, colour=VOL["down_in_T"],
             label = sprintf("down %d", sum(d$cls=="down_in_T"))) +
    annotate("text", x= xL, y=yL, hjust=1, vjust=1, size=2.4, colour=VOL["up_in_T"],
             label = sprintf("up %d", sum(d$cls=="up_in_T"))) +
    coord_cartesian(xlim = c(-xL, xL), ylim = c(0, yL)) +
    labs(x = sprintf("log2FC (%s/%s), MLE", CFG$GROUP_TEST, CFG$GROUP_REF),
         y = ylab, title = title) +
    theme_pub() + theme(legend.position = c(.5,.02), legend.justification = c(.5,0),
                        legend.direction = "horizontal")
}
## Note: y-axis uses padj (FDR volcano) or pvalue (exploratory); thresholds drawn for both.
save_plot(volcano("sig_FDR","direction_FDR","padj","-log10(padj)","T/V (FDR)"),
          "volcano_FDR", VP, 80, 78)
save_plot(volcano("sig_exploratory","direction_expl","pvalue","-log10(p)","T/V (exploratory p)"),
          "volcano_exploratory_pvalue", VP, 80, 78)

## ---- MA plot --------------------------------------------------------------
gma <- ggplot(res[is.finite(res$log2FC_apeglm),],
              aes(baseMean, log2FC_apeglm, colour = direction_FDR)) +
  geom_point(size=.5, alpha=.5) + scale_x_log10() +
  scale_colour_manual(values = VOL, breaks=c("up_in_T","down_in_T"), name=NULL) +
  geom_hline(yintercept = 0, colour="grey40", linewidth=.3) +
  labs(x = "mean of normalized counts", y = "log2FC (apeglm shrunk)", title = "MA plot") +
  theme_pub()
save_plot(gma, "MA_plot_apeglm", VP, 85, 70)

## ---- p / padj histograms + LFC distribution ------------------------------
save_plot(ggplot(res, aes(pvalue)) + geom_histogram(bins=40, fill="grey60", colour="white") +
            labs(x="p-value", y="genes", title="p-value distribution") + theme_pub(),
          "hist_pvalue", DE, 80, 60)
save_plot(ggplot(res[!is.na(res$padj),], aes(padj)) + geom_histogram(bins=40, fill="grey60", colour="white") +
            labs(x="padj", y="genes", title="padj distribution") + theme_pub(),
          "hist_padj", DE, 80, 60)
save_plot(ggplot(res, aes(log2FC_MLE)) + geom_histogram(bins=60, fill="grey60", colour="white") +
            geom_vline(xintercept=c(-CFG$LFC_MIN,CFG$LFC_MIN), linetype=2, colour="grey40") +
            labs(x="log2FC (MLE)", y="genes", title="log2FC distribution") + theme_pub(),
          "hist_log2FC", DE, 80, 60)

## ---- top-DEG heatmaps (rank by statistical evidence, not FC magnitude) ----
z <- row_z(vstm); ord <- colnames(z)
ann_col <- data.frame(group = grp, row.names = ord)
heat_top <- function(n) {
  cand <- res[!is.na(res$pvalue), ]
  cand <- cand[order(cand$pvalue), ]
  ids  <- head(cand$gene_id, n); ids <- ids[ids %in% rownames(z)]
  if (length(ids) < 2) return(invisible(NULL))
  M <- z[ids, ord, drop=FALSE]; rownames(M) <- make.unique(annot[ids, "symbol"]); M <- clean_rows(M)
  if (nrow(M) < 2) return(invisible(NULL))
  save_grid(function() pheatmap::pheatmap(M, main = sprintf("Top %d DEGs by evidence (VST z)", n),
              annotation_col = ann_col, annotation_colors = list(group = pal),
              show_rownames = n <= 60, fontsize_row = 6,
              color = colorRampPalette(c(CFG$DIVERGE["low"], CFG$DIVERGE["mid"], CFG$DIVERGE["high"]))(51)),
            sprintf("heatmap_top%d_DEGs", n), HM, 110, max(90, 6+2.2*length(ids)))
}
for (n in c(25, 50, 100)) heat_top(n)

## ---- individual expression of top candidate genes ------------------------
top_genes <- head(res$gene_id[!is.na(res$pvalue)], 9)
if (length(top_genes)) {
  dfl <- do.call(rbind, lapply(top_genes, function(g)
    data.frame(gene = annot[g,"symbol"], sample = ord, group = grp, expr = vstm[g, ord])))
  gexp <- ggplot(dfl, aes(group, expr, colour = group)) +
    geom_boxplot(outlier.shape = NA, width=.6, linewidth=.3) +
    pts_layer(size=1, cex=2) +
    facet_wrap(~gene, scales = "free_y") + scale_colour_manual(values = pal, guide="none") +
    labs(x=NULL, y="VST expression", title="Top candidate genes (individual points)") +
    theme_pub()
  save_plot(gexp, "top_candidate_gene_expression", HM, 130, 110)
}
say("06 done. Volcano (FDR + exploratory), MA, histograms, top-DEG heatmaps saved.")
