## ============================================================================
## 01_load_data_metadata.R
## Load Novogene counts + metadata; auto-detect format; sanity checks.
## Inputs : 00_input/gene_count.xls , 01_metadata/metadata.csv
## Outputs: 16_R_objects/{counts,annot,meta}.rds ; 01_metadata/input_files_used.txt
## ============================================================================
## -- config/utils are loaded by run_all.R; this block lets the script also run
##    standalone from the project root (Rscript scripts/01_load_data_metadata.R) --
if (!exists("CFG"))  source("scripts/config.R")
if (!exists("say"))  source("scripts/utils.R")

need_file(CFG$COUNTS_FILE); need_file(CFG$META_FILE)

## ---- read counts + auto-detect -------------------------------------------
rc <- read_counts()
counts <- rc$counts; annot <- rc$annot
say("Counts loaded: %d genes x %d samples", nrow(counts), ncol(counts))

## ID type detection
id_ex <- rownames(counts)[1]
id_type <- if (grepl("^ENSMUS", id_ex)) "Ensembl (mouse)" else
           if (grepl("^[0-9]+$", id_ex)) "Entrez (numeric)" else "Symbol/other"
had_version <- any(grepl("\\.[0-9]+$", as.character(rc$annot$gene_id)) == FALSE) # already stripped in read_counts
say("Gene ID column: '%s' | detected ID type: %s | Ensembl version suffix stripped in read_counts()",
    CFG$GENE_ID_COL, id_type)

## integer / raw-count check (DESeq2 requires raw integer counts)
frac_int <- mean(abs(counts - round(counts)) < 1e-8)
looks_norm <- (frac_int < 0.99) || (max(counts) < 50 && any(counts %% 1 != 0))
if (looks_norm) stop("Count matrix does not look like raw integer counts ",
                     "(fraction integer = ", round(frac_int,3), "). ",
                     "Do NOT run DESeq2 on TPM/FPKM/normalized data.", call. = FALSE)
say("Raw-count check passed (fraction integer = %.4f). Not TPM/FPKM.", frac_int)

## symbols (prefer Novogene gene_name; fall back to org.Mm.eg.db)
annot$symbol <- map_symbols(annot$gene_id, annot$symbol)
n_sym <- sum(annot$symbol != annot$gene_id)
say("Symbols resolved for %d / %d genes (%.1f%%).", n_sym, nrow(annot), 100*n_sym/nrow(annot))

## ---- metadata ------------------------------------------------------------
meta <- utils::read.csv(CFG$META_FILE, stringsAsFactors = FALSE)
if (!"sample" %in% colnames(meta)) stop("metadata.csv must contain a 'sample' column.", call.=FALSE)
if (!CFG$GROUP_COL %in% colnames(meta)) stop("metadata.csv must contain a '", CFG$GROUP_COL, "' column.", call.=FALSE)
rownames(meta) <- meta$sample

## sample-name concordance
miss_in_meta   <- setdiff(colnames(counts), meta$sample)
miss_in_counts <- setdiff(meta$sample, colnames(counts))
if (length(miss_in_meta))   stop("Samples in counts but not metadata: ", paste(miss_in_meta, collapse=", "), call.=FALSE)
if (length(miss_in_counts)) stop("Samples in metadata but not counts: ", paste(miss_in_counts, collapse=", "), call.=FALSE)

## optional exclusion for the MAIN analysis (default: none)
if (length(CFG$EXCLUDE)) {
  keepc <- setdiff(colnames(counts), CFG$EXCLUDE)
  counts <- counts[, keepc, drop=FALSE]; say("MAIN analysis excludes: %s", paste(CFG$EXCLUDE, collapse=", "))
}
meta <- meta[colnames(counts), , drop = FALSE]

## factor with reference level
meta[[CFG$GROUP_COL]] <- factor(meta[[CFG$GROUP_COL]], levels = c(CFG$GROUP_REF, CFG$GROUP_TEST))
if (any(is.na(meta[[CFG$GROUP_COL]]))) stop("Group column has values outside {",
      CFG$GROUP_REF, ",", CFG$GROUP_TEST, "}.", call.=FALSE)
say("Samples per group: %s", paste(names(table(meta[[CFG$GROUP_COL]])),
    table(meta[[CFG$GROUP_COL]]), sep="=", collapse="  "))

## available covariates (non-empty, >1 level)
covar_cols <- setdiff(colnames(meta), c("sample", CFG$GROUP_COL))
covar_avail <- covar_cols[vapply(covar_cols, function(c){
  v <- meta[[c]]; v <- v[!is.na(v) & v != "NA" & v != ""]; length(unique(v)) > 1 }, logical(1))]
say("Covariates present & informative: %s", if (length(covar_avail)) paste(covar_avail, collapse=", ") else "none (single-level or empty)")

## ---- provenance ----------------------------------------------------------
prov <- c(
  paste("run_date:", Sys.time()),
  paste("counts_file:", CFG$COUNTS_FILE),
  paste("meta_file:", CFG$META_FILE),
  paste("contrast:", CFG$GROUP_TEST, "vs", CFG$GROUP_REF),
  paste("n_samples:", ncol(counts)),
  paste("id_type:", id_type),
  paste("main_analysis_excluded:", if (length(CFG$EXCLUDE)) paste(CFG$EXCLUDE, collapse=",") else "none"),
  paste("informative_covariates:", if (length(covar_avail)) paste(covar_avail, collapse=",") else "none"))
writeLines(prov, P("01_metadata", "input_files_used.txt"))

save_rds(counts, "counts"); save_rds(annot, "annot"); save_rds(meta, "meta")
save_rds(covar_avail, "covar_avail")
say("01 done. Objects saved to 16_R_objects/.")
