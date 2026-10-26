## ============================================================================
## utils.R  —  reusable helpers (loaded by every numbered script)
## ============================================================================
suppressPackageStartupMessages({
  library(ggplot2)
})

## ---- progress / checks ----------------------------------------------------
say  <- function(...) message(sprintf("[%s] %s", format(Sys.time(), "%H:%M:%S"), sprintf(...)))
need_file <- function(path) if (!file.exists(path)) stop("Missing file: ", path, call. = FALSE)
need_pkg  <- function(pkgs) {
  miss <- pkgs[!vapply(pkgs, requireNamespace, logical(1), quietly = TRUE)]
  if (length(miss)) stop("Missing packages: ", paste(miss, collapse = ", "),
                         "\n  -> run scripts/00_install_packages.R first.", call. = FALSE)
}

## ---- RDS cache ------------------------------------------------------------
save_rds <- function(obj, name) { saveRDS(obj, P("16_R_objects", paste0(name, ".rds"))); invisible(obj) }
load_rds <- function(name) { f <- P("16_R_objects", paste0(name, ".rds")); need_file(f); readRDS(f) }

## ---- publication theme ----------------------------------------------------
theme_pub <- function(base = CFG$BASE_PT) {
  theme_classic(base_size = base) +
    theme(text = element_text(colour = "black"),
          axis.text = element_text(colour = "black"),
          axis.ticks = element_line(colour = "black", linewidth = .3),
          axis.line  = element_line(colour = "black", linewidth = .3),
          plot.title = element_text(size = base + 1, hjust = 0, face = "plain"),
          strip.background = element_blank(),
          strip.text = element_text(size = base),
          legend.key.size = unit(3.5, "mm"),
          legend.background = element_blank())
}

## ---- save a plot in PDF + PNG + SVG ---------------------------------------
## dims in mm. `dir` is a project-relative folder.
save_plot <- function(g, name, dir, w = 90, h = 80) {
  base <- file.path(dir, name)
  ok <- function(expr) tryCatch({expr; TRUE}, error = function(e){ warning(e$message); FALSE })
  ok(ggplot2::ggsave(P(paste0(base, ".pdf")), g, device = grDevices::cairo_pdf,
                     width = w/25.4, height = h/25.4, units = "in", limitsize = FALSE))
  ok(ggplot2::ggsave(P(paste0(base, ".png")), g, width = w/25.4, height = h/25.4,
                     units = "in", dpi = 600, limitsize = FALSE))
  ok(ggplot2::ggsave(P(paste0(base, ".svg")), g, width = w/25.4, height = h/25.4,
                     units = "in", limitsize = FALSE))
  invisible(g)
}

## save a base/grid graphic (ComplexHeatmap etc.) to PDF+PNG.
## Robust: any drawing error becomes a warning (never halts), device always closed.
save_grid <- function(draw_fn, name, dir, w = 120, h = 110) {
  base <- file.path(dir, name)
  one <- function(open_dev) {
    open_dev()
    on.exit(try(grDevices::dev.off(), silent = TRUE), add = TRUE)
    tryCatch(draw_fn(), error = function(e) warning("save_grid '", name, "' failed: ", conditionMessage(e)))
  }
  one(function() grDevices::cairo_pdf(P(paste0(base, ".pdf")), width = w/25.4, height = h/25.4))
  one(function() grDevices::png(P(paste0(base, ".png")), width = w/25.4, height = h/25.4, units = "in", res = 600))
}

## drop rows that are all-NA or have (near) zero variance — keeps pheatmap clustering valid
clean_rows <- function(m) {
  m <- as.matrix(m)
  ok <- apply(m, 1, function(r) { r <- r[is.finite(r)]; length(r) >= 2 && stats::sd(r) > 1e-9 })
  m[ok, , drop = FALSE]
}

## ---- tables in CSV + XLSX (full precision; no premature rounding) ----------
## XLSX is skipped when the absolute path exceeds the Windows long-path limit
## (writexl's C backend fails on >~260-char paths). CSV always written.
.warned_xlsx <- new.env()
save_table <- function(df, name, dir) {
  utils::write.csv(df, P(dir, paste0(name, ".csv")), row.names = FALSE)
  xlsx <- P(dir, paste0(name, ".xlsx"))
  if (nchar(xlsx) > 250) {
    if (is.null(.warned_xlsx$done)) {
      say("XLSX skipped: project path too long for the Windows xlsx writer (>250 chars). CSVs are complete. Move the project to a shorter path (e.g. C:/DG_bulk_RNAseq) to also get .xlsx.")
      .warned_xlsx$done <- TRUE
    }
    return(invisible(df))
  }
  if (requireNamespace("writexl", quietly = TRUE))
    try(writexl::write_xlsx(as.data.frame(df), xlsx), silent = TRUE)
  invisible(df)
}

