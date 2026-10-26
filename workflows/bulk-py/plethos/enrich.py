"""enrich – GO over-representation and GSEA prerank.

Replaces `workflows/bulk-r/08_GO_ORA.R` (clusterProfiler::enrichGO +
org.Mm.eg.db + simplify()) and the fgseaMultilevel calls of 09_GSEA.R.
Computation is gseapy (enrich / prerank, the same Fisher / permutation
machinery); this module adds the thin logic the R scripts had around it:
universe building, the exploratory fallback, de-duplication of identical gene
sets (gseapy has no simplify()), ranking construction and leading-edge
handling.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def ora_universe(res: pd.DataFrame) -> list[str]:
    """Background symbols = all tested genes (non-NA p-value, non-NA symbol).
    Replaces the `universe` of 08_GO_ORA.R."""
    return sorted(set(res.symbol[res.pvalue.notna()].dropna().astype(str)))


def pick_flag(res: pd.DataFrame, min_fdr_degs: int = 15) -> tuple[str, bool]:
    """Choose the direction column for ORA: FDR if enough DEGs, else exploratory.
    Returns (flag, used_exploratory). Replaces the `< 15` fallback in 08_GO_ORA.R."""
    use_expl = int(res.sig_FDR.sum()) < min_fdr_degs
    return ("direction_expl" if use_expl else "direction_FDR"), use_expl


def ora(gene_list: list[str], gene_sets: dict[str, list[str]], universe: list[str],
        qval_cut: float = 0.05) -> pd.DataFrame:
    """Fisher over-representation of a gene list against a gene-set library.

    Replaces `clusterProfiler::enrichGO(..., universe = ...)` in 08_GO_ORA.R,
    run through gseapy.enrich. Columns follow gseapy (Term, Overlap, Genes,
    Adjusted P-value, ...). Terms above qval_cut are dropped; identical gene
    sets are NOT collapsed (gseapy has no simplify equivalent – the caller may
    de-duplicate by the Genes column as the pipeline does).
    """
    import gseapy as gp
    if len(gene_list) < 10:
        return pd.DataFrame()
    enr = gp.enrich(gene_list=gene_list, gene_sets=gene_sets, background=universe,
                    outdir=None, verbose=False).results
    if not isinstance(enr, pd.DataFrame) or enr.empty:
        return pd.DataFrame()
    enr = enr[enr["Adjusted P-value"] < qval_cut]
    return enr.reset_index(drop=True)


def ora_sets(res: pd.DataFrame, flag: str) -> dict[str, list[str]]:
    """The up/down/all gene lists for ORA from a direction column.
    Replaces the `sets` list in 08_GO_ORA.R."""
    return {"up_in_T": res.symbol[res[flag] == "up_in_T"],
            "down_in_T": res.symbol[res[flag] == "down_in_T"],
            "all_sig": res.symbol[res[flag] != "ns"]}


def simplify_by_genes(enr: pd.DataFrame, top_n: int = 15) -> pd.DataFrame:
    """Keep the most significant term per identical gene set (the pipeline's
    stand-in for clusterProfiler::simplify(), which gseapy lacks)."""
    return enr.sort_values("Adjusted P-value").drop_duplicates(subset="Genes").head(top_n)


def gsea_rank(res: pd.DataFrame, kind: str) -> pd.Series:
    """A ranked gene list for GSEA, sorted descending.

    Replaces the `mk_rank` helper of 09_GSEA.R: "wald" ranks by the Wald
    statistic (primary), "log2FC" and "signed_p" are sensitivity rankings.
    Non-finite values and NA symbols are dropped; symbols de-duplicated.
    """
    if kind == "wald":
        v = res.stat_Wald
    elif kind == "log2FC":
        v = res.log2FC_MLE
    elif kind == "signed_p":
        v = np.sign(res.log2FC_MLE) * -np.log10(res.pvalue)
    else:
        raise ValueError(f"unknown ranking {kind!r} (wald | log2FC | signed_p)")
    r = pd.Series(np.asarray(v, float), index=res.symbol.astype(str).values)
    r = r[np.isfinite(r) & r.index.notna()]
    return r[~r.index.duplicated()].sort_values(ascending=False)


def prerank(rnk: pd.Series, gene_sets: dict[str, list[str]], min_size: int = 10,
            max_size: int = 500, permutations: int = 1000, seed: int = 1234,
            n_cpus: int = 4) -> pd.DataFrame:
    """GSEA prerank on a pre-ranked gene list.

    Replaces `fgseaMultilevel` in 09_GSEA.R, run through gseapy.prerank with
    explicit permutations (fgsea's multilevel has none – that is the main
    numerical difference, p-values are permutation-based not analytic).
    Returns the tidy frame: pathway, pval, padj, ES, NES, size, leadingEdge.
    """
    import gseapy as gp
    pr = gp.prerank(rnk=rnk, gene_sets=gene_sets, min_size=min_size, max_size=max_size,
                    permutation_num=permutations, seed=seed, threads=n_cpus,
                    outdir=None, verbose=False).res2d
    if pr is None or pr.empty:
        return pd.DataFrame()
    fg = pd.DataFrame({"pathway": pr.Term, "pval": pr["NOM p-val"].astype(float),
                       "padj": pr["FDR q-val"].astype(float), "ES": pr.ES.astype(float),
                       "NES": pr.NES.astype(float),
                       "size": pr["Tag %"].astype(str).str.split("/").str[1].astype(int),
                       "leadingEdge": pr.Lead_genes.astype(str)})
    return fg


def leading_edge_genes(fg: pd.DataFrame) -> list[str]:
    """Split gseapy's semicolon-joined leadingEdge into one gene per row
    (09_GSEA.R wrote the collapsed form; the leading-edge table keeps one row
    per gene, per R1's PNG map)."""
    if fg.empty:
        return []
    return [g for g in str(fg.sort_values("padj").iloc[0].leadingEdge).split(";") if g]
