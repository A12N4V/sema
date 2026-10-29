"""Explanatory charts for docs/FORMAT_BULK_RNASEQ.md and docs/FORMAT_SNRNASEQ.md.

Every number here is SIMULATED to show the method, never a result from the
AdoTHC data. Styled in the Homonin core language: black ground, cream ink,
one orange signal (homonin/design/foundry/languages/core.json).

    backend/.venv/bin/python docs/img/omics/make_charts.py
"""
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats

OUT = Path(__file__).parent
BG, INK, MUTED, LINE, ACC, ACC2 = "#000000", "#e8e2d9", "#7a7269", "#24201d", "#f97f3a", "#b5ac9f"
plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
    "axes.edgecolor": MUTED, "axes.labelcolor": INK, "text.color": INK,
    "xtick.color": MUTED, "ytick.color": MUTED, "axes.grid": False,
    "font.family": "monospace", "font.size": 9, "axes.titlesize": 10, "axes.titleweight": "bold",
    "axes.spines.top": False, "axes.spines.right": False,
})
rng = np.random.default_rng(1234)


def save(fig, name, note="simulated · illustrative only"):
    fig.text(0.995, 0.01, note, ha="right", va="bottom", color=MUTED, fontsize=7)
    fig.savefig(OUT / f"{name}.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


# ------------------------------------------------------------------ bulk
G, n = 4000, 7
grp = np.array([0, 0, 0, 0, 1, 1, 1])                  # 4 V, 3 T (T4 excluded)
mu = np.exp(rng.normal(5, 2, G))
alpha = 0.02 + 1.5 / mu + rng.lognormal(0, 0.6, G) * 0.02
lfc = np.where(rng.random(G) < 0.06, rng.normal(0, 1.2, G), 0)
s = rng.lognormal(0, 0.25, n)
q = mu[:, None] * 2 ** (lfc[:, None] * grp[None, :])
K = rng.negative_binomial(1 / alpha[:, None], 1 / (1 + alpha[:, None] * s[None, :] * q))

# 1. mean-variance: why NB, not Poisson
norm = K / s
m, v = norm.mean(1), norm.var(1, ddof=1)
ok = m > 1
fig, ax = plt.subplots(figsize=(6, 4))
ax.loglog(m[ok], v[ok], ".", ms=2, color=ACC2, alpha=.5, label="genes")
xs = np.logspace(0, 5, 100)
ax.loglog(xs, xs, color=MUTED, lw=1, ls="--", label="Poisson  var = μ")
ax.loglog(xs, xs + (0.03 + 1.5 / xs) * xs ** 2, color=ACC, lw=2, label="NB  var = μ + αμ²")
ax.set(xlabel="mean normalised count", ylabel="variance", title="Counts are overdispersed: the negative binomial")
ax.legend(frameon=False)
save(fig, "bulk-mean-variance")

# 2. dispersion shrinkage
a_hat = np.clip((v - m) / m ** 2, 1e-3, None)
trend = 0.03 + 1.5 / m
a_map = np.exp(0.35 * np.log(a_hat) + 0.65 * np.log(trend))
fig, ax = plt.subplots(figsize=(6, 4))
ax.loglog(m[ok], a_hat[ok], ".", ms=2, color=MUTED, alpha=.6, label="gene-wise MLE  α̂_g")
ax.loglog(m[ok], a_map[ok], ".", ms=2, color=ACC, alpha=.7, label="shrunk MAP  α_g")
o = np.argsort(m[ok])
ax.loglog(m[ok][o], trend[ok][o], color=INK, lw=1.5, label="fitted trend  a₁/μ + a₀")
ax.set(xlabel="mean normalised count", ylabel="dispersion α", title="5 df per gene: borrow strength across genes")
ax.legend(frameon=False, markerscale=4)
save(fig, "bulk-dispersion")

# 3. PCA on log counts
lg = np.log2(norm + 1)
top = np.argsort(lg.var(1))[-500:]
X = lg[top].T - lg[top].T.mean(0)
U, S_, Vt = np.linalg.svd(X, full_matrices=False)
pc = U * S_
pv = S_ ** 2 / (S_ ** 2).sum() * 100
fig, ax = plt.subplots(figsize=(5, 4))
for g, c, lab in [(0, ACC2, "V (vehicle)"), (1, ACC, "T (THC)")]:
    ax.scatter(pc[grp == g, 0], pc[grp == g, 1], s=70, color=c, edgecolor=BG, label=lab)
for i, (x, y) in enumerate(pc[:, :2]):
    ax.annotate(f"{'VT'[grp[i]]}{i + 1 if grp[i] == 0 else i - 3}", (x, y), xytext=(6, 4), textcoords="offset points", color=MUTED, fontsize=8)
ax.set(xlabel=f"PC1  {pv[0]:.0f}%", ylabel=f"PC2  {pv[1]:.0f}%", title="PCA of VST counts: one dot per animal")
ax.legend(frameon=False)
save(fig, "bulk-pca")

# 4. volcano + MA from a per-gene Welch test on log counts (stand-in for the Wald test)
t, p = stats.ttest_ind(lg[:, grp == 1], lg[:, grp == 0], axis=1, equal_var=False)
p = np.nan_to_num(p, nan=1)
est = lg[:, grp == 1].mean(1) - lg[:, grp == 0].mean(1)
padj = stats.false_discovery_control(p)
hit = (padj < .05) & (np.abs(est) >= .3)
expl = (p < .05) & (np.abs(est) >= .3) & ~hit
fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))
for msk, c, lab in [(~hit & ~expl, LINE, "n.s."), (expl, MUTED, "exploratory  p<0.05"), (hit, ACC, "primary  FDR<0.05, |LFC|≥0.3")]:
    a1.scatter(est[msk], -np.log10(p[msk]), s=4, color=c, label=f"{lab} ({msk.sum()})")
    a2.scatter(np.log10(m[msk] + 1), est[msk], s=4, color=c)
