"""Scalp topomap rendering for band-power maps (ICA components have their
own renderer in ica_ops.py, since MNE's ICA.plot_components handles that
layout slightly differently).
"""
from __future__ import annotations

import base64
import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mne
import numpy as np


def band_power_topomap_png_b64(raw: mne.io.BaseRaw, values: list[float], ch_names: list[str]) -> str:
    """Render a single scalp topomap from one value per channel.

    Requires the Raw to have a montage set (see filters.set_montage) —
    without sensor positions there's nothing to interpolate over.
    """
    if raw.get_montage() is None:
        raise ValueError("Raw has no montage set; call /preprocessing/montage first")

    info = mne.pick_info(raw.info, mne.pick_channels(raw.ch_names, ch_names, ordered=True))
    fig, ax = plt.subplots(figsize=(3, 3))
    mne.viz.plot_topomap(np.asarray(values), info, axes=ax, show=False)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=80, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")
