# ============================================================================
# config.py – central configuration (edit here, then run run_all.py)
# DG bulk RNA-seq · contrast T vs V. Python port of config.R; same names, same defaults.
# ============================================================================
# Everything downstream reads from this file. Change paths/params ONLY here.
from pathlib import Path
import os

PROJ_ROOT = Path(os.environ.get("PROJ_ROOT", Path(__file__).resolve().parent.parent))

# ---- Input files
COUNTS_FILE = PROJ_ROOT / "00_input" / "gene_count.xls"   # Novogene matrix
META_FILE = PROJ_ROOT / "01_metadata" / "metadata.csv"     # sample,group[,covars]
SEP = "\t"                  # "\t" for Novogene .xls; "," for a plain CSV
GENE_ID_COL = "gene_id"     # 1st/ID column (Ensembl gene IDs)
SYMBOL_COL = "gene_name"    # symbol column IN the Novogene file (if present)
BIOTYPE_COL = "gene_biotype"  # optional; used for QC summaries
ANNOT_COLS = ["gene_name", "gene_chr", "gene_start", "gene_end", "gene_strand",
              "gene_length", "gene_biotype", "gene_description", "tf_family"]

# ---- Design
SPECIES = "mouse"
GROUP_COL = "group"
GROUP_REF = "V"             # reference (denominator): control
GROUP_TEST = "T"            # test (numerator): experimental. log2FC>0 = up in T
COVARS = []                 # e.g. ["sex","batch"]; must exist in metadata & be complete
EXCLUDE = ["T4"]            # main analysis excludes T4
SENSITIVITY_EXCLUDE = ["T4"]  # sample(s) examined ONLY in the with/without sensitivity run

# ---- Filtering
FILTER_MIN = 10             # min counts ...
FILTER_FRAC = 0.5           # ... in >= this fraction of samples
PROTEIN_CODING_ONLY = False  # set True to restrict to protein_coding for enrichment

# ---- Statistical criteria
FDR = 0.05                  # padj threshold (primary DEG)
LFC_MIN = 0.30              # |log2FC| threshold (primary + exploratory)
P_NOMINAL = 0.05            # nominal p threshold (exploratory only)

# ---- Enrichment
GO_QVAL = 0.05
GSEA_MINSIZE = 10
GSEA_MAXSIZE = 500
GSEA_FDR = 0.05
TOP_N_TERMS = 15
GSEA_PERMUTATIONS = 1000    # gseapy prerank permutations (fgsea multilevel has none)

# ---- Reproducibility
SEED = 1234
N_CPUS = 4

# ---- Aesthetics
PALETTE = "green"           # active palette ("green" or "orange")
FIG_THEME = "dark"          # "dark" = the workbench's black ground; "paper" = white, for print
BASE_PT = 8                 # base font size (pt) for figures

# ---- Gene-set cache (downloaded once, reused offline)
GENESET_CACHE = Path(os.environ.get("HODOS_GENESETS", PROJ_ROOT / "signatures" / "genesets"))
