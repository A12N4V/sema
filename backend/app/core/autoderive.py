"""Derive the epoched and decomposed views automatically, on load.

**The problem this solves.** Half the workspaces (ICA, Epochs, Evoked, TFR,
Source) used to open locked, with a form and a button in place of a figure. A
first-time user could not see what the tool did without first knowing which
operation to run, which is backwards: you look in order to decide, and this made
you decide in order to look.

So: as soon as a recording is open, run a default chain on a **working copy** and
hand every one of those surfaces something real to show.

**What this must not do**, and the reason it is a separate module rather than a
loop over `run_op`:

* It must not touch ``session.raw``. Everything below is derived from a filtered
  copy, so the signal the user is looking at and cleaning is untouched.
* It must not write ledger entries. The ledger is the promise that
  ``pipeline.py`` reproduces *what you did*, and a script full of steps the user
  never chose would quietly break that. These results are marked ``auto`` and
  are replaced the moment the user runs the real operation.

Because they are assumption-laden, every one carries its assumptions with it:
`session.derived` is a list of `Derivation` records that the UI shows as a
disclaimer on the pane and, in full, in a dialog behind a warning triangle. A
default is only defensible if it says what it assumed.
"""
from __future__ import annotations

import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

import mne
import numpy as np

log = logging.getLogger(__name__)

# The defaults, in one place, because they are quoted to the user verbatim.
HP, LP = 1.0, 100.0         # Hz, the band ICLabel was trained on
N_COMPONENTS = 15
EPOCH_TMIN, EPOCH_TMAX = -0.2, 0.8
FIXED_EPOCH_LEN = 1.0       # s, when the recording carries no events
TFR_FMIN, TFR_FMAX, TFR_NFREQS = 4.0, 40.0, 24
SOURCE_METHOD = "dSPM"      # the MNE default for a template-MRI EEG inverse


@dataclass
class Derivation:
    """One auto-computed container, and the honest small print behind it."""
    container: str                 # "ica" | "epochs" | "evoked" | "tfr" | "source"
    label: str                     # one line, shown on the pane
    call: str                      # the MNE call, so it can be reproduced by hand
    assumptions: list[str] = field(default_factory=list)
    seconds: float = 0.0


def _working_copy(raw: mne.io.BaseRaw) -> tuple[mne.io.BaseRaw, list[str]]:
    """A band-passed, average-referenced copy, and what that cost in assumptions.

    ICA on unfiltered data is dominated by drift, and ICLabel was trained on
    average-referenced 1-100 Hz data. Neither is a preference; both are what the
    methods need to mean anything.
    """
    # A 100 Hz low-pass is above Nyquist on anything sampled below 200 Hz, and
    # MNE raises rather than clamping, so clamp here.
    nyq = raw.info["sfreq"] / 2.0
    lp = min(LP, nyq * 0.8)
    notes = [
        f"Computed on a copy band-passed {HP:g}-{lp:g} Hz. Your recording was not modified.",
    ]
    work = raw.copy().pick("eeg")
    work.filter(l_freq=HP, h_freq=lp, verbose="ERROR")
    if work.info["bads"]:
        notes.append(f"{len(work.info['bads'])} channel(s) marked bad were excluded.")
    work.set_eeg_reference("average", verbose="ERROR")
    notes.append("Average-referenced, which is what ICLabel's classifier expects.")
    return work, notes


