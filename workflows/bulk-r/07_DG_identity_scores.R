## ============================================================================
## 07_DG_identity_scores.R  —  regional identity / DG enrichment assessment
## NOT histological purity. Scores = "DG identity / enrichment score".
## Methods: mean-of-z (default) + GSVA + singscore (sensitivity).
## Outputs: 08_DG_identity_enrichment/*
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("ggplot2","pheatmap"))
library(ggplot2)

vstm <- load_rds("vst"); meta <- load_rds("meta"); annot <- load_rds("annot")
ID <- "08_DG_identity_enrichment"; grp <- meta[[CFG$GROUP_COL]]; pal <- CFG$PAL; ord <- colnames(vstm)
sym <- annot[rownames(vstm), "symbol"]; z <- row_z(vstm)

sig <- utils::read.csv(P("signatures","DG_cell_type_signatures.csv"), stringsAsFactors = FALSE)
save_table(sig, "DG_signature_reference_table", ID)  # documented gene->signature table
sig_list <- split(sig$gene, sig$signature)

## ---- method 1: mean-of-z score per signature -----------------------------
score_z <- sapply(sig_list, function(g) sig_score_meanz(z, g, sym))  # samples x signatures
score_z <- as.data.frame(score_z); score_z$sample <- ord; score_z$group <- grp
save_table(score_z, "signature_scores_meanZ", ID)

## ---- method 2: GSVA / ssGSEA (sensitivity) -------------------------------
if (requireNamespace("GSVA", quietly = TRUE)) {
  gset <- lapply(sig_list, function(g) rownames(vstm)[tolower(sym) %in% tolower(g)])
  gset <- gset[vapply(gset, length, 1L) >= 2]
  gsva_es <- tryCatch({
    par <- GSVA::gsvaParam(as.matrix(vstm), gset); GSVA::gsva(par)
  }, error = function(e) { message("GSVA failed: ", e$message); NULL })
  if (!is.null(gsva_es)) {
    df <- data.frame(t(gsva_es)); df$sample <- rownames(df); df$group <- grp
    save_table(df, "signature_scores_GSVA", ID)
  }
}
## ---- method 3: singscore (sensitivity) -----------------------------------
if (requireNamespace("singscore", quietly = TRUE)) {
  rk <- tryCatch(singscore::rankGenes(as.matrix(vstm)), error = function(e) NULL)
  if (!is.null(rk)) {
    ss <- sapply(sig_list, function(g){
      ids <- rownames(vstm)[tolower(sym) %in% tolower(g)]
      if (length(ids) < 2) return(rep(NA, ncol(vstm)))
      tryCatch(singscore::simpleScore(rk, upSet = ids)$TotalScore, error = function(e) rep(NA, ncol(vstm)))
    })
    ss <- as.data.frame(ss); ss$sample <- ord; ss$group <- grp
    save_table(ss, "signature_scores_singscore", ID)
  }
}

## ---- marker-gene heatmap (per sample) ------------------------------------
mk_ids <- rownames(vstm)[tolower(sym) %in% tolower(sig$gene)]
if (length(mk_ids) >= 3) {
  M <- z[mk_ids, ord, drop=FALSE]; rownames(M) <- make.unique(sym[match(mk_ids, rownames(vstm))])
  M <- clean_rows(M)                       # drop NA / zero-variance rows (avoid hclust failure)
  save_grid(function() pheatmap::pheatmap(M, main = "DG marker genes (VST z)",
              annotation_col = data.frame(group = grp, row.names = ord),
              annotation_colors = list(group = pal), fontsize_row = 5, show_rownames = TRUE,
              color = colorRampPalette(c(CFG$DIVERGE["low"],CFG$DIVERGE["mid"],CFG$DIVERGE["high"]))(51)),
            "heatmap_marker_genes", ID, 120, 200)
}

## ---- signature heatmap (per sample) --------------------------------------
sm <- t(as.matrix(score_z[, setdiff(colnames(score_z), c("sample","group"))]))
colnames(sm) <- ord
sm <- clean_rows(sm)                        # drop signatures with <2 detected genes (all-NA rows)
save_grid(function() pheatmap::pheatmap(sm, main = "Signature scores (mean z)",
            annotation_col = data.frame(group = grp, row.names = ord),
            annotation_colors = list(group = pal), cluster_cols = FALSE,
            color = colorRampPalette(c(CFG$DIVERGE["low"],CFG$DIVERGE["mid"],CFG$DIVERGE["high"]))(51)),
          "heatmap_signature_scores", ID, 120, 130)

## ---- DG identity score (composite of DG granule + neurogenesis - contaminants)
dg_pos <- c("DG_granule_mature","DG_granule_immature","NSC","NSC_quiescent","NSC_active","IPC_neuroblast")
dg_neg <- c("CA1","CA3","ChoroidPlexus","Ependymal")
pos <- rowMeans(score_z[, intersect(dg_pos, colnames(score_z)), drop=FALSE], na.rm=TRUE)
neg <- rowMeans(score_z[, intersect(dg_neg, colnames(score_z)), drop=FALSE], na.rm=TRUE)
dgid <- data.frame(sample = ord, group = grp, DG_identity_score = pos - neg,
                   DG_positive = pos, contaminant = neg)
save_table(dgid, "DG_identity_score_per_sample", ID)

gid <- ggplot(dgid, aes(group, DG_identity_score, colour = group)) +
  geom_boxplot(outlier.shape=NA, width=.6, linewidth=.3) +
  pts_layer(size=1.6, cex=2.5) +
  ggrepel::geom_text_repel(aes(label = sample), size=2.2, colour="grey40", show.legend=FALSE) +
  scale_colour_manual(values = pal, guide="none") +
  labs(x=NULL, y="DG identity / enrichment score", title="DG identity score (mean-z composite)") +
  theme_pub()
save_plot(gid, "DG_identity_score", ID, 70, 75)

## group comparison (Wilcoxon; report effect + individual points, not just p)
wl <- lapply(setdiff(colnames(score_z), c("sample","group")), function(s){
  x <- score_z[[s]][grp==CFG$GROUP_REF]; y <- score_z[[s]][grp==CFG$GROUP_TEST]
  w <- if (sum(!is.na(x))>=2 && sum(!is.na(y))>=2) suppressWarnings(wilcox.test(y, x)) else list(p.value=NA_real_);
  data.frame(signature=s, mean_V=mean(x,na.rm=TRUE), mean_T=mean(y,na.rm=TRUE),
             delta_T_minus_V=mean(y,na.rm=TRUE)-mean(x,na.rm=TRUE), wilcox_p=w$p.value) })
wl <- do.call(rbind, wl); wl$wilcox_padj <- p.adjust(wl$wilcox_p, "BH")
save_table(wl, "signature_group_comparison", ID)

## contaminant-region signatures plot
cont_sigs <- intersect(dg_neg, colnames(score_z))
cl <- do.call(rbind, lapply(cont_sigs, function(s)
  data.frame(signature = s, sample = ord, group = grp, score = score_z[[s]])))
gc <- ggplot(cl, aes(signature, score, colour = group)) +
  pts_layer(dodge.width=.6, size=1.4) +
  scale_colour_manual(values = pal) +
  labs(x=NULL, y="signature score (mean z)", title="Potential contaminant-region signatures") +
  theme_pub() + theme(axis.text.x=element_text(angle=45, hjust=1))
save_plot(gc, "contaminant_region_signatures", ID, 90, 75)

save_rds(score_z, "identity_scores")
say("07 done. DG identity/enrichment scores (mean-z + GSVA/singscore sensitivity) saved. NOT purity.")
