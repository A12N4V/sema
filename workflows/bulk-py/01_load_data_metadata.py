# ============================================================================
# 01_load_data_metadata.py – Load Novogene counts + metadata; auto-detect format; sanity checks.
# Thin wrapper: the logic lives in plethos.io.
# Inputs : 00_input/gene_count.xls , 01_metadata/metadata.csv
# Outputs: 16_objects/{counts,annot,meta,covar_avail}.pkl ; 01_metadata/input_files_used.txt
# ============================================================================
from utils import *
from plethos import io as pio

need_file(CFG.COUNTS_FILE); need_file(CFG.META_FILE)

counts, annot, _ = pio.read_counts(CFG.COUNTS_FILE, sep=CFG.SEP, gene_id_col=CFG.GENE_ID_COL,
                                   symbol_col=CFG.SYMBOL_COL, biotype_col=CFG.BIOTYPE_COL,
                                   annot_cols=CFG.ANNOT_COLS)
say("Counts loaded: %d genes x %d samples", *counts.shape)

ex = str(counts.index[0])
id_type = "Ensembl (mouse)" if ex.startswith("ENSMUS") else "Entrez (numeric)" if ex.isdigit() else "Symbol/other"
say("Gene ID column: '%s' | detected ID type: %s | Ensembl version suffix stripped", CFG.GENE_ID_COL, id_type)

ok, frac_int = pio.check_raw_counts(counts)
if not ok:
    raise SystemExit(f"Count matrix does not look like raw integer counts (fraction integer = {frac_int:.3f}). "
                     "Do NOT run DESeq2 on TPM/FPKM/normalized data.")
say("Raw-count check passed (fraction integer = %.4f). Not TPM/FPKM.", frac_int)

annot["symbol"] = pio.map_symbols(annot["gene_id"], annot["symbol"])
n_sym = int((annot.symbol != annot.gene_id).sum())
say("Symbols resolved for %d / %d genes (%.1f%%).", n_sym, len(annot), 100 * n_sym / len(annot))

meta = pd.read_csv(CFG.META_FILE)
try:
    meta = pio.load_metadata(meta, list(counts.columns), CFG.GROUP_COL, CFG.GROUP_REF, CFG.GROUP_TEST)
except ValueError as e:
    raise SystemExit(str(e))

if CFG.EXCLUDE:
    counts = counts[[c for c in counts.columns if c not in CFG.EXCLUDE]]
    meta = meta.loc[counts.columns]
    say("MAIN analysis excludes: %s", ", ".join(CFG.EXCLUDE))
say("Samples per group: %s", "  ".join(f"{k}={v}" for k, v in meta[CFG.GROUP_COL].value_counts(sort=False).items()))

covar_avail = pio.informative_covariates(meta, CFG.GROUP_COL)
say("Covariates present & informative: %s", ", ".join(covar_avail) or "none (single-level or empty)")

P("01_metadata", "input_files_used.txt").write_text("\n".join([
    f"run_date: {time.ctime()}", f"counts_file: {CFG.COUNTS_FILE}", f"meta_file: {CFG.META_FILE}",
    f"contrast: {CFG.GROUP_TEST} vs {CFG.GROUP_REF}", f"n_samples: {counts.shape[1]}", f"id_type: {id_type}",
    f"main_analysis_excluded: {','.join(CFG.EXCLUDE) or 'none'}",
    f"informative_covariates: {','.join(covar_avail) or 'none'}"]) + "\n")

save_obj(counts, "counts"); save_obj(annot, "annot"); save_obj(meta, "meta"); save_obj(covar_avail, "covar_avail")
say("01 done. Objects saved to 16_objects/.")