def _derive_ica(pending, work: mne.io.BaseRaw, base_notes: list[str]) -> Optional[Derivation]:
    t0 = time.time()
    n_ok = len(mne.pick_types(work.info, eeg=True, exclude="bads"))
    n = int(min(N_COMPONENTS, max(2, n_ok - 1)))
    # Picard in its extended, non-orthogonal mode, which converges to the same
    # solution as extended infomax. That matters because ICLabel was trained on
    # infomax decompositions and its probabilities mean less on anything else;
    # it warns about fastica for exactly this reason. Picard gets there in a few
    # seconds where infomax took a hundred, which is the difference between a
    # pass that runs on load and one that cannot.
    #
    # decim=3 fits on every third sample. Standard practice, and ICA needs
    # enough samples per weight, not every sample.
    ica = mne.preprocessing.ICA(n_components=n, method="picard",
                                fit_params=dict(ortho=False, extended=True),
                                random_state=97, max_iter="auto", verbose="ERROR")
    ica.fit(work, decim=3, verbose="ERROR")
    pending["ica"] = ica
    notes = list(base_notes) + [
        f"{n} components, the default. The right number depends on your rank and channel count.",
        "Picard, extended and non-orthogonal: the fast equivalent of the extended\n"
        "         infomax decomposition ICLabel was trained on.",
        "Fitted on every third sample (decim=3), which is standard and keeps the pass quick.",
        "random_state=97, so the decomposition is reproducible rather than merely stable.",
        "Nothing is excluded. Marking components for removal is still your call.",
    ]

    # ICLabel is optional: it pulls onnxruntime, and a missing backend must
    # degrade to "no labels" rather than to "no ICA".
    try:
        from mne_icalabel import label_components
        res = label_components(work, ica, method="iclabel")
        pending["ica_labels"] = [
            {"label": str(lbl), "prob": float(p)}
            for lbl, p in zip(res["labels"], np.max(res["y_pred_proba"], axis=-1)
                              if getattr(res["y_pred_proba"], "ndim", 1) > 1 else res["y_pred_proba"])
        ]
        notes.append("Classified with ICLabel; the class and confidence on each card are its output, not a rule.")
    except Exception as e:  # noqa: BLE001
        log.info("auto ICLabel skipped: %s", e)
        notes.append("ICLabel was unavailable, so components are unclassified.")

    return Derivation(
        container="ica",
        label=f"ICA, {n} components, fitted automatically",
        call=f"ica = mne.preprocessing.ICA(n_components={n}, method='picard',\n                            fit_params=dict(ortho=False, extended=True), random_state=97)\nica.fit(raw_copy, decim=3)",
        assumptions=notes,
        seconds=time.time() - t0,
    )


def _derive_epochs(pending, work: mne.io.BaseRaw, base_notes: list[str]) -> Optional[Derivation]:
    t0 = time.time()
    notes = list(base_notes)
    annot = work.annotations
    usable = [d for d in (annot.description if annot is not None else [])
              if not str(d).upper().startswith("BAD")]

    if usable:
        events, event_id = mne.events_from_annotations(work, verbose="ERROR")
        call = (f"events, event_id = mne.events_from_annotations(raw_copy)\n"
                f"epochs = mne.Epochs(raw_copy, events, tmin={EPOCH_TMIN}, tmax={EPOCH_TMAX}, preload=True)")
        notes.append(f"Trials cut around every annotation ({len(set(usable))} kind(s)), "
                     f"{EPOCH_TMIN:g} to {EPOCH_TMAX:g} s.")
        notes.append("All annotation types are pooled. Contrasting conditions is a choice you have to make.")
        epochs = mne.Epochs(work, events, event_id=event_id, tmin=EPOCH_TMIN, tmax=EPOCH_TMAX,
                            baseline=(None, 0), preload=True, verbose="ERROR")
    else:
        events = mne.make_fixed_length_events(work, duration=FIXED_EPOCH_LEN)
        call = (f"events = mne.make_fixed_length_events(raw_copy, duration={FIXED_EPOCH_LEN:g})\n"
                f"epochs = mne.Epochs(raw_copy, events, tmin=0, tmax={FIXED_EPOCH_LEN:g}, preload=True)")
        notes.append(f"The recording carries no events, so trials are a fixed {FIXED_EPOCH_LEN:g} s grid. "
                     "These are arbitrary windows, not responses to anything.")
        epochs = mne.Epochs(work, events, tmin=0, tmax=FIXED_EPOCH_LEN,
                            baseline=None, preload=True, verbose="ERROR")

    if len(epochs) == 0:
        return None
    notes.append("No amplitude rejection was applied, so bad trials are still in.")
    pending["epochs"] = epochs
    return Derivation(
        container="epochs",
        label=f"{len(epochs)} trials, cut automatically",
        call=call,
        assumptions=notes,
        seconds=time.time() - t0,
    )


