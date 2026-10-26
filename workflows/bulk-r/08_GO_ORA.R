## ============================================================================
## 08_GO_ORA.R  —  GO over-representation (BP/CC/MF) for up / down / all sig.
## Background = all tested genes. Redundancy reduced via clusterProfiler::simplify.
## Outputs: 09_GO_ORA/{BP,CC,MF}/*
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("clusterProfiler","org.Mm.eg.db","enrichplot","ggplot2"))
suppressPackageStartupMessages({library(clusterProfiler); library(org.Mm.eg.db); library(ggplot2)})

res <- load_rds("res")
to_entrez <- function(symbols) {
  s <- unique(symbols[!is.na(symbols) & nzchar(symbols)])
  if (!length(s)) return(character(0))
  r <- tryCatch(suppressWarnings(suppressMessages(
        bitr(s, "SYMBOL", "ENTREZID", org.Mm.eg.db))), error = function(e) NULL)
  if (is.null(r)) character(0) else unique(stats::na.omit(r$ENTREZID))
}
universe <- to_entrez(res$symbol[!is.na(res$pvalue)])

## gene sets: use PRIMARY FDR DEGs; if too few, fall back to exploratory (flagged)
use_expl <- sum(res$sig_FDR) < 15
flagcol  <- if (use_expl) "direction_expl" else "direction_FDR"
if (use_expl) say("Few FDR DEGs (<15): GO uses exploratory p<%.2f gene set (flagged as exploratory).", CFG$P_NOMINAL)
sets <- list(
  up_in_T   = res$symbol[res[[flagcol]] == "up_in_T"],
  down_in_T = res$symbol[res[[flagcol]] == "down_in_T"],
  all_sig   = res$symbol[res[[flagcol]] != "ns"])

run_go <- function(ont) {
  outdir <- file.path("09_GO_ORA", ont)
  for (nm in names(sets)) {
    ent <- to_entrez(sets[[nm]])
    if (length(ent) < 10) { say("GO %s %s: <10 mapped genes, skipped (empty-set plot noted).", ont, nm); next }
    ego <- tryCatch(enrichGO(ent, OrgDb = org.Mm.eg.db, ont = ont, universe = universe,
                    pAdjustMethod = "BH", qvalueCutoff = CFG$GO_QVAL, readable = TRUE),
                    error = function(e) NULL)
    if (is.null(ego) || nrow(as.data.frame(ego)) == 0) { say("GO %s %s: no enriched terms.", ont, nm); next }
    ego_s <- tryCatch(clusterProfiler::simplify(ego, cutoff = 0.7, by = "p.adjust", select_fun = min),
                      error = function(e) ego)
    df  <- as.data.frame(ego); dfs <- as.data.frame(ego_s)
    save_table(df,  sprintf("GO_%s_%s_complete", ont, nm), outdir)
    save_table(head(dfs[order(dfs$p.adjust), ], CFG$TOP_N_TERMS),
               sprintf("GO_%s_%s_top%d_simplified", ont, nm, CFG$TOP_N_TERMS), outdir)
    ## dot + bar
    try(save_plot(enrichplot::dotplot(ego_s, showCategory = CFG$TOP_N_TERMS) +
          ggtitle(sprintf("GO:%s %s", ont, nm)) + theme_pub(),
          sprintf("GO_%s_%s_dotplot", ont, nm), outdir, 120, 130), silent = TRUE)
    try(save_plot(barplot(ego_s, showCategory = CFG$TOP_N_TERMS) +
          ggtitle(sprintf("GO:%s %s", ont, nm)) + theme_pub(),
          sprintf("GO_%s_%s_barplot", ont, nm), outdir, 120, 130), silent = TRUE)
    ## emap / cnet / heatplot (guarded)
    egx <- tryCatch(enrichplot::pairwise_termsim(ego_s), error = function(e) ego_s)
    try(save_plot(enrichplot::emapplot(egx, showCategory = min(20, nrow(dfs))),
          sprintf("GO_%s_%s_emapplot", ont, nm), outdir, 140, 130), silent = TRUE)
    fc <- res$log2FC_apeglm; names(fc) <- res$symbol
    try(save_plot(enrichplot::cnetplot(ego_s, showCategory = 8, foldChange = fc),
          sprintf("GO_%s_%s_cnetplot", ont, nm), outdir, 150, 140), silent = TRUE)
    try(save_plot(enrichplot::heatplot(ego_s, showCategory = 12, foldChange = fc),
          sprintf("GO_%s_%s_heatplot", ont, nm), outdir, 170, 110), silent = TRUE)
    saveRDS(ego_s, P("16_R_objects", sprintf("GO_%s_%s.rds", ont, nm)))
    say("GO %s %s: %d terms (%d after simplify).", ont, nm, nrow(df), nrow(dfs))
  }
}
for (ont in c("BP","CC","MF")) run_go(ont)
say("08 done. GO ORA (BP/CC/MF; up/down/all) saved with simplify() de-duplication.")