## ---- z-score rows (genes) -------------------------------------------------
row_z <- function(m) { z <- t(scale(t(as.matrix(m)))); z[!is.finite(z)] <- NA; z }

## ---- individual-point layer: ggbeeswarm if available, else geom_jitter ----
pts_layer <- function(...) {
  args <- list(...)
  if (requireNamespace("ggbeeswarm", quietly = TRUE)) {
    do.call(ggbeeswarm::geom_beeswarm, args)
  } else {
    args$cex <- NULL; args$dodge.width <- NULL
    if (is.null(args$width))  args$width  <- 0.15
    if (is.null(args$height)) args$height <- 0
    do.call(ggplot2::geom_jitter, args)
  }
}

## ---- tidy MSigDB / GO pathway labels --------------------------------------
pretty_pw <- function(x) {
  x <- sub("^(GOBP|GOCC|GOMF|HALLMARK|REACTOME|WP|KEGG)_", "", x)
  x <- tolower(gsub("_", " ", x))
  x <- gsub("\\bgaba\\b","GABA",x); x <- gsub("\\bnmda\\b","NMDA",x); x <- gsub("\\bampa\\b","AMPA",x)
  x <- gsub("\\bltp\\b","LTP",x);   x <- gsub("\\btnf\\b","TNF",x);   x <- gsub("\\bil(\\d+)\\b","IL-\\1",x)
  sub("^(\\s*)([[:alpha:]])","\\1\\U\\2", x, perl = TRUE)
}

## ---- read the Novogene count matrix (robust) ------------------------------
## Returns list(counts = integer matrix [genes x samples], annot = data.frame, id = vector)
read_counts <- function() {
  need_file(CFG$COUNTS_FILE)
  raw <- utils::read.delim(CFG$COUNTS_FILE, sep = CFG$SEP, check.names = FALSE,
                           stringsAsFactors = FALSE)
  if (!CFG$GENE_ID_COL %in% colnames(raw)) colnames(raw)[1] <- CFG$GENE_ID_COL
  ids <- sub("\\.[0-9]+$", "", as.character(raw[[CFG$GENE_ID_COL]]))  # strip Ensembl version
  annot_cols <- intersect(CFG$ANNOT_COLS, colnames(raw))
  samp_cols  <- setdiff(colnames(raw), c(CFG$GENE_ID_COL, annot_cols))
  ## keep only strictly numeric sample columns
  is_num <- vapply(raw[samp_cols], function(x) is.numeric(x) || all(!is.na(suppressWarnings(as.numeric(x)))), logical(1))
  samp_cols <- samp_cols[is_num]
  m <- as.matrix(vapply(raw[samp_cols], function(x) as.numeric(as.character(x)), numeric(nrow(raw))))
  rownames(m) <- make.unique(ids)
  m[is.na(m)] <- 0
  annot <- data.frame(gene_id = ids,
                      symbol  = if (CFG$SYMBOL_COL %in% colnames(raw)) as.character(raw[[CFG$SYMBOL_COL]]) else NA,
                      biotype = if (CFG$BIOTYPE_COL %in% colnames(raw)) as.character(raw[[CFG$BIOTYPE_COL]]) else NA,
                      stringsAsFactors = FALSE)
  rownames(annot) <- rownames(m)
  list(counts = m, annot = annot, samples = samp_cols)
}

## Ensembl -> SYMBOL fallback via org.Mm.eg.db (only for IDs missing a symbol)
map_symbols <- function(ids, provided = NULL) {
  sym <- if (!is.null(provided)) provided else rep(NA_character_, length(ids))
  need <- is.na(sym) | sym == "" | sym == "-"
  if (any(need) && requireNamespace("org.Mm.eg.db", quietly = TRUE) &&
      requireNamespace("AnnotationDbi", quietly = TRUE)) {
    mapped <- suppressMessages(AnnotationDbi::mapIds(org.Mm.eg.db::org.Mm.eg.db,
                keys = ids[need], column = "SYMBOL", keytype = "ENSEMBL", multiVals = "first"))
    sym[need] <- mapped
  }
  sym[is.na(sym) | sym == "" | sym == "-"] <- ids[is.na(sym) | sym == "" | sym == "-"]
  sym
}

## ---- signature score: mean of per-gene z-scores (default) -----------------
sig_score_meanz <- function(z, genes, sym) {
  idx <- which(tolower(sym) %in% tolower(genes))
  if (length(idx) < 2) return(rep(NA_real_, ncol(z)))
  colMeans(z[idx, , drop = FALSE], na.rm = TRUE)
}