def _derive_evoked(pending, epochs, base_notes: list[str]) -> Optional[Derivation]:
    t0 = time.time()
    if epochs is None or len(epochs) == 0:
        return None
    pending["evoked"] = epochs.average()
    return Derivation(
        container="evoked",
        label=f"Average of {len(epochs)} trials",
        call="evoked = epochs.average()",
        assumptions=list(base_notes) + [
            "Every trial is averaged together. With no conditions separated, this is a grand average.",
            "An average over arbitrary windows has no evoked response to show; it mostly shows noise falling off.",
        ],
        seconds=time.time() - t0,
    )


def _derive_tfr(pending, epochs, base_notes: list[str]) -> Optional[Derivation]:
    t0 = time.time()
    if epochs is None or len(epochs) == 0:
        return None
    freqs = np.linspace(TFR_FMIN, TFR_FMAX, TFR_NFREQS)
    pending["tfr"] = epochs.compute_tfr(
        "morlet", freqs=freqs, n_cycles=freqs / 2, average=True, decim=3, verbose="ERROR")
    return Derivation(
        container="tfr",
        label=f"Morlet power, {TFR_FMIN:g}-{TFR_FMAX:g} Hz",
        call=(f"freqs = np.linspace({TFR_FMIN:g}, {TFR_FMAX:g}, {TFR_NFREQS})\n"
              f"power = epochs.compute_tfr('morlet', freqs=freqs, n_cycles=freqs/2, average=True, decim=3)"),
        assumptions=list(base_notes) + [
            f"Morlet wavelets, {TFR_NFREQS} linearly spaced frequencies, n_cycles = f/2. "
            "That trades frequency resolution for time resolution at the low end.",
            "Decimated by 3 in time to keep the pass quick.",
            "Shown as dB against the pre-event baseline where one exists.",
        ],
        seconds=time.time() - t0,
    )


def _derive_source(session, base_notes: list[str]) -> Optional[Derivation]:
    """The inverse solution, but only when fsaverage is already on disk.

    This is the one stage that can be genuinely expensive: the forward solution
    over the fsaverage BEM runs 15-20 s the first time a given montage is seen,
    and the template itself is a 770 MB download. So the download is never
    triggered here (`fsaverage_ready` only looks at the disk) and the forward is
    cached by montage, which makes every recording after the first one on the
    same cap about a second.
    """
    from app.core import source as src

    t0 = time.time()
    if not src.fsaverage_ready():
        return None                     # the workspace stays locked and says why

    # Deliberately on `session.raw`, not the band-passed working copy: the
    # inverse is applied to the signal the user is actually looking at, so the
    # brain and the traces under the cursor are the same data. The average
    # reference this needs is applied as a projection inside `compute_source_estimate`.
    # Centred half a window in, not at t=0. `compute_source_estimate` solves
    # `_WINDOW` seconds *around* `center_t` and clamps at the start of the
    # recording, so centring at 0 yields [0, 4] while the cursor opens at the
    # middle of the first 10 s view. The pane then greeted you with "cursor 5.0s
    # is outside the localised window" and a button, which is precisely the
    # locked-behind-a-form experience this pass exists to remove.
    center = src._WINDOW / 2.0
    with session.lock:
        # Re-checked inside the lock, not just at the top of the pass: the user
        # can run `compute_source` themselves while this job is still going, and
        # this stage writes straight onto the session.
        if "source" in owned_by_user(session):
            return None
        meta = src.compute_source_estimate(session, method=SOURCE_METHOD, center_t=center)

    return Derivation(
        container="source",
        label=f"{SOURCE_METHOD} on the fsaverage template, first {meta['tmax'] - meta['tmin']:.0f} s",
        call=("fwd = mne.make_forward_solution(raw.info, trans='fsaverage', src=src, bem=bem)\n"
              "cov = mne.make_ad_hoc_cov(raw.info)\n"
              "inv = make_inverse_operator(raw.info, fwd, cov, loose=0.2, depth=0.8)\n"
              f"stc = apply_inverse_raw(raw, inv, 1/9, method='{SOURCE_METHOD}')"),
        assumptions=[
            "The fsaverage template head, not your subject's MRI. Absolute positions "
            "are approximate; anything near the midline or deep is the least trustworthy.",
            "Electrodes are fitted to the template by the standard montage transform, "
            "so a cap that sat differently on the head shifts the whole solution.",
            "An ad-hoc noise covariance, because no empty-room or baseline period was "
            "identified. A real covariance from your own baseline is strictly better.",
            "loose=0.2, depth=0.8, SNR 3. MNE's documented defaults, not a fit to your data.",
            f"Solved over the first {meta['tmax'] - meta['tmin']:.0f} s only. "
            "Moving the cursor elsewhere recomputes the window there.",
        ],
        seconds=time.time() - t0,
    )


