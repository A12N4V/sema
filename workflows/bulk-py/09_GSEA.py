# ============================================================================
# 09_GSEA.py – GSEA on ALL tested genes (no pre-filter).
# Ranking: Wald stat (primary); log2FC & signed -log10(p) (sensitivity).
# Collections: Hallmark, GO:BP, Reactome (MSigDB mouse) + custom DG/axes sets.
# Thin wrapper: prerank lives in plethos.enrich (gseapy prerank replaces
# fgseaMultilevel). No bar/dot plots – the live enrichment views draw from
# GSEA_all_collections_wald_and_sensitivity.csv and the leading-edge table
# (PNG map: GSEA family).
# Outputs: 10_GSEA/*, 11_pathway_visualization/
# ============================================================================
from utils import *
from plethos import common as pcommon
from plethos import enrich as pen

res = load_obj("res"); GS, PV = "10_GSEA", "11_pathway_visualization"

ranks = {rn: pen.gsea_rank(res, rn) for rn in ("wald", "log2FC", "signed_p")}
save_obj(ranks, "gsea_ranks")

collections = {"Hallmark": gene_sets("Hallmark"), "GO_BP": gene_sets("MSIG_GO_BP"), "Reactome": gene_sets("Reactome")}
custom = {}
try:
    ax_ = read_signatures("targeted_axes_signatures.csv"); ct = read_signatures("DG_cell_type_signatures.csv")
    custom |= {f"AXIS_{a}__{s}": g.gene.tolist() for (a, s), g in ax_.groupby(["axis", "subaxis"])}
    custom |= {f"DGTYPE_{s}": g.gene.tolist() for s, g in ct.groupby("signature")}
    custom = {k: v for k, v in custom.items() if len(set(v)) >= 5}
except FileNotFoundError as exc:
    say("Custom DG/axes collection skipped: %s", exc)
collections["Custom_DG_axes"] = custom or None
write_note("KEGG GSEA not run offline. Use gseapy.prerank with a KEGG mouse GMT when licence/network allow.\n",
           "README_KEGG.txt", GS)

all_res = {}
for cn, gs in collections.items():
    if not gs:
        say("Collection %s unavailable, skipped.", cn); continue
    for rn, rk in ranks.items():
        try:
            fg = pen.prerank(rk, gs, CFG.GSEA_MINSIZE, CFG.GSEA_MAXSIZE, CFG.GSEA_PERMUTATIONS,
                             CFG.SEED, CFG.N_CPUS)
        except Exception as exc:
            say("GSEA %s/%s failed: %s", cn, rn, exc); continue
        if fg.empty:
            continue
        fg["collection"] = cn; fg["ranking"] = rn
        all_res[f"{cn}_{rn}"] = fg
        save_table(fg.sort_values("padj"), f"GSEA_{cn}_{rn}", GS)

if all_res:
    comb = pd.concat(all_res.values(), ignore_index=True)
    save_table(comb.drop(columns="leadingEdge").sort_values("padj"),
               "GSEA_all_collections_wald_and_sensitivity", GS)
    # Leading-edge genes of the best Wald pathway: one row per gene (R1's PNG
    # map asked for the un-collapsed form), plus a VST-z expression table.
    best = comb[comb.ranking == "wald"].sort_values("padj").head(1)
    if len(best):
        b = best.iloc[0]
        le = [g for g in str(b.leadingEdge).split(";") if g]
        save_table(pd.DataFrame({"pathway": b.pathway, "leadingEdge_gene": le}),
                   "GSEA_leadingEdge_topPathway_genes", GS)
        vstm = load_obj("vst"); meta = load_obj("meta"); annot = load_obj("annot")
        sym = annot.loc[vstm.index, "symbol"].astype(str)
        ids = vstm.index[sym.str.lower().isin({g.lower() for g in le})]
        if len(ids) >= 3:
            zz = pcommon.row_z(vstm).loc[ids]
            zz.index = sym.loc[ids].values
            zz = zz[~zz.index.duplicated()].dropna(how="all")
            zz.index.name = "symbol"
            long = zz.reset_index().melt(id_vars="symbol", var_name="sample", value_name="vst_z")
            long = long.merge(meta[CFG.GROUP_COL].astype(str).rename("group")
                              .rename_axis("sample").reset_index(), on="sample")
            long["pathway"] = b.pathway
            save_table(long.dropna(subset=["vst_z"]), "GSEA_leadingEdge_topPathway_expression", PV)
say("09 done. GSEA (Wald primary; log2FC & signed-p sensitivity) over Hallmark/GO:BP/Reactome/custom. No plots.")