a1.axvline(-.3, color=MUTED, lw=.6, ls=":"); a1.axvline(.3, color=MUTED, lw=.6, ls=":")
a1.set(xlabel="log2 fold change  (T / V)", ylabel="−log10 p", title="Volcano: size against evidence")
a1.legend(frameon=False, markerscale=3, fontsize=7, loc="upper left")
a2.axhline(0, color=MUTED, lw=.6)
a2.set(xlabel="log10 mean count", ylabel="log2 fold change", title="MA: does the effect depend on depth?")
save(fig, "bulk-volcano-ma")

# 5. median of ratios
fig, ax = plt.subplots(figsize=(6, 3.6))
geo = np.exp(np.log(np.where(K > 0, K, np.nan)).mean(1))
for j in range(n):
    r = np.log2(K[:, j] / geo)
    r = r[np.isfinite(r)]
    parts = ax.violinplot(r, [j], showextrema=False, widths=.8)
    for b in parts["bodies"]:
        b.set_facecolor(ACC if grp[j] else ACC2); b.set_alpha(.35)
    ax.plot([j - .35, j + .35], [np.median(r)] * 2, color=INK, lw=2)
ax.set_xticks(range(n), [f"{'VT'[g]}{i + 1 if g == 0 else i - 3}" for i, g in enumerate(grp)])
ax.set(ylabel="log2 ( K_gj / geometric mean_g )", ylim=(-3, 3), title="Size factor s_j = median of ratios (white bar)")
save(fig, "bulk-size-factors")

# ------------------------------------------------------------------ snRNA
animals = [f"VEH{i}" for i in range(1, 5)] + [f"THC{i}" for i in range(1, 5)]
agrp = np.array([0] * 4 + [1] * 4)

# 6. QC with per-sample MAD ceiling
fig, ax = plt.subplots(figsize=(9, 3.8))
for i, a in enumerate(animals):
    depth = rng.lognormal(7.8 + rng.normal(0, .25), .45, 3000)
    z = np.log1p(depth)
    ceil = np.expm1(np.median(z) + 5 * stats.median_abs_deviation(z, scale="normal"))
    ok = (depth >= 1000) & (depth <= ceil)
    ax.scatter(i + rng.uniform(-.3, .3, ok.sum()), depth[ok], s=1, color=ACC if agrp[i] else ACC2, alpha=.25)
    ax.scatter(i + rng.uniform(-.3, .3, (~ok).sum()), depth[~ok], s=2, color=MUTED, alpha=.5)
    ax.plot([i - .4, i + .4], [ceil] * 2, color=INK, lw=1.5)
ax.axhline(1000, color=ACC, lw=1, ls="--")
ax.text(7.5, 1080, "floor  MIN_COUNTS = 1000", color=ACC, ha="right", va="bottom", fontsize=7)
ax.set_yscale("log"); ax.set_xticks(range(8), animals)
ax.set(ylabel="UMI counts per nucleus", title="QC: a fixed floor, and a ceiling per animal  (median + 5 MAD, log scale)")
save(fig, "sn-qc-mad")