def owned_by_user(session) -> set[str]:
    """Containers holding the user's own work, which this pass must never touch.

    A session that has been worked in still runs this pass on every reload,
    because the render cache is keyed by state and the state moved. Without this
    guard, reopening a tab after an hour of real analysis silently overwrote the
    user's epochs with the automatic ones and re-badged them as "automatic" -
    the exact inversion of the promise the disclaimer makes.

    A container is fair game only if it is empty, or if what is in it is this
    pass's own earlier output.
    """
    auto = {(d if isinstance(d, dict) else d.__dict__)["container"]
            for d in (getattr(session, "derived", []) or [])}
    have = set()
    if session.ica is not None:
        have.add("ica")
    if session.epochs is not None:
        have.add("epochs")
    if getattr(session, "evoked", None) is not None:
        have.add("evoked")
    if getattr(session, "tfr", None) is not None:
        have.add("tfr")
    if getattr(session, "stc", None) is not None:
        have.add("source")
    return have - auto


def derive(session, *, job: Any = None) -> list[Derivation]:
    """Fill the empty workspaces. Never raises: a failed stage is skipped."""
    from app.core.containers import session_capabilities

    caps = session_capabilities(session)
    if "montage" not in caps:
        return []                       # nothing downstream is meaningful without positions

    with session.lock:
        work, base_notes = _working_copy(session.raw)

    theirs = owned_by_user(session)
    # Anything downstream of a container the user built is theirs too: their
    # epochs must not be averaged into an "automatic" evoked behind their back.
    if "epochs" in theirs:
        theirs |= {"evoked", "tfr"}

    # Results land here first and are committed onto the session under its lock
    # at the end. The ICA fit takes seconds and cannot hold the lock for them,
    # so a user who hits "Fit ICA" while this job is still running would
    # otherwise have their decomposition overwritten by this one a moment later.
    pending: dict[str, Any] = {}
    stages: list[tuple[str, str, Any]] = [
        ("ica", "fitting ICA", lambda: _derive_ica(pending, work, base_notes)),
        ("epochs", "cutting epochs", lambda: _derive_epochs(pending, work, base_notes)),
        ("evoked", "averaging", lambda: _derive_evoked(pending, pending.get("epochs"), base_notes)),
        ("tfr", "time-frequency", lambda: _derive_tfr(pending, pending.get("epochs"), base_notes)),
        ("source", "localising sources", lambda: _derive_source(session, base_notes)),
    ]

    out: list[Derivation] = []
    for i, (container, label, fn) in enumerate(stages):
        if container in theirs:
            continue
        if job is not None:
            job.progress = i / len(stages)
            job.detail = label
        try:
            d = fn()
            if d is not None:
                out.append(d)
        except Exception as e:  # noqa: BLE001
            # One underivable view must not cost the others. Logged, not
            # swallowed: a silent skip here looks identical to "not supported".
            log.warning("auto-derive %s failed: %s", label, e)

    with session.lock:
        # Last check, on the state as it is now rather than as it was when the
        # pass started. Whatever the user claimed in the meantime is theirs.
        theirs = owned_by_user(session)
        if "epochs" in theirs:
            theirs |= {"evoked", "tfr"}
        for name in ("ica", "epochs", "evoked", "tfr"):
            if name in pending and name not in theirs:
                setattr(session, name, pending[name])
        if "ica" in pending and "ica" not in theirs:
            session.ica_labels = pending.get("ica_labels", [])
        out = [d for d in out if d.container not in theirs]

        # Merge rather than replace. A stage that succeeded last pass and failed
        # this one leaves its object on the session; dropping the record would
        # strip the badge off content the user still did not ask for, which is
        # the one direction this must never fail in.
        merged = {rec["container"] if isinstance(rec, dict) else rec.container: rec
                  for rec in (getattr(session, "derived", []) or [])
                  if (rec["container"] if isinstance(rec, dict) else rec.container) not in theirs}
        merged.update({d.container: d for d in out})
        session.derived = list(merged.values())
    out = list(session.derived)
    if job is not None:
        job.progress = 1.0
    return out


