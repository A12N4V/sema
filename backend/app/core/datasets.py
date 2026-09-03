"""Sample datasets from ``mne.datasets`` — the "try it without a file of your
own" path on Connect. First fetch downloads (and caches under ~/mne_data);
that's why it runs as a job (docs/BUILD_PLAN_V2.md P0.10).
"""
from __future__ import annotations

import mne


def _eegbci() -> mne.io.BaseRaw:
    from mne.datasets import eegbci
    files = eegbci.load_data(subject=1, runs=[3, 7, 11], update_path=True)
    raw = mne.concatenate_raws([mne.io.read_raw_edf(f, preload=True, verbose="ERROR") for f in files])
    eegbci.standardize(raw)
    raw.set_montage("standard_1005", on_missing="warn", verbose="ERROR")
    return raw


def _sample() -> mne.io.BaseRaw:
    from mne.datasets import sample
    p = sample.data_path()
    return mne.io.read_raw_fif(p / "MEG" / "sample" / "sample_audvis_raw.fif", preload=True, verbose="ERROR")


def _somato() -> mne.io.BaseRaw:
    from mne.datasets import somato
    p = somato.data_path()
    return mne.io.read_raw_fif(
        p / "sub-01" / "meg" / "sub-01_task-somato_meg.fif", preload=True, verbose="ERROR"
    )


def _ssvep() -> mne.io.BaseRaw:
    from mne.datasets import ssvep
    p = ssvep.data_path()
    return mne.io.read_raw_fif(
        p / "sub-02" / "ses-01" / "eeg" / "sub-02_ses-01_task-ssvep_raw.fif", preload=True, verbose="ERROR"
    )


def _fnirs_motor() -> mne.io.BaseRaw:
    from mne.datasets import fnirs_motor
    return mne.io.read_raw_nirx(fnirs_motor.data_path(), preload=True, verbose="ERROR")


DATASETS: dict[str, dict] = {
    "eegbci":      {"load": _eegbci,      "label": "EEGBCI — motor imagery (64-ch EEG)", "modality": "eeg"},
    "sample":      {"load": _sample,      "label": "MNE sample — auditory/visual (MEG + EEG)", "modality": "meg"},
    "somato":      {"load": _somato,      "label": "Somato — median-nerve SEF (MEG)", "modality": "meg"},
    "ssvep":       {"load": _ssvep,       "label": "SSVEP — steady-state visual (EEG)", "modality": "eeg"},
    "fnirs_motor": {"load": _fnirs_motor, "label": "fNIRS motor — finger tapping", "modality": "fnirs"},
}


def catalog() -> list[dict]:
    return [{"name": k, "label": v["label"], "modality": v["modality"]} for k, v in DATASETS.items()]


def load_dataset(name: str) -> mne.io.BaseRaw:
    if name not in DATASETS:
        raise ValueError(f"Unknown dataset {name!r}. Choose from {sorted(DATASETS)}")
    return DATASETS[name]["load"]()
