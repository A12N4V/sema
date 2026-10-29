## ============================================================================
## 12_publication_figures.R  —  compose main figures from saved objects.
## Fig1 overview/QC · Fig2 DE · Fig3 processes (refs GO/GSEA panels) · Fig4 DG biology
## Detailed per-figure specs (objective/message/panels/data/legend/limits): 15_reports/figure_plan.md
## Outputs: 13_publication_figures/*, 14_supplementary_figures/*
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("ggplot2","ggrepel","patchwork"))
library(ggplot2); library(patchwork)

res <- load_rds("res"); meta <- load_rds("meta"); pca <- tryCatch(load_rds("pca"), error=function(e) NULL)
axis_scores <- tryCatch(load_rds("axis_scores"), error=function(e) NULL)
dgid <- tryCatch(utils::read.csv(P("08_DG_identity_enrichment","DG_identity_score_per_sample.csv")), error=function(e) NULL)
PF <- "13_publication_figures"; grp <- meta[[CFG$GROUP_COL]]; pal <- CFG$PAL; ord <- rownames(meta)
VOL <- c(up_in_T = "#D73027", down_in_T = "#1B9E77", ns = "#BDBDBD")

## ---- panels ---------------------------------------------------------------
p_pca <- if (!is.null(pca)) ggplot(pca$d, aes(PC1, PC2, colour = group)) +
  geom_point(size=2.2) + ggrepel::geom_text_repel(aes(label=sample), size=2.2, colour="grey40", show.legend=FALSE) +
  scale_colour_manual(values = pal) +
  labs(x=sprintf("PC1 (%.1f%%)", pca$ve[1]), y=sprintf("PC2 (%.1f%%)", pca$ve[2]), title="PCA") +
  theme_pub() + theme(legend.position="top") else patchwork::plot_spacer()

p_dgid <- if (!is.null(dgid)) ggplot(dgid, aes(group, DG_identity_score, colour=group)) +
  geom_boxplot(outlier.shape=NA, width=.6, linewidth=.3) + pts_layer(size=1.5, cex=2.5) +
  scale_colour_manual(values=pal, guide="none") + labs(x=NULL, y="DG identity score", title="DG identity") +
  theme_pub() else patchwork::plot_spacer()

p_volc <- {
  d <- res[is.finite(res$log2FC_MLE) & !is.na(res$padj), ]; d$cls <- d$direction_FDR
  lab <- head(d[d$cls!="ns",][order(d$padj[d$cls!="ns"]),], 10)
  ggplot(d, aes(log2FC_MLE, -log10(padj), colour=cls)) + geom_point(size=.5, alpha=.6) +
    scale_colour_manual(values=VOL, breaks=c("up_in_T","down_in_T"), name=NULL) +
    geom_vline(xintercept=c(-CFG$LFC_MIN,CFG$LFC_MIN), linetype=2, colour="grey60", linewidth=.3) +
    geom_hline(yintercept=-log10(CFG$FDR), linetype=2, colour="grey60", linewidth=.3) +
    ggrepel::geom_text_repel(data=lab, aes(label=symbol), size=1.9, fontface="italic", colour="grey20", show.legend=FALSE) +
    labs(x=sprintf("log2FC (%s/%s)", CFG$GROUP_TEST, CFG$GROUP_REF), y="-log10(padj)", title="T/V (FDR)") +
    theme_pub() + theme(legend.position="top")
}
p_axes <- if (!is.null(axis_scores)) {
  long <- do.call(rbind, lapply(setdiff(colnames(axis_scores), c("sample","group")), function(a)
    data.frame(axis=a, group=grp, score=axis_scores[[a]])))
  ggplot(long, aes(group, score, colour=group)) +
    geom_boxplot(outlier.shape=NA, width=.6, linewidth=.3) + pts_layer(size=.8, cex=1.6) +
    facet_wrap(~axis, nrow=1, scales="free_y") + scale_colour_manual(values=pal, guide="none") +
    labs(x=NULL, y="axis score (mean z)", title="Targeted axes") + theme_pub()
} else patchwork::plot_spacer()

## ---- compose --------------------------------------------------------------
fig1 <- (p_pca | p_dgid) + patchwork::plot_annotation(tag_levels = "A", title = "Figure 1 — Overview & DG identity")
save_plot(fig1, "Figure1_overview", PF, 180, 85)
fig2 <- (p_volc) + patchwork::plot_annotation(tag_levels="A", title="Figure 2 — Differential expression (T vs V)")
save_plot(fig2, "Figure2_DE", PF, 110, 95)
fig4 <- (p_axes) + patchwork::plot_annotation(tag_levels="A", title="Figure 4 — DG-directed biology")
save_plot(fig4, "Figure4_DG_biology", PF, 190, 70)

## Figure 3 (GO/GSEA) and Figure 5 (conceptual model) reference saved panels:
writeLines(c(
  "Figure 3 panels are produced in 09_GO_ORA/ and 11_pathway_visualization/",
  " - GO dotplots (up/down, BP/CC/MF): 09_GO_ORA/BP|CC|MF/GO_*_dotplot.*",
  " - GSEA bar/dotplots (Wald): 11_pathway_visualization/GSEA_*_wald_bar.*, GSEA_dotplot_top_wald.*",
  " - Leading-edge heatmap: 11_pathway_visualization/GSEA_leadingEdge_topPathway.*",
  "Figure 5 is a CONCEPTUAL MODEL (hypothesis) — draw manually from convergent_candidates + top pathways;",
  " label explicitly as 'model/hypothesis', not a result. See 15_reports/figure_plan.md."),
  P(PF, "Figure3_Figure5_sources.txt"))
say("12 done. Composite Figures 1/2/4 built; Fig3/Fig5 sources documented.")
