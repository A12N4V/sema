# ============================================================================
# 08_GO_ORA.py – GO over-representation (BP/CC/MF) for up / down / all sig.
# Thin wrapper: the Fisher test lives in plethos.enrich (gseapy.enrich under
# the hood). No dotplots – the live enrichment view renders the table
# (PNG map: GO dotplot/barplot family). Background = all tested genes.
# Gene sets: Enrichr GO 2023 mouse libraries, downloaded once and cached.
# (R used clusterProfiler::enrichGO + org.Mm.eg.db and simplify(); gseapy has
# no simplify, so terms are de-duplicated by identical gene sets only.)
# Outputs: 09_GO_ORA/{BP,CC,MF}/*
# ============================================================================
from utils import *
from plethos import enrich as pen

res = load_obj("res")
universe = pen.ora_universe(res)

flag, use_expl = pen.pick_flag(res)
if use_expl:
    say("Few FDR DEGs (<15): GO uses exploratory p<%.2f gene set (flagged as exploratory).", CFG.P_NOMINAL)
sets = pen.ora_sets(res, flag)

for ont in ("BP", "CC", "MF"):
    gs = gene_sets(f"GO_{ont}")
    if not gs:
        say("GO %s skipped: gene sets unavailable offline.", ont)
        continue
    outdir = f"09_GO_ORA/{ont}"
    for nm, genes in sets.items():
        genes = sorted(set(genes.dropna().astype(str)) & set(universe))
        if len(genes) < 10:
            say("GO %s %s: <10 mapped genes, skipped.", ont, nm); continue
        enr = pen.ora(genes, gs, universe, CFG.GO_QVAL)
        if enr.empty:
            say("GO %s %s: no enriched terms.", ont, nm); continue
        simp = pen.simplify_by_genes(enr, CFG.TOP_N_TERMS)
        save_table(enr, f"GO_{ont}_{nm}_complete", outdir)
        save_table(simp, f"GO_{ont}_{nm}_top{CFG.TOP_N_TERMS}_simplified", outdir)
        say("GO %s %s: %d terms (%d after de-duplication).", ont, nm, len(enr), len(simp))
say("08 done. GO ORA (BP/CC/MF; up/down/all) saved as tables.")
