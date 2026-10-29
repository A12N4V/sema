"""Synthetic inputs, so either workflow runs end to end without real data.

These exist to exercise the software. They are not biology, and every run
built on them is labelled `demo` in its ledger.
"""
from __future__ import annotations

import json
from pathlib import Path

import h5py
import numpy as np
import pandas as pd

GO_BP = Path(__file__).resolve().parents[3] / "workflows" / "signatures" / "genesets" / "MSIG_GO_BP.json"

# ---------------------------------------------------------------- bulk

def write_bulk_demo(dest: Path, n_genes: int = 6000, seed: int = 7) -> tuple[Path, Path]:
    """Novogene-style gene_count.xls (tab-separated) + metadata.csv, V1–V5 vs T1–T5."""
    rng = np.random.default_rng(seed)
    dest.mkdir(parents=True, exist_ok=True)
    samples = [f"V{i}" for i in range(1, 6)] + [f"T{i}" for i in range(1, 6)]
    base = rng.lognormal(mean=4.0, sigma=1.8, size=n_genes)
    lfc = np.zeros(n_genes)
    hit = rng.choice(n_genes, 300, replace=False)
    lfc[hit] = rng.normal(0, 1.0, hit.size)
    size = rng.uniform(0.8, 1.25, len(samples))
    cols = {}
    for j, s in enumerate(samples):
        mu = base * size[j] * (2 ** lfc if s.startswith("T") else 1)
        if s == "T4":                       # one deliberately odd library, like the real T4
            mu = mu * rng.lognormal(0, 0.6, n_genes)
        disp = 0.08
        cols[s] = rng.negative_binomial(1 / disp, 1 / (1 + mu * disp))
    ids = [f"ENSMUSG{100000 + i:011d}" for i in range(n_genes)]
    annot = pd.DataFrame({
        "gene_id": ids,
        "gene_name": [f"Gm{i}" for i in range(n_genes)],
        "gene_chr": rng.integers(1, 20, n_genes).astype(str),
        "gene_start": rng.integers(1, 10**8, n_genes),
        "gene_end": 0, "gene_strand": "+", "gene_length": rng.integers(500, 9000, n_genes),
        "gene_biotype": rng.choice(["protein_coding", "lncRNA", "pseudogene"], n_genes, p=[.75, .15, .10]),
        "gene_description": "synthetic", "tf_family": "-",
    })
    annot["gene_end"] = annot.gene_start + annot.gene_length
    counts = pd.concat([annot[["gene_id"]], pd.DataFrame(cols), annot.drop(columns="gene_id")], axis=1)
    cpath, mpath = dest / "gene_count.xls", dest / "metadata.csv"
    counts.to_csv(cpath, sep="\t", index=False)
    pd.DataFrame({"sample": samples, "group": [s[0] for s in samples]}).to_csv(mpath, index=False)
    # Signature tables in the layout steps 07 and 09–11 read. Synthetic genes,
    # drawn partly from the planted effects so the scores have something to find.
    names = annot.gene_name.to_numpy()
    sig_rows, ax_rows = [], []
    pool = rng.permutation(n_genes)
    for i, sname in enumerate(["DG_granule_mature", "DG_granule_immature", "NSC", "IPC_neuroblast",
                               "CA1", "CA3", "ChoroidPlexus", "Ependymal", "Microglia", "Astrocyte"]):
        for g in pool[i * 25:(i + 1) * 25]:
            sig_rows.append({"gene": names[g], "signature": sname})
    axes = {"Neurogenesis": ["proliferation", "differentiation"], "Plasticity": ["LTP", "synaptic"],
            "Inflammation": ["microglial", "cytokine"], "Metabolism": ["mitochondrial", "glycolysis"],
            "Endocannabinoid": ["synthesis", "degradation"]}
    k = 0
    for a, subs in axes.items():
        for sub in subs:
            take = np.concatenate([hit[k * 6:(k + 1) * 6], pool[400 + k * 14: 400 + (k + 1) * 14]])
            for g in take:
                ax_rows.append({"gene": names[g], "axis": a, "subaxis": sub})
            k += 1
    sd = dest / "signatures"
    sd.mkdir(exist_ok=True)
    pd.DataFrame(sig_rows).to_csv(sd / "DG_cell_type_signatures.csv", index=False)
    pd.DataFrame(ax_rows).to_csv(sd / "targeted_axes_signatures.csv", index=False)
    return cpath, mpath


# ---------------------------------------------------------------- snRNA

# Marker genes the notebook's MARKER_MODULES look for, per synthetic type.
_TYPES = {
    "Excitatory_neuron": ["Slc17a7", "Camk2a", "Satb2", "Tbr1", "Neurod6", "Rorb"],
    "Inhibitory_neuron": ["Gad1", "Gad2", "Slc6a1", "Dlx1", "Dlx2", "Slc32a1"],
    "Astrocyte": ["Aqp4", "Aldoc", "Slc1a3", "Gja1", "Sox9", "Slc1a2"],
    "Oligodendrocyte": ["Mog", "Mag", "Cnp", "Sox10", "Olig2", "Myrf", "Mbp", "Plp1", "Mobp"],
    "OPC": ["Pdgfra", "Cspg4", "Olig1", "Ptprz1", "Vcan"],
    "Microglia": ["P2ry12", "Tmem119", "Cx3cr1", "C1qa", "Hexb", "Sall1"],
    "Endothelial": ["Cldn5", "Pecam1", "Kdr", "Esam", "Slco1a4"],
}
_SHARE = [0.38, 0.14, 0.16, 0.16, 0.06, 0.06, 0.04]
_EXTRA = ["mt-Co1", "mt-Nd1", "mt-Cytb", "Hba-a1", "Hbb-bs", "Rps3", "Rpl13", "Ttr"]


