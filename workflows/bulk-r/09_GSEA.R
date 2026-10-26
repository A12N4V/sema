## ============================================================================
## 09_GSEA.R  —  GSEA on ALL tested genes (no pre-filter).
## Ranking: Wald stat (primary); log2FC & signed -log10(p) (sensitivity).
## Collections: Hallmark, GO:BP, Reactome (MSigDB mouse) + custom DG/axes sets.
## Outputs: 10_GSEA/*, 11_pathway_visualization/*
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("fgsea","msigdbr","ggplot2"))
suppressPackageStartupMessages({library(fgsea); library(msigdbr); library(ggplot2)})

res <- load_rds("res"); GS <- "10_GSEA"; PV <- "11_pathway_visualization"

## ---- rankings (named by symbol; ties handled by fgsea multilevel) ---------
mk_rank <- function(v) { r <- v; names(r) <- res$symbol
  r <- r[!is.na(r) & !is.na(names(r))]; r <- r[!duplicated(names(r))]; sort(r, decreasing = TRUE) }
ranks <- list(
  wald         = mk_rank(res$stat_Wald),                                  # PRIMARY
  log2FC       = mk_rank(res$log2FC_MLE),                                 # sensitivity
  signed_p     = mk_rank(sign(res$log2FC_MLE) * -log10(res$pvalue)))      # sensitivity
save_rds(ranks, "gsea_ranks")

## ---- gene-set collections -------------------------------------------------
msig_get <- function(coll, sub = NULL) {
  base <- if (is.null(sub)) list(collection = coll) else list(collection = coll, subcollection = sub)
  for (a in list(c(list(species="mouse"), base), c(list(species="mouse", db_species="MM"), base),
                 c(list(db_species="MM"), base))) {
    x <- try(suppressMessages(do.call(msigdbr, a)), silent = TRUE)
    if (!inherits(x,"try-error") && is.data.frame(x) && nrow(x)>0) return(x)
  }; stop("msigdbr mouse retrieval failed; check version (>=v26 uses species='mouse').")
}
symcol <- function(m) if ("gene_symbol" %in% names(m)) m$gene_symbol else m$mouse_symbol
collections <- list()
collections$Hallmark <- tryCatch({ m <- msig_get("H");            split(symcol(m), m$gs_name) }, error=function(e) NULL)
collections$GO_BP    <- tryCatch({ m <- msig_get("C5","GO:BP");   split(symcol(m), m$gs_name) }, error=function(e) NULL)
collections$Reactome <- tryCatch({ m <- msig_get("C2","CP:REACTOME"); split(symcol(m), m$gs_name) }, error=function(e) NULL)

## custom collections from the documented targeted-axes signatures + DG cell types
ax  <- utils::read.csv(P("signatures","targeted_axes_signatures.csv"), stringsAsFactors=FALSE)
ct  <- utils::read.csv(P("signatures","DG_cell_type_signatures.csv"), stringsAsFactors=FALSE)
custom <- c(split(ax$gene, paste0("AXIS_", ax$axis, "__", ax$subaxis)),
            split(ct$gene, paste0("DGTYPE_", ct$signature)))
custom <- custom[vapply(custom, function(g) length(unique(g)) >= 5, logical(1))]
collections$Custom_DG_axes <- custom
## KEGG note: gseKEGG requires live KEGG REST API; run separately if licence/network allow.
writeLines("KEGG GSEA not run offline. Use clusterProfiler::gseKEGG(organism='mmu') with internet.",
           P(GS, "README_KEGG.txt"))

