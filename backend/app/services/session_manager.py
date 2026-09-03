"""In-memory session state + the per-session service object.

A "session" is one recording plus whatever MNE objects have been derived
from it so far (a filtered Raw, a fitted ICA, an Epochs object) *and* an
append-only provenance ledger of every mutating operation.

The ``Session`` class is both the state bag and the service: routers call
``session.filter(...)`` / ``session.set_montage(...)`` etc., each of which
performs the MNE call and records a ``LedgerEntry``. That makes every
endpoint a 3-liner and gives revert / pipeline-export / audit for free.

Kept resident in a process-wide dict — see ARCHITECTURE.md for why this
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

from app.services.ledger import Ledger

SESSION_TTL_SECONDS = 60 * 60 * 2  # 2 hours of inactivity
WORKDIR = Path.home() / ".eegvis" / "sessions"
WORKDIR.mkdir(parents=True, exist_ok=True)


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
    ica: Optional[mne.preprocessing.ICA] = None
    created_at: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)
    # Held by every op that touches raw/epochs/ica. Callers on other threads
    # (threadpooled route handlers) block rather than race an in-place mutation.
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False, compare=False)

    # provenance
    original_raw: Optional[mne.io.BaseRaw] = None      # pristine copy for replay
    ledger: Ledger = field(default_factory=Ledger)
    montage_name: Optional[str] = None
    _ica_checkpoint: Optional[tuple[int, mne.io.BaseRaw]] = None  # (seq, raw snapshot pre-apply)

    def __post_init__(self) -> None:
        if self.original_raw is None:
            self.original_raw = self.raw.copy()

    def touch(self) -> None:
        self.last_used = time.time()

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
    def interpolate_bads(self, reset_bads: bool = True) -> None:
        bads = list(self.raw.info["bads"])
        if not bads:
            raise ValueError("No bad channels marked — nothing to interpolate")
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
        seq = len(self.ledger) + 1
        self._ica_checkpoint = (seq, self.raw.copy())
        self.ica.apply(self.raw, verbose="ERROR")
        self.ledger.append(
            "apply_ica", {"exclude": list(self.ica.exclude)},
            label=f"Apply ICA — removed {list(self.ica.exclude)}",
            template="ica.exclude = {exclude}\nica.apply(raw)",
            info_before=before, info_after=_brief(self.raw),
            replayable=False,
        )

    # --- provenance: replay / revert / codegen ---------------------------

    @_synchronized
    def replay(self, up_to: int) -> mne.io.BaseRaw:
        """Rebuild the Raw as it stood after ledger entry ``up_to`` (1-based).

        Deterministic ops are re-run from the pristine ``original_raw``. If an
        ICA-apply checkpoint sits within range, replay resumes from that
        snapshot instead (ICA fits aren't cheap or perfectly reproducible).
        """
        entries = self.ledger.entries[:up_to]
        start_idx = 0
        raw = self.original_raw.copy()
        if self._ica_checkpoint is not None:
            ckpt_seq, ckpt_raw = self._ica_checkpoint
            if up_to >= ckpt_seq:
                raw = ckpt_raw.copy()
                start_idx = ckpt_seq  # entries before & including the checkpoint are baked in

        for entry in entries[start_idx:]:
            fn = _REPLAY_DISPATCH.get(entry.op)
            if fn is not None:
                fn(raw, entry.params)
        return raw

    @_synchronized
    def revert(self, to_seq: int) -> None:
        """Roll the session back to the state after entry ``to_seq`` (0 = pristine)."""
        self.raw = self.replay(to_seq)
        self.ledger.truncate(to_seq)
        if self._ica_checkpoint is not None and to_seq < self._ica_checkpoint[0]:
            self._ica_checkpoint = None
        # drop the fitted ICA if its fit step was rolled past
        if not any(e.op == "fit_ica" for e in self.ledger.entries):
            self.ica = None
        # re-derive state that isn't carried on the Raw: the montage *name*
        # (the Raw keeps positions, not the label) and any Epochs, which were
        # sliced from a Raw state this revert has just discarded.
        montage_steps = [e for e in self.ledger.entries if e.op == "set_montage"]
        self.montage_name = montage_steps[-1].params["montage_name"] if montage_steps else None
        self.epochs = None

    @_synchronized
    def to_python(self) -> str:
        """Emit a runnable MNE script that reproduces this session."""
        head = [
            '"""Generated by EEGvis — reproduces the cleaning pipeline for',
            f"    {self.filename}",
            '"""',
            "import mne",
            "",
            f"# raw = mne.io.read_raw_...({self.filename!r}, preload=True)",
            "raw.load_data()",
            "",
        ]
        body = [entry.render() for entry in self.ledger.entries]
        if not body:
            body = ["# (no operations recorded yet)"]
        tail = ["", "raw.save('eegvis_cleaned_raw.fif', overwrite=True)"]
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
        return session

    def get(self, session_id: str) -> Session:
        with self._lock:
            session = self._sessions.get(session_id)
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


# Single process-wide instance — imported by the API routers.
sessions = SessionManager()