# 7. embedding coloured by type and by animal
types = ["Exc", "Inh", "Astro", "Oligo", "OPC", "Micro", "Endo"]
cent = rng.normal(0, 6, (len(types), 2))
pts, lab, ani = [], [], []
for k, c in enumerate(cent):
    nk = int(2500 * [1, .35, .5, .8, .2, .25, .1][k])
    pts.append(c + rng.normal(0, 1, (nk, 2)) * [1.2, .8]); lab += [k] * nk; ani += list(rng.integers(0, 8, nk))
pts, lab, ani = np.vstack(pts), np.array(lab), np.array(ani)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.6))
shades = plt.cm.copper(np.linspace(.25, 1, len(types)))
for k in range(len(types)):
    a1.scatter(*pts[lab == k].T, s=1, color=shades[k], alpha=.6)
    a1.text(*cent[k], types[k], color=INK, fontsize=9, ha="center", weight="bold")
a1.set(title="Leiden clusters → broad cell types", xticks=[], yticks=[])
a2.scatter(*pts.T, s=1, c=np.where(agrp[ani] == 1, ACC, ACC2), alpha=.35)
a2.set(title="Same nuclei by animal group: animals interleave", xticks=[], yticks=[])
for a in (a1, a2):
    a.spines[:].set_visible(False)
save(fig, "sn-embedding")

# 8. pseudo-replication: nucleus-level test vs pseudobulk under the null
reps, nuc = 400, 300
p_nuc, p_pb = [], []
for _ in range(reps):
    animal_eff = rng.normal(0, .35, 8)                 # no true group effect, only animal-to-animal variation
    expr = [rng.poisson(np.exp(1 + animal_eff[i]), nuc) for i in range(8)]
    a = np.concatenate([e for e, g in zip(expr, agrp) if g == 0]); b = np.concatenate([e for e, g in zip(expr, agrp) if g == 1])
    p_nuc.append(stats.mannwhitneyu(a, b).pvalue)
    pb = np.array([e.sum() for e in expr], float)
    p_pb.append(stats.ttest_ind(np.log(pb[agrp == 1]), np.log(pb[agrp == 0])).pvalue)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 3.8), sharey=True)
bins = np.linspace(0, 1, 21)
for ax, pv, title, c in [(a1, p_nuc, "Wilcoxon over 2400 nuclei", MUTED), (a2, p_pb, "Pseudobulk: 8 animal sums", ACC)]:
    ax.hist(pv, bins, color=c, edgecolor=BG)
    ax.axhline(reps / 20, color=INK, lw=1, ls="--")
    fp = np.mean(np.array(pv) < .05) * 100
    ax.set(title=f"{title}\nfalse positives at p<0.05: {fp:.0f}%  (should be 5%)", xlabel="p-value under the null")
a1.set_ylabel("simulations"); a1.text(.5, reps / 20 * 1.05, "uniform = calibrated", color=INK, fontsize=7)
save(fig, "sn-pseudoreplication")

# 9. composition: animal points + exact permutation null
true_frac = {"Micro": (.06, .085), "Astro": (.12, .12), "OPC": (.04, .036)}
fig, axes = plt.subplots(1, 2, figsize=(11, 3.8), gridspec_kw={"width_ratios": [1.2, 1]})
ax = axes[0]
import itertools
for k, (ct, (v0, v1)) in enumerate(true_frac.items()):
    f = np.r_[rng.normal(v0, .01, 4), rng.normal(v1, .01, 4)]
    ax.scatter(k - .15 + rng.uniform(-.04, .04, 4), f[:4], color=ACC2, s=40, edgecolor=BG)
    ax.scatter(k + .15 + rng.uniform(-.04, .04, 4), f[4:], color=ACC, s=40, edgecolor=BG)
    ax.plot([k - .25, k - .05], [f[:4].mean()] * 2, color=INK); ax.plot([k + .05, k + .25], [f[4:].mean()] * 2, color=INK)
    if ct == "Micro":
        micro = f
ax.set_xticks(range(3), list(true_frac)); ax.set(ylabel="fraction of the animal's nuclei", title="Composition: one dot per animal  (VEH | THC)")
obs = micro[4:].mean() - micro[:4].mean()
null = [micro[list(c)].mean() - micro[[i for i in range(8) if i not in c]].mean() for c in itertools.combinations(range(8), 4)]
pval = np.mean(np.abs(null) >= abs(obs) - 1e-12)
ax = axes[1]
ax.hist(null, 25, color=MUTED, edgecolor=BG)
ax.axvline(obs, color=ACC, lw=2)
ax.set(title=f"Exact null for Micro: all C(8,4)=70 labelings\np = {pval:.3f}  (floor 2/70 = 0.029)", xlabel="Δ mean fraction  THC − VEH", ylabel="labelings")
save(fig, "sn-composition-permutation")
print("wrote", sorted(p.name for p in OUT.glob("*.png")))