## ---- run fgsea over collections x rankings -------------------------------
gsea_bar <- function(df, title, n = 15) {
  d <- df[!is.na(df$NES) & !is.na(df$padj), ]
  if (!nrow(d)) return(NULL)
  d$pw <- pretty_pw(d$pathway)
  d <- d[order(-abs(d$NES)), ]; d <- d[!duplicated(d$pw), ]
  pos <- head(d[d$NES > 0, ][order(d$padj[d$NES>0]), ], n)
  neg <- head(d[d$NES < 0, ][order(d$padj[d$NES<0]), ], n)
  top <- rbind(pos, neg); top <- top[order(top$NES), ]; top$pw <- factor(top$pw, levels = top$pw)
  top$sig <- top$padj < CFG$GSEA_FDR
  ggplot(top, aes(NES, pw, fill = -log10(padj))) +
    geom_col(width=.75, colour="grey55", linewidth=.12) +
    geom_vline(xintercept = 0, linetype = 2, colour="grey55", linewidth=.25) +
    scale_fill_gradient(low = "#C6D3DE", high = "#2C5F8A", name = "-log10 FDR") +
    scale_y_discrete(labels = function(z) substr(z, 1, 46)) +
    labs(x = "NES", y = NULL, title = title) +
    theme_pub() + theme(axis.text.y = element_text(size = 6))
}
all_res <- list()
for (cn in names(collections)) {
  gs <- collections[[cn]]; if (is.null(gs) || !length(gs)) { say("Collection %s unavailable, skipped.", cn); next }
  for (rn in names(ranks)) {
    fg <- tryCatch(fgseaMultilevel(gs, ranks[[rn]], minSize = CFG$GSEA_MINSIZE,
                    maxSize = CFG$GSEA_MAXSIZE, eps = 0, nproc = 1), error = function(e) NULL)
    if (is.null(fg) || !nrow(fg)) next
    fg$collection <- cn; fg$ranking <- rn; all_res[[paste(cn,rn,sep="_")]] <- fg
    ## export table (leading edge collapsed to ; )
    out <- as.data.frame(fg); out$leadingEdge <- vapply(fg$leadingEdge, paste, "", collapse = ";")
    save_table(out[order(out$padj), ], sprintf("GSEA_%s_%s", cn, rn), GS)
    if (rn == "wald") {   # primary ranking -> figures
      g <- gsea_bar(fg, sprintf("GSEA %s (Wald)", cn)); if (!is.null(g)) save_plot(g, sprintf("GSEA_%s_wald_bar", cn), PV, 120, 120)
    }
  }
}
comb <- if (length(all_res)) do.call(rbind, lapply(all_res, function(x){ x$leadingEdge <- NULL; as.data.frame(x)})) else NULL
if (!is.null(comb)) {
  save_table(comb[order(comb$padj), ], "GSEA_all_collections_wald_and_sensitivity", GS)
  ## dotplot of top NES (Wald, significant + exploratory-trend flagged)
  wp <- comb[comb$ranking=="wald", ]; wp <- wp[!is.na(wp$NES), ]
  wp$trend <- ifelse(wp$padj < CFG$GSEA_FDR, "FDR<0.05", "exploratory trend")
  topd <- do.call(rbind, by(wp, wp$collection, function(z){
    z <- z[order(z$padj), ]; head(z, 12) }))
  gdot <- ggplot(topd, aes(NES, reorder(pretty_pw(pathway), NES), colour = trend, size = size)) +
    geom_point() + facet_grid(collection ~ ., scales="free_y", space="free_y") +
    scale_colour_manual(values = c("FDR<0.05"="#B2182B","exploratory trend"="grey65")) +
    geom_vline(xintercept=0, linetype=2, colour="grey60") +
    labs(x="NES", y=NULL, title="GSEA top pathways (Wald ranking)") +
    theme_pub() + theme(axis.text.y = element_text(size=5.5), strip.text.y = element_text(angle=0))
  save_plot(gdot, "GSEA_dotplot_top_wald", PV, 150, 190)
}

## ---- leading-edge heatmap for the single top pathway (Wald) --------------
if (length(all_res)) {
  best <- NULL
  for (nm in names(all_res)) if (grepl("_wald$", nm)) {
    fg <- all_res[[nm]]; fg <- fg[order(fg$padj), ]
    if (is.null(best) || fg$padj[1] < best$padj[1]) best <- fg[1, ]
  }
  if (!is.null(best)) {
    vstm <- load_rds("vst"); meta <- load_rds("meta"); annot <- load_rds("annot")
    le <- best$leadingEdge[[1]]; sym <- annot[rownames(vstm),"symbol"]
    ids <- rownames(vstm)[tolower(sym) %in% tolower(le)]
    if (length(ids) >= 3) {
      z <- row_z(vstm)[ids, , drop=FALSE]; rownames(z) <- make.unique(sym[match(ids, rownames(vstm))])
      need_pkg("pheatmap")
      save_grid(function() pheatmap::pheatmap(z, main = sprintf("Leading edge: %s", pretty_pw(best$pathway)),
                  annotation_col = data.frame(group = meta[[CFG$GROUP_COL]], row.names = colnames(z)),
                  annotation_colors = list(group = CFG$PAL), fontsize_row = 6),
                "GSEA_leadingEdge_topPathway", PV, 120, 150)
      save_table(data.frame(pathway = best$pathway, leadingEdge_gene = le),
                 "GSEA_leadingEdge_topPathway_genes", GS)
    }
  }
}
say("09 done. GSEA (Wald primary; log2FC & signed-p sensitivity) over Hallmark/GO:BP/Reactome/custom.")
