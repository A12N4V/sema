## ============================================================================
## 03_DESeq2_normalization.R  —  DESeq2 fit + VST/normalized expression
## Outputs: 03_normalized_expression/* ; 16_R_objects/{dds,vsd,norm,vst}.rds
## ============================================================================
if (!exists("CFG")) source("scripts/config.R")
if (!exists("say")) source("scripts/utils.R")
need_pkg(c("DESeq2","ggplot2"))
suppressPackageStartupMessages(library(DESeq2)); library(ggplot2)

counts_filt <- load_rds("counts_filt"); meta <- load_rds("meta")
NE <- "03_normalized_expression"

## design: covariates (if any complete) + group
covars <- CFG$COVARS[CFG$COVARS %in% colnames(meta)]
covars <- covars[vapply(covars, function(c) !any(is.na(meta[[c]])) && length(unique(meta[[c]]))>1, logical(1))]
design <- stats::as.formula(paste("~", paste(c(covars, CFG$GROUP_COL), collapse = " + ")))
say("DESeq2 design: %s", deparse(design))

dds <- DESeqDataSetFromMatrix(countData = counts_filt, colData = meta, design = design)
dds <- DESeq(dds)                       # size factors, dispersions, Wald
vsd <- vst(dds, blind = TRUE)           # variance-stabilizing transform (blind for QC/PCA)
norm <- counts(dds, normalized = TRUE)  # median-of-ratios normalized counts
vstm <- assay(vsd)

## save expression matrices (full precision)
save_table(data.frame(gene_id = rownames(norm), norm, check.names = FALSE),
           "normalized_counts", NE)
save_table(data.frame(gene_id = rownames(vstm), vstm, check.names = FALSE),
           "VST_expression", NE)

## size factors
sf <- data.frame(sample = colnames(dds), size_factor = sizeFactors(dds),
                 group = meta[[CFG$GROUP_COL]])
save_table(sf, "size_factors", NE)

## density AFTER normalization (VST) + boxplot
ord <- colnames(vstm)
dens <- do.call(rbind, lapply(ord, function(s)
  data.frame(sample = s, group = meta[s, CFG$GROUP_COL], x = vstm[,s])))
gd <- ggplot(dens, aes(x, colour = sample)) + geom_density(linewidth=.3) +
  labs(x = "VST expression", y = "density", title = "After normalization (VST)") +
  theme_pub() + theme(legend.position="right", legend.text = element_text(size=6))
save_plot(gd, "VST_density", NE, w = 100, h = 70)

gb <- ggplot(dens, aes(factor(sample, levels=ord), x, fill = group)) +
  geom_boxplot(outlier.size=.2, linewidth=.3) + scale_fill_manual(values = CFG$PAL) +
  labs(x = NULL, y = "VST expression") + theme_pub() +
  theme(axis.text.x = element_text(angle=90, vjust=.5))
save_plot(gb, "VST_boxplot", NE, w = 95, h = 65)

## dispersion plot (base graphics)
save_grid(function() DESeq2::plotDispEsts(dds), "dispersion_estimates", NE, w = 100, h = 90)

save_rds(dds, "dds"); save_rds(vsd, "vsd"); save_rds(norm, "norm"); save_rds(vstm, "vst")
say("03 done. DESeq2 fit + VST saved. Design: %s", deparse(design))
