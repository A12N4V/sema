"""In-memory session state + the per-session service object.

A "session" is one recording plus whatever MNE objects have been derived
from it so far (a filtered Raw, a fitted ICA, an Epochs object) *and* an
append-only provenance ledger of every mutating operation.

The ``Session`` class is both the state bag and the service: routers call
``session.filter(...)`` / ``session.set_montage(...)`` etc., each of which
performs the MNE call and records a ``LedgerEntry``. That makes every
endpoint a 3-liner and gives revert / pipeline-export / audit for free.

Kept resident in a process-wide dict: see ARCHITECTURE.md for why this
isn't a database. Idle sessions are evicted after SESSION_TTL_SECONDS.
"""
from __future__ import annotations

import functools
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import mne

from app.core.paths import SESSIONS_DIR as WORKDIR
from app.services.ledger import Ledger

SESSION_TTL_SECONDS = 60 * 60 * 2  # 2 hours of inactivity


# --- helpers ---------------------------------------------------------------

def _filter_label(l_freq: Optional[float], h_freq: Optional[float]) -> str:
    if l_freq is not None and h_freq is not None:
        return f"Band-pass {l_freq:g}–{h_freq:g} Hz"
    if l_freq is not None:
        return f"High-pass {l_freq:g} Hz"
    if h_freq is not None:
        return f"Low-pass {h_freq:g} Hz"
    return "Filter (no-op)"


def _set_bads(raw: mne.io.BaseRaw, bads: list[str]) -> None:
    raw.info["bads"] = list(bads)


def _brief(raw: mne.io.BaseRaw) -> dict[str, Any]:
    info = raw.info
    return {
        "n_times": int(raw.n_times),
        "sfreq": float(info["sfreq"]),
        "highpass": float(info["highpass"]) if info["highpass"] is not None else None,
        "lowpass": float(info["lowpass"]) if info["lowpass"] is not None else None,
        "n_bads": len(info["bads"]),
        "has_montage": raw.get_montage() is not None,
    }


# Deterministic replay: op -> function that re-applies it to a fresh Raw.
# ICA fit/apply are handled separately via a snapshot checkpoint.
_REPLAY_DISPATCH = {
    "filter": lambda raw, p: raw.filter(l_freq=p["l_freq"], h_freq=p["h_freq"], verbose="ERROR"),
    "notch": lambda raw, p: raw.notch_filter(freqs=p["freqs"], verbose="ERROR"),
    "resample": lambda raw, p: raw.resample(p["sfreq"], verbose="ERROR"),
    "set_reference": lambda raw, p: raw.set_eeg_reference(ref_channels=p["ref_channels"], verbose="ERROR"),
    "set_montage": lambda raw, p: raw.set_montage(
        mne.channels.make_standard_montage(p["montage_name"]),
        match_case=False, on_missing="warn", verbose="ERROR",
    ),
    "set_bads": lambda raw, p: _set_bads(raw, p["bads"]),
    "interpolate_bads": lambda raw, p: raw.interpolate_bads(
        reset_bads=p["reset_bads"], verbose="ERROR"
    ),
    "rename_channels": lambda raw, p: raw.rename_channels(p["mapping"]),
    "set_channel_types": lambda raw, p: raw.set_channel_types(p["mapping"], verbose="ERROR"),
    "drop_channels": lambda raw, p: raw.drop_channels(
        [c for c in p["channels"] if c in raw.ch_names]),
    "reorder_channels": lambda raw, p: raw.reorder_channels(
        [c for c in p["order"] if c in raw.ch_names]),
    "set_annotations": lambda raw, p: raw.set_annotations(mne.Annotations(
        onset=[a["onset"] for a in p["annotations"]],
        duration=[a["duration"] for a in p["annotations"]],
        description=[a["description"] for a in p["annotations"]],
    )),
    "detect_bad_channels": lambda raw, p: _set_bads(raw, p["found"]),
    "annotate_muscle": lambda raw, p: raw.set_annotations(
        raw.annotations + mne.Annotations(
            onset=[a["onset"] for a in p["found"]],
            duration=[a["duration"] for a in p["found"]],
            description=[a["description"] for a in p["found"]])),
}