def _write_10x_h5(path: Path, X, genes: list[str], barcodes: list[str]) -> None:
    """CellRanger v3 layout, which is what CellBender writes and sc.read_10x_h5 reads."""
    from scipy import sparse
    m = sparse.csc_matrix(X.T.astype(np.int32))           # genes × cells
    with h5py.File(path, "w") as f:
        g = f.create_group("matrix")
        g.create_dataset("barcodes", data=np.array(barcodes, dtype="S"))
        g.create_dataset("data", data=m.data)
        g.create_dataset("indices", data=m.indices)
        g.create_dataset("indptr", data=m.indptr)
        g.create_dataset("shape", data=np.array(m.shape, dtype=np.int32))
        ft = g.create_group("features")
        ft.create_dataset("id", data=np.array([f"ENSMUSG_{x}" for x in genes], dtype="S"))
        ft.create_dataset("name", data=np.array(genes, dtype="S"))
        ft.create_dataset("feature_type", data=np.array(["Gene Expression"] * len(genes), dtype="S"))
        ft.create_dataset("genome", data=np.array(["GRCm39"] * len(genes), dtype="S"))
        ft.create_dataset("_all_tag_keys", data=np.array(["genome"], dtype="S"))


def write_snrna_demo(dest: Path, n_nuclei: int = 1200, n_bg: int = 3600, seed: int = 11) -> list[Path]:
    """Eight *_lr5e5_filtered.h5 files, VEH1–4 and THC1–4."""
    rng = np.random.default_rng(seed)
    dest.mkdir(parents=True, exist_ok=True)
    markers = sorted({g for v in _TYPES.values() for g in v})
    # Real mouse symbols from the bundled GO:BP sets, so the pathway stage has
    # something to find; the THC response is planted in a few whole GO terms.
    go = json.loads(GO_BP.read_text())
    pool = sorted({g for v in go.values() for g in v} - set(markers) - set(_EXTRA))
    symbols = list(rng.choice(pool, n_bg, replace=False))
    genes = markers + _EXTRA + symbols
    gi = {g: i for i, g in enumerate(genes)}
    base = rng.lognormal(-1.2, 1.3, len(genes))
    type_prog = {}
    for t, ms in _TYPES.items():
        prog = base.copy()
        for g in ms:
            prog[gi[g]] *= 40
        bg = rng.choice(np.arange(len(markers) + len(_EXTRA), len(genes)), 120, replace=False)
        prog[bg] *= rng.lognormal(1.0, 0.4, bg.size)        # type-specific background
        type_prog[t] = prog
    thc_shift = np.ones(len(genes))
    resp = rng.choice(np.arange(len(markers) + len(_EXTRA), len(genes)), 80, replace=False)
    thc_shift[resp] = 2 ** rng.normal(0, 1.2, resp.size)
    inbg = set(symbols)
    terms = sorted(t for t, v in go.items() if 15 <= len(inbg.intersection(v)) <= 60)
    for k, t in enumerate(rng.choice(terms, 4, replace=False)):
        idx = [gi[g] for g in go[t] if g in inbg]
        thc_shift[idx] = 2 ** ((1 if k % 2 == 0 else -1) * rng.uniform(0.8, 1.6, len(idx)))
    out = []
    for s in [f"VEH{i}" for i in range(1, 5)] + [f"THC{i}" for i in range(1, 5)]:
        share = np.array(_SHARE) * rng.lognormal(0, 0.1, len(_SHARE))
        share /= share.sum()
        labels = rng.choice(list(_TYPES), n_nuclei, p=share)
        depth = rng.lognormal(np.log(3500), 0.35, n_nuclei)
        X = np.zeros((n_nuclei, len(genes)), dtype=np.int32)
        for t in _TYPES:
            idx = np.where(labels == t)[0]
            prog = type_prog[t] * (thc_shift if s.startswith("THC") else 1)
            p = prog / prog.sum()
            mu = depth[idx, None] * p[None, :]
            X[idx] = rng.poisson(mu)
        mt = [gi[g] for g in _EXTRA[:3]]
        X[:, mt] += rng.poisson(depth[:, None] * 0.004, (n_nuclei, len(mt)))
        bcs = [f"{''.join(rng.choice(list('ACGT'), 16))}-1" for _ in range(n_nuclei)]
        p = dest / f"{s}_cellbender_lr5e5_filtered.h5"
        _write_10x_h5(p, X, genes, bcs)
        out.append(p)
    return out


# Settings a demo run uses so it finishes in minutes: no internet calls, no t-SNE.
SNRNA_DEMO_OVERRIDES = {"RUN_PATHWAYS": False, "RUN_TSNE": False, "N_BOOTSTRAP": 500, "N_TOP_HVG": 2000}
