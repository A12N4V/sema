## ============================================================================
## 11_integrated_analysis.R  —  integrate DE + GO + GSEA + signatures.
## Correlations among scores; scores vs PC1/PC2; pathway-based clustering;
## integrated heatmap; UpSet of shared signature genes; convergent candidates.
## Language is associative only (no causal claims) — see report.
## Outputs: 12_candidate_genes/*, 11_pathway_visualization/*, 13_publication_figures/
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("ggplot2","pheatmap"))
library(ggplot2)

res <- load_rds("res"); meta <- load_rds("meta")
identity_scores <- tryCatch(load_rds("identity_scores"), error=function(e) NULL)
axis_scores     <- tryCatch(load_rds("axis_scores"),     error=function(e) NULL)
pca             <- tryCatch(load_rds("pca"),             error=function(e) NULL)
CG <- "12_candidate_genes"; PV <- "11_pathway_visualization"; grp <- meta[[CFG$GROUP_COL]]; ord <- rownames(meta)

## ---- assemble sample x score matrix --------------------------------------
score_cols <- function(df) if (is.null(df)) NULL else df[, !colnames(df) %in% c("sample","group"), drop=FALSE]
S <- do.call(cbind, Filter(Negate(is.null), list(score_cols(axis_scores), score_cols(identity_scores))))
if (!is.null(S) && ncol(S) >= 2) {
  S <- as.matrix(S); rownames(S) <- ord
  S <- S[, apply(S, 2, function(cc){ cc <- cc[is.finite(cc)]; length(cc) >= 2 && stats::sd(cc) > 0 }), drop=FALSE]
}
if (!is.null(S) && ncol(S) >= 2) {
  ## correlation among pathway/axis scores
  Rc <- cor(S, use = "pairwise.complete.obs")
  save_table(data.frame(score = rownames(Rc), Rc, check.names = FALSE), "score_correlation_matrix", CG)
  save_grid(function() pheatmap::pheatmap(Rc, main = "Correlation among pathway/identity scores",
              color = colorRampPalette(c(CFG$DIVERGE["low"],CFG$DIVERGE["mid"],CFG$DIVERGE["high"]))(51)),
            "score_correlation_heatmap", PV, 130, 120)
  ## scores vs PC1/PC2
  if (!is.null(pca)) {
    pcs <- pca$d[ord, c("PC1","PC2")]
    corr_pc <- t(apply(S, 2, function(col) c(PC1 = cor(col, pcs$PC1, use="complete.obs"),
                                             PC2 = cor(col, pcs$PC2, use="complete.obs"))))
    save_table(data.frame(score = rownames(corr_pc), corr_pc), "score_vs_PC_correlation", CG)
  }
  ## sample clustering based on pathway scores
  save_grid(function() pheatmap::pheatmap(t(scale(S)), main = "Samples clustered by pathway scores",
              annotation_col = data.frame(group = grp, row.names = ord),
              annotation_colors = list(group = CFG$PAL)),
            "integrated_score_heatmap", "13_publication_figures", 120, 110)
}

## ---- UpSet of shared genes across the documented signatures --------------
ct <- utils::read.csv(P("signatures","DG_cell_type_signatures.csv"), stringsAsFactors=FALSE)
ax <- utils::read.csv(P("signatures","targeted_axes_signatures.csv"), stringsAsFactors=FALSE)
setlist <- c(split(ct$gene, ct$signature), split(ax$gene, ax$axis))
setlist <- setlist[vapply(setlist, function(x) length(unique(x))>=3, logical(1))]
if (requireNamespace("UpSetR", quietly = TRUE) && length(setlist) >= 2) {
  try({
    grDevices::cairo_pdf(P(CG,"UpSet_signature_gene_overlap.pdf"), width=9, height=5)
    print(UpSetR::upset(UpSetR::fromList(setlist), nsets = length(setlist), order.by = "freq"))
    grDevices::dev.off()
  }, silent = TRUE)
}

## ---- convergent candidate genes: DE (exploratory or FDR) AND in a curated signature
lit_genes <- unique(c(ct$gene, ax$gene))
de_genes  <- res$symbol[res$sig_exploratory | res$sig_FDR]
conv <- res[res$symbol %in% intersect(de_genes, lit_genes),
            c("gene_id","symbol","log2FC_MLE","log2FC_apeglm","pvalue","padj",
              "direction_FDR","direction_expl")]
conv$in_signature <- vapply(conv$symbol, function(g){
  s1 <- unique(ct$signature[ct$gene==g]); s2 <- unique(ax$axis[ax$gene==g])
  paste(c(s1,s2), collapse=";") }, character(1))
conv <- conv[order(conv$pvalue), ]
save_table(conv, "convergent_candidates_DE_and_literature", CG)

## ---- shared leading-edge genes across GSEA pathways (Wald) ----------------
le_file <- P("10_GSEA","GSEA_leadingEdge_topPathway_genes.csv")
if (file.exists(le_file)) {
  le <- utils::read.csv(le_file, stringsAsFactors=FALSE)
  save_table(as.data.frame(sort(table(le$leadingEdge_gene), decreasing=TRUE)),
             "leadingEdge_gene_frequency", CG)
}
say("11 done. Integrated correlations, clustering, UpSet, convergent candidates saved.")
