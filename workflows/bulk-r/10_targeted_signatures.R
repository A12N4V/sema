## ============================================================================
## 10_targeted_signatures.R  —  DG-directed axes:
##   Neurogenesis · Plasticity · Inflammation · Metabolism · Endocannabinoid
## Per axis: gene table, heatmap, individual expression, per-sample score,
##           group comparison. Interpretation limited to the data (see report).
## Outputs: 12_candidate_genes/*, 07_heatmaps/axes_*
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("ggplot2","pheatmap"))
library(ggplot2)

vstm <- load_rds("vst"); meta <- load_rds("meta"); annot <- load_rds("annot"); res <- load_rds("res")
CG <- "12_candidate_genes"; HM <- "07_heatmaps"
grp <- meta[[CFG$GROUP_COL]]; pal <- CFG$PAL; ord <- colnames(vstm)
sym <- annot[rownames(vstm), "symbol"]; z <- row_z(vstm)

ax <- utils::read.csv(P("signatures","targeted_axes_signatures.csv"), stringsAsFactors = FALSE)
axes <- split(ax, ax$axis)
score_all <- data.frame(sample = ord, group = grp)

for (axis in names(axes)) {
  genes <- unique(axes[[axis]]$gene)
  ids   <- rownames(vstm)[tolower(sym) %in% tolower(genes)]
  if (length(ids) < 3) { say("Axis %s: <3 genes detected, skipped.", axis); next }
  gsym  <- sym[match(ids, rownames(vstm))]

  ## gene table with DE stats (merge DESeq2 results)
  tab <- res[match(ids, res$gene_id), c("gene_id","symbol","baseMean","log2FC_MLE",
                                        "log2FC_apeglm","pvalue","padj","direction_FDR")]
  tab$axis <- axis
  tab$subaxis <- axes[[axis]]$subaxis[match(gsym, axes[[axis]]$gene)]
  save_table(tab, sprintf("axis_%s_gene_table", axis), CG)

  ## heatmap (VST z), rows clustered, columns split by group order
  M <- z[ids, ord, drop=FALSE]; rownames(M) <- make.unique(gsym); M <- clean_rows(M)
  if (nrow(M) >= 2)
  save_grid(function() pheatmap::pheatmap(M, main = sprintf("%s (VST z)", axis),
              annotation_col = data.frame(group = grp, row.names = ord),
              annotation_colors = list(group = pal), cluster_cols = FALSE, fontsize_row = 6,
              color = colorRampPalette(c(CFG$DIVERGE["low"],CFG$DIVERGE["mid"],CFG$DIVERGE["high"]))(51)),
            sprintf("axes_heatmap_%s", axis), HM, 95, max(60, 12+2.4*length(ids)))

  ## per-sample pathway score (mean z)
  sc <- colMeans(z[ids, , drop=FALSE], na.rm = TRUE)
  score_all[[axis]] <- sc[ord]

  ## individual expression of priority genes (top by |Wald| within axis)
  pr <- tab[order(-abs(res$stat_Wald[match(tab$gene_id, res$gene_id)])), ]
  pr <- head(pr$gene_id[!is.na(pr$gene_id)], 9)
  if (length(pr)) {
    dfl <- do.call(rbind, lapply(pr, function(g)
      data.frame(gene = annot[g,"symbol"], group = grp, expr = vstm[g, ord])))
    gp <- ggplot(dfl, aes(group, expr, colour = group)) +
      geom_boxplot(outlier.shape=NA, width=.6, linewidth=.3) +
      pts_layer(size=1, cex=2) +
      facet_wrap(~gene, scales="free_y") + scale_colour_manual(values = pal, guide="none") +
      labs(x=NULL, y="VST expression", title=sprintf("%s — priority genes", axis)) + theme_pub()
    save_plot(gp, sprintf("axis_%s_priority_gene_expression", axis), CG, 130, 110)
  }
}

## per-sample axis-score table + group comparison
save_table(score_all, "axis_scores_per_sample", CG)
comp <- lapply(setdiff(colnames(score_all), c("sample","group")), function(a){
  x <- score_all[[a]][grp==CFG$GROUP_REF]; y <- score_all[[a]][grp==CFG$GROUP_TEST]
  w <- suppressWarnings(wilcox.test(y, x))
  data.frame(axis=a, mean_V=mean(x), mean_T=mean(y), delta_T_minus_V=mean(y)-mean(x),
             cohens_d=(mean(y)-mean(x))/sqrt(((var(x)+var(y))/2)), wilcox_p=w$p.value)})
comp <- do.call(rbind, comp); comp$wilcox_padj <- p.adjust(comp$wilcox_p, "BH")
save_table(comp, "axis_scores_group_comparison", CG)

## axis-score summary plot (individual points + boxplot)
long <- do.call(rbind, lapply(setdiff(colnames(score_all), c("sample","group")), function(a)
  data.frame(axis=a, group=grp, score=score_all[[a]])))
ga <- ggplot(long, aes(group, score, colour = group)) +
  geom_boxplot(outlier.shape=NA, width=.6, linewidth=.3) +
  pts_layer(size=1, cex=2) +
  facet_wrap(~axis, scales="free_y", nrow=1) + scale_colour_manual(values = pal, guide="none") +
  labs(x=NULL, y="axis score (mean z)", title="Targeted axis scores (T vs V)") + theme_pub()
save_plot(ga, "axis_scores_summary", CG, 170, 60)

save_rds(score_all, "axis_scores")
say("10 done. Targeted axes (neurogenesis/plasticity/inflammation/metabolism/eCB) saved.")
