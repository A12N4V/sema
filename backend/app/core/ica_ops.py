"""ICA fitting and component inspection."""
from __future__ import annotations

import base64
import io

import matplotlib

matplotlib.use("Agg")  # headless, this process never opens a GUI window
import matplotlib.pyplot as plt
import mne
import numpy as np
from mne.preprocessing import ICA


def fit_ica(raw: mne.io.BaseRaw, n_components: float | int = 0.99, method: str = "fastica",
            random_state: int = 97) -> ICA:
    """Fit ICA on a (ideally already high-pass filtered >=1Hz) Raw.

    n_components as a float <1 is interpreted by MNE as "explain this
    fraction of variance"; as an int, an exact component count.
    """
    ica = ICA(n_components=n_components, method=method, random_state=random_state, max_iter="auto")
    ica.fit(raw, verbose="ERROR")
    return ica


def component_summary(ica: ICA, inst: mne.io.BaseRaw) -> list[dict]:
    """Per-component metadata: index, variance explained, current exclusion state."""
    n = ica.n_components_
    out = []
    for idx in range(n):
        try:
            # get_explained_variance_ratio(inst, components=[idx]) returns
            # {'eeg': ratio_for_just_this_component} when given a single
            # component index: calling it once per component is the
            # correct (if slightly more verbose) way to get a per-component
            # breakdown; called without `components` it returns the total
            # ratio across ALL components instead, which is a different
            # number and not indexable by component.
            ratios = ica.get_explained_variance_ratio(inst, components=[idx])
            var = float(ratios.get("eeg")) if isinstance(ratios, dict) else None
        except Exception:
            var = None
        out.append({
            "index": idx,
            "excluded": idx in ica.exclude,
            "variance_explained": var,
        })
    return out


def attach_labels(components: list[dict], labels: list[dict]) -> list[dict]:
    """Fold ICLabel output onto the component summary. Kept separate so a
    session without a classification returns exactly the old shape."""
    by_index = {c["index"]: c for c in labels}
    for comp in components:
        hit = by_index.get(comp["index"])
        comp["label"] = hit["label"] if hit else None
        comp["label_prob"] = hit["prob"] if hit else None
    return components


def topomap_png_b64(ica: ICA, raw: mne.io.BaseRaw, component_index: int) -> str:
    """Render one ICA component's scalp topography as a base64 PNG."""
    fig = ica.plot_components(picks=[component_index], show=False, res=64)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=80, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


def sources_window(ica: ICA, raw: mne.io.BaseRaw, start: float, duration: float,
                   max_points: int = 2000) -> dict:
    """IC activation time-courses over a window, in the shared wire shape.

    Channels come back named ``IC 0``, ``IC 1``… (MNE calls them ``ICA000``).
    Units are arbitrary (ICA sources aren't volts) so no µV scaling.
    """
    from app.core import wire

    sources = ica.get_sources(raw)  # RawArray, ch = ICA000, ICA001, ...
    w = wire.window(sources, start, duration, max_points=max_points)
    rename = {f"ICA{idx:03d}": f"IC {idx}" for idx in range(ica.n_components_)}
    w["channels"] = [rename.get(c, c) for c in w["channels"]]
    w["data"] = {rename.get(k, k): v for k, v in w["data"].items()}
    return w


def component_psd(ica: ICA, raw: mne.io.BaseRaw, index: int,
                  fmin: float = 1.0, fmax: float = 45.0) -> dict:
    """Welch PSD of one IC's activation, in dB (matches the Spectrum panel)."""
    sources = ica.get_sources(raw)
    spectrum = sources.compute_psd(method="welch", fmin=fmin, fmax=fmax,
                                   picks=[f"ICA{index:03d}"], verbose="ERROR")
    # exclude=() so an already-excluded component's own spectrum still returns
    # (get_sources() marks excluded ICs as bad channels on the sources object)
    psd, freqs = spectrum.get_data(exclude=(), return_freqs=True)
    psd_db = (10 * np.log10(psd[0] + np.finfo(float).eps)).tolist()
    return {"index": index, "freqs": freqs.tolist(), "psd_db": psd_db}


def set_exclusions(ica: ICA, exclude: list[int]) -> None:
    ica.exclude = list(sorted(set(exclude)))


def apply_ica(ica: ICA, raw: mne.io.BaseRaw) -> None:
    """Apply the current exclusion set, removing those components in-place."""
    ica.apply(raw, verbose="ERROR")
