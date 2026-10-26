## ============================================================================
## 00_install_packages.R  —  run ONCE. Idempotent (skips already-installed pkgs).
## ============================================================================
options(repos = c(CRAN = "https://cloud.r-project.org"))

cran <- c("ggplot2","ggrepel","patchwork","matrixStats","pheatmap","RColorBrewer",
          "viridis","writexl","ggbeeswarm","ggdist","UpSetR","dplyr","tibble",
          "tidyr","scales","svglite","msigdbr")
bioc <- c("DESeq2","apeglm","fgsea","clusterProfiler","enrichplot","org.Mm.eg.db",
          "AnnotationDbi","ComplexHeatmap","GSVA","singscore","DOSE")

inst <- rownames(installed.packages())
newcran <- setdiff(cran, inst)
if (length(newcran)) install.packages(newcran)

if (!requireNamespace("BiocManager", quietly = TRUE)) install.packages("BiocManager")
newbioc <- setdiff(bioc, rownames(installed.packages()))
if (length(newbioc)) BiocManager::install(newbioc, update = FALSE, ask = FALSE)

## report
missing <- setdiff(c(cran, bioc), rownames(installed.packages()))
if (length(missing)) warning("Still missing: ", paste(missing, collapse = ", "))
message("Package check complete. Missing: ", if (length(missing)) paste(missing, collapse=", ") else "none")
## Note: KEGG via clusterProfiler::gseKEGG needs internet at run-time (KEGG REST API).
## GSVA/singscore are optional (used only for signature-score sensitivity analysis).
