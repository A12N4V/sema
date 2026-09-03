"""A synthetic but plausible EEG recording for the demo session.

No download, deterministic, ~2 MB. It has the features every panel needs
something to show: 1/f background, a posterior alpha rhythm that waxes and
wanes, frontal blink transients (also written as annotations), and a bit of
line noise so the notch filter isn't a no-op. One channel (T7) carries
extra broadband noise to stand in for a "bad channel".
"""
from __future__ import annotations

import numpy as np
import mne

_CH_NAMES = [
    "Fp1", "Fp2", "AF3", "AF4", "F7", "F3", "Fz", "F4", "F8",
    "FC5", "FC3", "FC1", "FC2", "FC4", "FC6",
    "T7", "C3", "Cz", "C4", "T8",
    "CP5", "CP1", "CP2", "CP6",
    "P7", "P3", "Pz", "P4", "P8",
    "POz", "O1", "O2",
]

SFREQ = 256.0
DURATION = 180.0


def make_demo_raw(seed: int = 7) -> mne.io.BaseRaw:
    rng = np.random.default_rng(seed)
    n_ch = len(_CH_NAMES)
    n = int(SFREQ * DURATION)
    t = np.arange(n) / SFREQ

    montage = mne.channels.make_standard_montage("standard_1020")
    pos = montage.get_positions()["ch_pos"]
    xy = np.array([pos[ch][:2] for ch in _CH_NAMES])  # (n_ch, 2): x=left/right, y=front/back
    y = xy[:, 1]
    posterior = (y.max() - y) / (y.max() - y.min())   # 0 frontal .. 1 occipital
    anterior = 1.0 - posterior

    data = np.zeros((n_ch, n))

    # 1/f-ish background: integrate white noise, per channel
    for i in range(n_ch):
        w = rng.standard_normal(n)
        pink = np.cumsum(w)
        pink -= np.linspace(pink[0], pink[-1], n)      # detrend
        pink /= np.std(pink) or 1.0
        data[i] = pink * 12e-6

    # posterior alpha (~10 Hz), amplitude modulated by a slow 0.1 Hz envelope
    alpha_env = 0.5 * (1 + np.sin(2 * np.pi * 0.1 * t - 1.0)) ** 2
    alpha = np.sin(2 * np.pi * 10.0 * t + rng.uniform(0, 2 * np.pi))
    for i in range(n_ch):
        amp = (2e-6 + 22e-6 * posterior[i] ** 2)
        data[i] += amp * alpha_env * alpha

    # frontal blinks every 6-14 s: a short positive deflection, anterior-weighted
    blink_onsets = []
    tb = rng.uniform(3, 8)
    while tb < DURATION - 3:
        blink_onsets.append(tb)
        s0 = int(tb * SFREQ)
        width = int(0.16 * SFREQ)
        shape = np.exp(-0.5 * ((np.arange(-width, width) / (width / 2.2)) ** 2))
        seg = slice(s0 - width, s0 + width)
        for i in range(n_ch):
            data[i, seg] += 110e-6 * anterior[i] ** 2 * shape
        tb += rng.uniform(6, 14)

    # mains hum + white sensor noise
    data += 1.6e-6 * np.sin(2 * np.pi * 60.0 * t)[None, :]
    data += rng.standard_normal((n_ch, n)) * 2.0e-6

    # T7 is a flaky electrode
    t7 = _CH_NAMES.index("T7")
    data[t7] += rng.standard_normal(n) * 18e-6

    info = mne.create_info(_CH_NAMES, SFREQ, ch_types="eeg")
    raw = mne.io.RawArray(data, info, verbose="ERROR")
    raw.set_montage(montage, verbose="ERROR")
    raw.set_annotations(
        mne.Annotations(onset=blink_onsets, duration=0.3, description="blink")
    )
    return raw
