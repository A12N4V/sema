## ============================================================================
## 02_QC_filtering.R  —  raw-count QC + expression filter
## Outputs: 02_quality_control/*  ; 16_R_objects/{counts_filt,qc_tab}.rds
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("ggplot2","matrixStats"))
library(ggplot2)

counts <- load_rds("counts"); meta <- load_rds("meta"); annot <- load_rds("annot")
grp <- meta[[CFG$GROUP_COL]]; pal <- CFG$PAL
QC <- "02_quality_control"
ord <- colnames(counts)  # fixed sample order reused everywhere

## ---- per-sample QC table --------------------------------------------------
qc <- data.frame(
  sample       = ord,
  group        = grp,
  library_size = colSums(counts),
  genes_detected = colSums(counts > 0),
  pct_zero     = 100 * colMeans(counts == 0),
  median_nonzero = apply(counts, 2, function(x) stats::median(x[x>0]))
)
save_table(qc, "QC_per_sample_summary", QC)

barp <- function(y, ylab, name) {
  g <- ggplot(qc, aes(factor(sample, levels=ord), .data[[y]], fill = group)) +
    geom_col(width=.7) + scale_fill_manual(values = pal) +
    labs(x = NULL, y = ylab) + theme_pub() + theme(axis.text.x = element_text(angle=90, vjust=.5))
  save_plot(g, name, QC, w = 90, h = 65)
}
barp("library_size",   "Library size (total counts)", "QC_library_size")
barp("genes_detected", "Genes detected (>0)",         "QC_genes_detected")
barp("pct_zero",       "% genes with zero counts",     "QC_percent_zero")

## ---- raw-count distribution (boxplot, log10) ------------------------------
long <- data.frame(sample = rep(ord, each = nrow(counts)),
                   group  = rep(grp, each = nrow(counts)),
                   value  = as.vector(log10(counts + 1)))
gbox <- ggplot(long, aes(factor(sample, levels=ord), value, fill = group)) +
  geom_boxplot(outlier.size = .2, linewidth = .3) + scale_fill_manual(values = pal) +
  labs(x = NULL, y = "log10(raw count + 1)") + theme_pub() +
  theme(axis.text.x = element_text(angle=90, vjust=.5))
save_plot(gbox, "QC_raw_count_boxplot", QC, w = 95, h = 65)

## density before normalization (per sample)
dens_df <- do.call(rbind, lapply(ord, function(s){
  x <- log10(counts[,s] + 1); x <- x[is.finite(x)]
  data.frame(sample = s, group = meta[s, CFG$GROUP_COL], x = x)}))
gden <- ggplot(dens_df, aes(x, colour = sample)) + geom_density(linewidth=.3) +
  labs(x = "log10(raw count + 1)", y = "density", title = "Before normalization") +
  theme_pub() + theme(legend.position = "right", legend.text = element_text(size=6))
save_plot(gden, "QC_density_raw", QC, w = 100, h = 70)

## ---- expression filter ----------------------------------------------------
keep <- rowSums(counts >= CFG$FILTER_MIN) >= CFG$FILTER_FRAC * ncol(counts)
counts_filt <- round(counts[keep, , drop = FALSE])
say("Filter: >=%d counts in >=%.0f%% samples -> %d / %d genes kept (%.1f%%).",
    CFG$FILTER_MIN, 100*CFG$FILTER_FRAC, sum(keep), length(keep), 100*mean(keep))

## optional protein-coding restriction (kept OFF by default for DE; used in enrichment)
if (isTRUE(CFG$PROTEIN_CODING_ONLY) && !all(is.na(annot$biotype))) {
  pc <- rownames(counts_filt)[annot[rownames(counts_filt), "biotype"] %in% "protein_coding"]
  counts_filt <- counts_filt[pc, , drop = FALSE]
  say("Protein-coding restriction ON -> %d genes.", nrow(counts_filt))
}

writeLines(c(sprintf("genes_input: %d", nrow(counts)),
             sprintf("genes_kept: %d", nrow(counts_filt)),
             sprintf("filter: >=%d in >=%.0f%% samples", CFG$FILTER_MIN, 100*CFG$FILTER_FRAC)),
           P(QC, "QC_filter_summary.txt"))
save_rds(counts_filt, "counts_filt"); save_rds(qc, "qc_tab")
say("02 done. QC + filtered matrix saved.")