# --------------------------------------------------------------------- cache
#
# The pass costs a few seconds of ICA. Doing it again for every session opened
# on the same file is pure waste, so results are cached under a hash of the
# *recording*, not of the session: reopen the same EDF tomorrow, in a new
# session, and this is a load rather than a fit.

def recording_key(raw: mne.io.BaseRaw) -> str:
    """A stable id for the recording itself.

    Deliberately not the session id (new every open) and not the state hash
    (moves with every edit). Channel names, rate, length and a sample of the
    data: enough that two different recordings cannot collide, cheap enough to
    compute on load.
    """
    import hashlib

    h = hashlib.sha1()
    h.update("|".join(raw.ch_names).encode())
    h.update(f"{raw.info['sfreq']:.4f}|{raw.n_times}".encode())
    # a thin slice of the signal, so two recordings with identical headers but
    # different data do not share a cache entry
    step = max(1, raw.n_times // 512)
    h.update(np.ascontiguousarray(
        raw.get_data(picks=slice(0, min(4, raw.info["nchan"])), stop=raw.n_times)[:, ::step]
    ).tobytes())
    return h.hexdigest()[:16]


def _cache_dir(key: str):
    from app.core.paths import DATA_DIR

    d = DATA_DIR / "derived" / key
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_cached(session) -> Optional[list[Derivation]]:
    """Rehydrate a previous pass for this recording, or None.

    Reads first, commits under the lock, exactly like `derive`. Checking
    ownership once at the top and then assigning was not enough: reading four
    MNE files off disk takes long enough for the user to run `make_epochs` in
    between, and the assignment then landed on top of the epochs they had just
    cut and badged them "automatic" again.
    """
    import json

    with session.lock:
        key = recording_key(session.original_raw or session.raw)
    d = _cache_dir(key)
    manifest = d / "manifest.json"
    if not manifest.exists():
        return None
    try:
        meta = json.loads(manifest.read_text())
        if meta.get("version") != CACHE_VERSION:
            return None

        pending: dict[str, Any] = {}
        if (d / "ica.fif").exists():
            pending["ica"] = mne.preprocessing.read_ica(d / "ica.fif", verbose="ERROR")
            pending["ica_labels"] = meta.get("ica_labels", [])
        if (d / "epochs-epo.fif").exists():
            pending["epochs"] = mne.read_epochs(d / "epochs-epo.fif", preload=True, verbose="ERROR")
        if (d / "evoked-ave.fif").exists():
            pending["evoked"] = mne.read_evokeds(d / "evoked-ave.fif", verbose="ERROR")[0]
        if (d / "tfr-tfr.h5").exists():
            # MNE 1.12 returns the TFR itself; older versions returned a list of
            # them. Subscripting the new shape raises "not subscriptable", which
            # sent every reopen back through a full refit.
            tfr = mne.time_frequency.read_tfrs(d / "tfr-tfr.h5")
            pending["tfr"] = tfr[0] if isinstance(tfr, list) else tfr
        if (d / "stc-lh.stc").exists():
            pending["stc"] = mne.read_source_estimate(str(d / "stc"), subject="fsaverage")
            pending["stc_meta"] = meta.get("stc_meta", {})

        with session.lock:
            theirs = owned_by_user(session)
            if "epochs" in theirs:
                theirs |= {"evoked", "tfr"}
            for name in ("ica", "epochs", "evoked", "tfr"):
                if name in pending and name not in theirs:
                    setattr(session, name, pending[name])
            if "ica" in pending and "ica" not in theirs:
                session.ica_labels = pending.get("ica_labels", [])
            if "stc" in pending and "source" not in theirs:
                session.stc = pending["stc"]
                session.stc_meta = pending.get("stc_meta", {})
            # A record for a container the user owns would badge their own work
            # as automatic, so those are dropped rather than restored.
            session.derived = [Derivation(**r) for r in meta.get("derivations", [])
                               if r.get("container") not in theirs]
        return session.derived
    except Exception as e:  # noqa: BLE001
        log.warning("derived cache for %s unreadable, recomputing: %s", key, e)
        return None


def save_cached(session, derivations: list[Derivation]) -> None:
    """Persist only what this pass produced.

    The cache is keyed by the *recording*, so it is shared with every future
    session opened on the same file. Writing the user's hand-tuned epochs into
    it would hand their choices to someone else's session as this program's
    defaults, badged as automatic.
    """
    import json

    made = {d.container for d in derivations}

    with session.lock:
        key = recording_key(session.original_raw or session.raw)
    d = _cache_dir(key)
    try:
        if "ica" in made and session.ica is not None:
            session.ica.save(d / "ica.fif", overwrite=True, verbose="ERROR")
        if "epochs" in made and session.epochs is not None:
            session.epochs.save(d / "epochs-epo.fif", overwrite=True, verbose="ERROR")
        if "evoked" in made and session.evoked is not None:
            mne.write_evokeds(d / "evoked-ave.fif", session.evoked, overwrite=True, verbose="ERROR")
        if "tfr" in made and session.tfr is not None:
            session.tfr.save(d / "tfr-tfr.h5", overwrite=True, verbose="ERROR")
        if "source" in made and getattr(session, "stc", None) is not None:
            # writes stc-lh.stc / stc-rh.stc
            session.stc.save(str(d / "stc"), overwrite=True, verbose="ERROR")
        (d / "manifest.json").write_text(json.dumps({
            "version": CACHE_VERSION,
            "filename": session.filename,
            "saved_at": time.time(),
            "ica_labels": session.ica_labels,
            "stc_meta": getattr(session, "stc_meta", None) or {},
            "derivations": [asdict(x) for x in derivations],
        }, indent=1))
    except Exception as e:  # noqa: BLE001
        log.warning("could not cache the derived views for %s: %s", key, e)


# Bump when the defaults above change, or a cached pass would keep claiming
# assumptions the current code no longer makes.
CACHE_VERSION = 3


def derive_cached(session, *, job: Any = None) -> list[Derivation]:
    """`derive`, but a hit on the recording cache skips the work entirely."""
    hit = load_cached(session)
    if hit is not None:
        if job is not None:
            job.progress, job.detail = 1.0, "restored from cache"
        return hit
    out = derive(session, job=job)
    if out:
        save_cached(session, out)
    return out