def _synchronized(method):
    """Serialize a ``Session`` operation against that session's lock.

    Route handlers are plain ``def`` functions, so FastAPI runs them in a
    threadpool and two requests for the same session can execute on different
    threads at once. Every method that reads or mutates the underlying MNE
    objects takes the session lock first. ``revert`` re-enters via ``replay``
    so it must be a re-entrant lock.
    """
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self.lock:
            return method(self, *args, **kwargs)

    return wrapper


@dataclass
class Session:
    id: str
    filename: str
    raw: mne.io.BaseRaw
    epochs: Optional[mne.Epochs] = None
    evoked: Optional[Any] = None                  # mne.Evoked, epochs.average()
    tfr: Optional[Any] = None                     # mne.time_frequency.AverageTFR
    ica: Optional[mne.preprocessing.ICA] = None
    # ICLabel output: one dict per component, {"label", "prob"}. Kept beside the
    # ICA rather than on it, because MNE has nowhere to put it.
    ica_labels: list[dict] = field(default_factory=list)
    stc: Optional[Any] = None                     # mne.SourceEstimate (recomputable, not bundled)
    stc_meta: dict = field(default_factory=dict)
    # Auto-derived views (core/autoderive.py) plus the assumptions behind them.
    # Deliberately NOT ledger steps: they fill the workspaces that would
    # otherwise open empty, and they are replaced the moment the user runs the
    # real operation. Everything listed here is disclosed in the UI; none of it
    # is ever presented as the user's own work or exported as their pipeline.
    derived: list = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)
    # Held by every op that touches raw/epochs/ica. Callers on other threads
    # (threadpooled route handlers) block rather than race an in-place mutation.
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False, compare=False)

    # provenance
    original_raw: Optional[mne.io.BaseRaw] = None      # pristine copy for replay
    ledger: Ledger = field(default_factory=Ledger)
    montage_name: Optional[str] = None
    # seq -> post-apply Raw snapshot. ICA fits aren't cheap or perfectly
    # reproducible, so an apply_ica step is checkpointed rather than replayed.
    _ica_checkpoints: dict[int, mne.io.BaseRaw] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.original_raw is None:
            self.original_raw = self.raw.copy()

    def touch(self) -> None:
        self.last_used = time.time()

    @property
    def state_hash(self) -> str:
        """Changes whenever the signal changes: render-cache key (P0.5)."""
        from app.core.render import state_hash_for
        return state_hash_for(self.raw, self.ledger.head, self.ica is not None)

    # --- mutating operations (each records a ledger entry) ----------------

    @_synchronized
    def filter(self, l_freq: Optional[float], h_freq: Optional[float]) -> None:
        before = _brief(self.raw)
        self.raw.filter(l_freq=l_freq, h_freq=h_freq, verbose="ERROR")
        self.ledger.append(
            "filter", {"l_freq": l_freq, "h_freq": h_freq},
            label=_filter_label(l_freq, h_freq),
            template="raw.filter(l_freq={l_freq}, h_freq={h_freq})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def notch(self, freqs: list[float]) -> None:
        before = _brief(self.raw)
        self.raw.notch_filter(freqs=freqs, verbose="ERROR")
        self.ledger.append(
            "notch", {"freqs": list(freqs)},
            label=f"Notch {', '.join(f'{f:g}' for f in freqs)} Hz",
            template="raw.notch_filter(freqs={freqs})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def resample(self, sfreq: float) -> None:
        before = _brief(self.raw)
        self.raw.resample(sfreq, verbose="ERROR")
        self.ledger.append(
            "resample", {"sfreq": sfreq},
            label=f"Resample → {sfreq:g} Hz",
            template="raw.resample({sfreq})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def set_reference(self, ref_channels: str | list[str]) -> None:
        before = _brief(self.raw)
        self.raw.set_eeg_reference(ref_channels=ref_channels, verbose="ERROR")
        label = "Average reference" if ref_channels == "average" else f"Reference: {ref_channels}"
        self.ledger.append(
            "set_reference", {"ref_channels": ref_channels},
            label=label,
            template="raw.set_eeg_reference(ref_channels={ref_channels!r})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def set_montage(self, montage_name: str) -> None:
        before = _brief(self.raw)
        montage = mne.channels.make_standard_montage(montage_name)
        self.raw.set_montage(montage, match_case=False, on_missing="warn", verbose="ERROR")
        self.montage_name = montage_name
        self.ledger.append(
            "set_montage", {"montage_name": montage_name},
            label=f"Montage: {montage_name}",
            template="raw.set_montage(mne.channels.make_standard_montage({montage_name!r}), on_missing='warn')",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def set_bads(self, bads: list[str]) -> None:
        unknown = set(bads) - set(self.raw.ch_names)
        if unknown:
            raise ValueError(f"Unknown channel(s): {sorted(unknown)}")
        before = _brief(self.raw)
        self.raw.info["bads"] = list(bads)
        self.ledger.append(
            "set_bads", {"bads": list(bads)},
            label=f"Bad channels: {', '.join(bads) if bads else '(none)'}",
            template="raw.info['bads'] = {bads}",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def annotate_amplitude(self, peak_uv: float, flat_uv: Optional[float]) -> None:
        from mne.preprocessing import annotate_amplitude
        before = _brief(self.raw)
        annot, _ = annotate_amplitude(
            self.raw,
            peak=peak_uv * 1e-6,
            flat=(flat_uv * 1e-6) if flat_uv else None,
            bad_percent=5.0,
            min_duration=0.05,
            picks="eeg",
        )
        self.raw.set_annotations(self.raw.annotations + annot)
        self.ledger.append(
            "annotate_amplitude", {"peak_uv": peak_uv, "flat_uv": flat_uv},
            label=f"Amplitude annot → {len(annot)} BAD spans",
            template=(
                "annot, _ = mne.preprocessing.annotate_amplitude(raw, peak={peak_uv}e-6)\n"
                "raw.set_annotations(raw.annotations + annot)"
            ),
            info_before=before, info_after=_brief(self.raw),
            replayable=False,   # annotation ops aren't in the replay dispatch
        )

    @_synchronized
    def compute_source(self, method: str, center_t: float) -> None:
        from app.core import source
        meta = source.compute_source_estimate(self, method=method, center_t=center_t)
        self.ledger.append(
            "compute_source", {"method": method},
            label=f"Source estimate ({method})",
            template="# stc = apply_inverse_raw(raw, inverse_operator, 1/9, method={method!r})",
            info_before=_brief(self.raw), info_after=_brief(self.raw),
            replayable=False,
        )
        _ = meta

    @_synchronized
    def interpolate_bads(self, reset_bads: bool = True) -> None:
        bads = list(self.raw.info["bads"])
        if not bads:
            raise ValueError("No bad channels marked: nothing to interpolate")
        if self.raw.get_montage() is None:
            raise ValueError("Interpolation needs a montage (electrode positions)")
        before = _brief(self.raw)
        self.raw.interpolate_bads(reset_bads=reset_bads, verbose="ERROR")
        self.ledger.append(
            "interpolate_bads", {"reset_bads": reset_bads, "channels": bads},
            label=f"Interpolate {', '.join(bads)}",
            template="raw.interpolate_bads(reset_bads={reset_bads})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def fit_ica(self, n_components: float | int, method: str) -> None:
        from app.core import ica_ops
        self.ica = ica_ops.fit_ica(self.raw, n_components=n_components, method=method)
        # The old labels described the *old* decomposition. Component 7 of a
        # fresh fit is not component 7 of the one before it, so carrying them
        # over would put "eye blink, 94%" on an unrelated component. This was
        # survivable when sessions started with no ICA at all; now that one is
        # fitted and classified on load, every manual refit hit it.
        self.ica_labels = []
        self.ledger.append(
            "fit_ica", {"n_components": n_components, "method": method},
            label=f"Fit ICA ({method}, n={self.ica.n_components_})",
            template=(
                "ica = mne.preprocessing.ICA(n_components={n_components}, method={method!r}, "
                "random_state=97, max_iter='auto')\nica.fit(raw)"
            ),
            info_before=_brief(self.raw), info_after=_brief(self.raw),
            replayable=False,
        )

    @_synchronized
    def set_ica_exclude(self, exclude: list[int]) -> None:
        if self.ica is None:
            raise ValueError("No ICA fitted yet")
        self.ica.exclude = sorted(set(exclude))

    @_synchronized
    def apply_ica(self) -> None:
        if self.ica is None:
            raise ValueError("No ICA fitted yet")
        before = _brief(self.raw)
        self.ica.apply(self.raw, verbose="ERROR")
        entry = self.ledger.append(
            "apply_ica", {"exclude": list(self.ica.exclude)},
            label=f"Apply ICA, removed {list(self.ica.exclude)}",
            template="ica.exclude = {exclude}\nica.apply(raw)",
            info_before=before, info_after=_brief(self.raw),
            replayable=False,
        )
        self._ica_checkpoints[entry.seq] = self.raw.copy()  # snapshot AFTER apply

    # --- provenance: replay / revert / codegen ---------------------------

    # --- channels ---------------------------------------------------------

    @_synchronized
    def rename_channels(self, mapping: dict[str, str]) -> None:
        before = _brief(self.raw)
        self.raw.rename_channels(mapping)
        self.ledger.append(
            "rename_channels", {"mapping": dict(mapping)},
            label=f"Rename {len(mapping)} channel{'s' if len(mapping) != 1 else ''}",
            template="raw.rename_channels({mapping!r})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def set_channel_types(self, mapping: dict[str, str]) -> None:
        before = _brief(self.raw)
        self.raw.set_channel_types(mapping, verbose="ERROR")
        self.ledger.append(
            "set_channel_types", {"mapping": dict(mapping)},
            label=f"Retype {len(mapping)} channel{'s' if len(mapping) != 1 else ''}",
            template="raw.set_channel_types({mapping!r})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def drop_channels(self, channels: list[str]) -> None:
        keep = [c for c in channels if c in self.raw.ch_names]
        if not keep:
            raise ValueError("None of those channels are in this recording")
        if len(keep) >= len(self.raw.ch_names):
            raise ValueError("Refusing to drop every channel")
        before = _brief(self.raw)
        self.raw.drop_channels(keep)
        self.ledger.append(
            "drop_channels", {"channels": keep},
            label=f"Drop {', '.join(keep[:3])}{'...' if len(keep) > 3 else ''}",
            template="raw.drop_channels({channels!r})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def reorder_channels(self, order: list[str]) -> None:
        keep = [c for c in order if c in self.raw.ch_names]
        before = _brief(self.raw)
        self.raw.reorder_channels(keep)
        self.ledger.append(
            "reorder_channels", {"order": keep},
            label=f"Reorder {len(keep)} channels",
            template="raw.reorder_channels({order!r})",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def detect_bad_channels(self, threshold: float, n_neighbors: int) -> list[str]:
        """Local Outlier Factor over channel covariance: MNE's answer to the
        channel-rejection half of EEGLAB's clean_rawdata."""
        before = _brief(self.raw)
        picks = mne.pick_types(self.raw.info, eeg=True, exclude=())
        n_neighbors = max(2, min(n_neighbors, len(picks) - 1))
        found = mne.preprocessing.find_bad_channels_lof(
            self.raw, n_neighbors=n_neighbors, threshold=threshold,
            picks="eeg", verbose="ERROR")
        merged = sorted(set(self.raw.info["bads"]) | set(found))
        _set_bads(self.raw, merged)
        self.ledger.append(
            "detect_bad_channels",
            {"threshold": threshold, "n_neighbors": n_neighbors, "found": merged},
            label=f"Detected {len(found)} bad channel{'s' if len(found) != 1 else ''}",
            template=("raw.info['bads'] = mne.preprocessing.find_bad_channels_lof("
                      "raw, n_neighbors={n_neighbors}, threshold={threshold})"),
            info_before=before, info_after=_brief(self.raw),
        )
        return list(found)

    # --- annotations ------------------------------------------------------

    @_synchronized
    def set_annotations(self, annotations: list[dict]) -> None:
        """Replace the whole annotation set. The UI edits a list and sends it
        back whole, which keeps the ledger entry replayable as one value."""
        before = _brief(self.raw)
        self.raw.set_annotations(mne.Annotations(
            onset=[float(a["onset"]) for a in annotations],
            duration=[float(a.get("duration", 0.0)) for a in annotations],
            description=[str(a["description"]) for a in annotations],
        ))
        self.ledger.append(
            "set_annotations", {"annotations": annotations},
            label=f"{len(annotations)} annotation{'s' if len(annotations) != 1 else ''}",
            template="raw.set_annotations(mne.Annotations(**{annotations!r}))",
            info_before=before, info_after=_brief(self.raw),
        )

    @_synchronized
    def annotate_muscle(self, threshold: float, min_length_good: float) -> int:
        """z-scored high-frequency power over the whole recording, which is what
        muscle artifact looks like. Appends rather than replaces."""
        before = _brief(self.raw)
        annot, _ = mne.preprocessing.annotate_muscle_zscore(
            self.raw, threshold=threshold, ch_type="eeg",
            min_length_good=min_length_good, filter_freq=(110, 140)
            if self.raw.info["sfreq"] > 300 else (95, min(self.raw.info["sfreq"] / 2 - 1, 120)),
            verbose="ERROR")
        found = [{"onset": float(o), "duration": float(d), "description": str(desc)}
                 for o, d, desc in zip(annot.onset, annot.duration, annot.description)]
        self.raw.set_annotations(self.raw.annotations + annot)
        self.ledger.append(
            "annotate_muscle",
            {"threshold": threshold, "min_length_good": min_length_good, "found": found},
            label=f"{len(found)} muscle segment{'s' if len(found) != 1 else ''}",
            template=("annot, _ = mne.preprocessing.annotate_muscle_zscore("
                      "raw, threshold={threshold}, ch_type='eeg', "
                      "min_length_good={min_length_good})\nraw.set_annotations(raw.annotations + annot)"),
            info_before=before, info_after=_brief(self.raw),
        )
        return len(found)

    # --- ICA classification ----------------------------------------------

    @_synchronized
    def label_ica(self) -> list[dict]:
        """ICLabel: the classifier EEGLAB users reach for. Needs an average
        reference and a 1-100 Hz band, which is what the model was trained on."""
        from mne_icalabel import label_components

        if self.ica is None:
            raise ValueError("Fit an ICA first")
        work = self.raw.copy().pick("eeg")
        if not work.info["custom_ref_applied"]:
            work.set_eeg_reference("average", verbose="ERROR")
        result = label_components(work, self.ica, method="iclabel")
        self.ica_labels = [
            {"index": i, "label": str(lbl), "prob": float(p)}
            for i, (lbl, p) in enumerate(zip(result["labels"], result["y_pred_proba"]))
        ]
        self.ledger.append(
            "label_ica", {},
            label=f"Classified {len(self.ica_labels)} components",
            template="from mne_icalabel import label_components\nlabel_components(raw, ica, method='iclabel')",
            replayable=False,
        )
        return self.ica_labels

    @_synchronized
    def exclude_ica_by_label(self, labels: list[str], min_prob: float) -> list[int]:
        if self.ica is None:
            raise ValueError("Fit an ICA first")
        if not self.ica_labels:
            raise ValueError("Classify the components first")
        wanted = {l.lower() for l in labels}
        picked = sorted({c["index"] for c in self.ica_labels
                         if c["label"].lower() in wanted and c["prob"] >= min_prob})
        self.ica.exclude = picked
        self.ledger.append(
            "exclude_ica_by_label",
            {"labels": list(labels), "min_prob": min_prob, "excluded": picked},
            label=f"Marked {len(picked)} component{'s' if len(picked) != 1 else ''} for removal",
            template="ica.exclude = {excluded!r}",
            replayable=False,
        )
        return picked

    # --- epochs, evoked, time-frequency -----------------------------------

    @_synchronized
    def make_epochs(self, tmin: float, tmax: float, description: Optional[str],
                    baseline: bool, reject_uv: Optional[float]) -> None:
        """Cut trials. Events come from annotations when there are any worth
        using, and otherwise from a fixed-length grid, so a resting recording
        still reaches the epoch-shaped half of MNE."""
        before = _brief(self.raw)
        reject = {"eeg": reject_uv * 1e-6} if reject_uv else None
        base = (None, 0) if baseline else None

        annots = self.raw.annotations
        usable = [d for d in set(annots.description) if not str(d).upper().startswith("BAD")]
        if description:
            usable = [d for d in usable if d == description]

        if usable:
            events, event_id = mne.events_from_annotations(
                self.raw, event_id={d: i + 1 for i, d in enumerate(sorted(usable))},
                verbose="ERROR")
            source = f"annotations ({', '.join(sorted(usable))})"
            epochs = mne.Epochs(self.raw, events, event_id=event_id, tmin=tmin, tmax=tmax,
                                baseline=base, reject=reject, preload=True, verbose="ERROR")
        else:
            duration = max(0.1, tmax - tmin)
            events = mne.make_fixed_length_events(self.raw, duration=duration, overlap=0.0)
            epochs = mne.Epochs(self.raw, events, tmin=0, tmax=duration, baseline=base,
                                reject=reject, preload=True, verbose="ERROR")
            source = f"fixed length ({duration:g}s)"

        if len(epochs) == 0:
            raise ValueError("No epochs survived: loosen the rejection threshold")
        self.epochs = epochs
        self.evoked = None
        self.tfr = None
        self.ledger.append(
            "make_epochs",
            {"tmin": tmin, "tmax": tmax, "description": description,
             "baseline": baseline, "reject_uv": reject_uv},
            label=f"{len(epochs)} epochs from {source}",
            template=("events = mne.make_fixed_length_events(raw, duration={tmax})\n"
                      "epochs = mne.Epochs(raw, events, tmin={tmin}, tmax={tmax}, preload=True)"),
            info_before=before, info_after=_brief(self.raw), replayable=False,
        )

    @_synchronized
    def average_epochs(self, condition: Optional[str]) -> None:
        if self.epochs is None:
            raise ValueError("Create epochs first")
        source = self.epochs[condition] if condition else self.epochs
        self.evoked = source.average()
        self.ledger.append(
            "average_epochs", {"condition": condition},
            label=f"Evoked from {len(source)} epochs" + (f" ({condition})" if condition else ""),
            template="evoked = epochs.average()",
            replayable=False,
        )

    @_synchronized
    def compute_tfr(self, fmin: float, fmax: float, n_freqs: int, decim: int) -> None:
        import numpy as np

        if self.epochs is None:
            raise ValueError("Create epochs first")
        freqs = np.linspace(fmin, fmax, max(2, n_freqs))
        n_cycles = np.maximum(2.0, freqs / 2.0)
        self.tfr = self.epochs.compute_tfr(
            method="morlet", freqs=freqs, n_cycles=n_cycles, average=True,
            decim=max(1, decim), return_itc=False, verbose="ERROR")
        self.ledger.append(
            "compute_tfr", {"fmin": fmin, "fmax": fmax, "n_freqs": n_freqs, "decim": decim},
            label=f"Morlet TFR {fmin:g}-{fmax:g} Hz",
            template=("freqs = np.linspace({fmin}, {fmax}, {n_freqs})\n"
                      "power = epochs.compute_tfr('morlet', freqs=freqs, "
                      "n_cycles=freqs/2, average=True, decim={decim})"),
            replayable=False,
        )

    @_synchronized
    def replay(self, seq: int) -> mne.io.BaseRaw:
        """Rebuild the Raw as it stood at ledger entry ``seq`` (0 = pristine).

        Walks the branch path root→seq. Deterministic ops re-run from the
        pristine ``original_raw``; if an ICA-apply checkpoint sits on the path,
        replay resumes from that (post-apply) snapshot instead.
        """
        path = self.ledger.path_to(seq)
        raw = self.original_raw.copy()
        skip_through = 0
        for entry in path:
            snap = self._ica_checkpoints.get(entry.seq)
            if snap is not None and entry.seq > skip_through:
                raw = snap.copy()
                skip_through = entry.seq
        for entry in path:
            if entry.seq <= skip_through:
                continue
            fn = _REPLAY_DISPATCH.get(entry.op)
            if fn is not None:
                fn(raw, entry.params)
        return raw

    @_synchronized
    def revert(self, to_seq: int) -> None:
        """Check out ledger entry ``to_seq`` (0 = pristine). Nothing is deleted -
        applying an op from here forks a new branch off ``to_seq``."""
        self.raw = self.replay(to_seq)
        self.ledger.set_head(to_seq)
        path = self.ledger.current_path()
        path_ops = {e.op for e in path}
        # re-derive state that isn't carried on the Raw
        if "fit_ica" not in path_ops:
            self.ica = None
        montage_steps = [e for e in path if e.op == "set_montage"]
        self.montage_name = montage_steps[-1].params["montage_name"] if montage_steps else None
        self.epochs = None

    @_synchronized
    def to_python(self) -> str:
        """Emit a runnable MNE script that reproduces this session."""
        head = [
            '"""Generated by Sema: reproduces the cleaning pipeline for',
            f"    {self.filename}",
            '"""',
            "import mne",
            "",
            f"# raw = mne.io.read_raw_...({self.filename!r}, preload=True)",
            "raw.load_data()",
            "",
        ]
        body = [entry.render() for entry in self.ledger.current_path()]
        if not body:
            body = ["# (no operations recorded yet)"]
        tail = ["", "raw.save('sema_cleaned_raw.fif', overwrite=True)"]
        return "\n".join(head + body + tail) + "\n"


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self, filename: str, raw: mne.io.BaseRaw) -> Session:
        session_id = uuid.uuid4().hex[:12]
        session = Session(id=session_id, filename=filename, raw=raw)
        with self._lock:
            self._sessions[session_id] = session
        # write an initial bundle so a refresh survives even before the first op
        from app.services import persistence
        persistence.save_async(session)
        return session

    def get(self, session_id: str) -> Session:
        with self._lock:
            session = self._sessions.get(session_id)
        if session is None:
            # not resident: try to rehydrate from an on-disk bundle (P0.11)
            from app.services import persistence
            if persistence.exists(session_id):
                try:
                    session = persistence.load(session_id)
                    with self._lock:
                        self._sessions[session_id] = session
                except Exception:
                    session = None
        if session is None:
            raise KeyError(f"No session with id {session_id!r} (expired or never existed)")
        session.touch()
        return session

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def active_count(self) -> int:
        with self._lock:
            return len(self._sessions)

    def sweep_expired(self) -> int:
        cutoff = time.time() - SESSION_TTL_SECONDS
        with self._lock:
            expired = [sid for sid, s in self._sessions.items() if s.last_used < cutoff]
            for sid in expired:
                del self._sessions[sid]
        return len(expired)

    def session_dir(self, session_id: str) -> Path:
        d = WORKDIR / session_id
        d.mkdir(parents=True, exist_ok=True)
        return d


# Single process-wide instance: imported by the API routers.
sessions = SessionManager()
