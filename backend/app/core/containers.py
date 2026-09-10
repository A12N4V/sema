"""The container graph: the typed view of "what MNE objects exist in this
session and how they relate".

This is the model the v2 left rail renders and the thing operations declare
their inputs against (see ``core/operations``). For now the graph is derived
from what's attached to the ``Session`` (a Raw always; an ICA / Epochs if one
has been produced). It grows into a real multi-node lineage DAG in P4 when
epochs/evoked can branch: the ``ContainerRef`` shape is already DAG-ready
(``parent_id`` + ``op_id``).

See docs/ARCHITECTURE.md.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:  # avoid a circular import at runtime
    from app.services.session_manager import Session


class ContainerKind(str, Enum):
    RAW = "raw"
    EPOCHS = "epochs"
    EVOKED = "evoked"
    SPECTRUM = "spectrum"
    TFR = "tfr"
    ICA = "ica"
    FORWARD = "forward"
    COVARIANCE = "covariance"
    INVERSE = "inverse"
    STC = "stc"
    DIPOLE = "dipole"


@dataclass
class ContainerRef:
    id: str                       # stable within a session, e.g. "raw", "ica"
    kind: ContainerKind
    label: str                    # human summary for the rail
    parent_id: str | None = None  # lineage edge
    op_id: str | None = None      # the operation that produced it
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind.value,
            "label": self.label,
            "parent_id": self.parent_id,
            "op_id": self.op_id,
            "created_at": self.created_at,
        }


def container_graph(session: "Session") -> list[ContainerRef]:
    """The session's current containers, roots first."""
    info = session.raw.info
    n_eeg = len(session.raw.ch_names)
    nodes = [
        ContainerRef(
            id="raw",
            kind=ContainerKind.RAW,
            label=f"Raw · {n_eeg} ch · {info['sfreq']:.0f} Hz",
        )
    ]
    if session.ica is not None:
        nodes.append(
            ContainerRef(
                id="ica",
                kind=ContainerKind.ICA,
                label=f"ICA · {session.ica.n_components_} comp",
                parent_id="raw",
                op_id="fit_ica",
            )
        )
    if session.epochs is not None:
        nodes.append(
            ContainerRef(
                id="epochs",
                kind=ContainerKind.EPOCHS,
                label=f"Epochs · {len(session.epochs)} trials",
                parent_id="raw",
                op_id="make_epochs",
            )
        )
    if getattr(session, "evoked", None) is not None:
        nodes.append(
            ContainerRef(
                id="evoked",
                kind=ContainerKind.EVOKED,
                label=f"Evoked · {session.evoked.nave} averaged",
                parent_id="epochs",
                op_id="average_epochs",
            )
        )
    if getattr(session, "tfr", None) is not None:
        nodes.append(
            ContainerRef(
                id="tfr",
                kind=ContainerKind.TFR,
                label=f"TFR · {len(session.tfr.freqs)} freqs",
                parent_id="epochs",
                op_id="compute_tfr",
            )
        )
    if getattr(session, "stc", None) is not None:
        meta = session.stc_meta
        nodes.append(
            ContainerRef(
                id="source",
                kind=ContainerKind.STC,
                label=f"Source · {meta.get('method', 'dSPM')}",
                parent_id="raw",
                op_id="compute_source",
            )
        )
    return nodes


def session_capabilities(session: "Session") -> set[str]:
    """Declarative gates the UI uses to show "path to unlock" instead of an
    error (P0.7). Operations list the ones they need in ``Operation.requires``.
    """
    caps: set[str] = set()
    if session.raw.get_montage() is not None:
        caps.add("montage")
    hp = session.raw.info["highpass"] or 0.0
    if hp >= 1.0:
        caps.add("filtered_1hz")
    if session.raw.info["bads"]:
        caps.add("has_bads")
    if session.ica is not None:
        caps.add("ica")
    if session.epochs is not None:
        caps.add("epochs")
    if getattr(session, "evoked", None) is not None:
        caps.add("evoked")
    if getattr(session, "tfr", None) is not None:
        caps.add("tfr")
    if getattr(session, "ica_labels", None):
        caps.add("ica_labels")
    if session.raw.annotations is not None and len(session.raw.annotations):
        caps.add("annotations")
    if getattr(session, "stc", None) is not None:
        caps.add("source")
    try:
        from app.core.source import fsaverage_ready
        if fsaverage_ready():
            caps.add("fsaverage")
    except Exception:
        pass
    return caps


def auto_derived(session) -> dict[str, dict]:
    """Which containers exist only because the auto-derive pass built them.

    The UI needs this to badge those panes. A figure the user did not ask for
    has to say so, or the tool is quietly passing its own defaults off as their
    analysis.
    """
    out: dict[str, dict] = {}
    for d in getattr(session, "derived", []) or []:
        rec = d if isinstance(d, dict) else d.__dict__
        out[rec["container"]] = dict(rec)
    return out


# The container-id lineage, which is fixed: every id in `container_graph` above
# names its parent here. Used to expire auto-derivations downstream of a real
# operation.
_CHILDREN: dict[str, tuple[str, ...]] = {
    "raw": ("ica", "epochs", "source"),
    "epochs": ("evoked", "tfr"),
}

# ContainerKind -> the container id `container_graph` gives it. Identical for
# everything except the source estimate, which is "stc" as a kind and "source"
# as a workspace.
_KIND_TO_ID: dict[ContainerKind, str] = {ContainerKind.STC: "source"}


def clear_derived(session, kind: "ContainerKind | None") -> None:
    """Drop the auto-derivation badge for a container the user just built.

    Without this, running `compute_source` yourself leaves the pane still
    claiming the brain on it is automatic and not part of your pipeline, which
    is now a lie in the direction that matters: it disowns work the user did.

    Descendants go too. Recutting epochs invalidates the evoked and the TFR
    hanging off them, so their derivation records describe objects that no
    longer exist.
    """
    if kind is None:
        return
    root = _KIND_TO_ID.get(kind, kind.value)
    stale = {root}
    queue = [root]
    while queue:
        for child in _CHILDREN.get(queue.pop(), ()):
            if child not in stale:
                stale.add(child)
                queue.append(child)
    session.derived = [d for d in (getattr(session, "derived", []) or [])
                       if (d if isinstance(d, dict) else d.__dict__)["container"] not in stale]
