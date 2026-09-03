"""The container graph — the typed view of "what MNE objects exist in this
session and how they relate".

This is the model the v2 left rail renders and the thing operations declare
their inputs against (see ``core/operations``). For now the graph is derived
from what's attached to the ``Session`` (a Raw always; an ICA / Epochs if one
has been produced). It grows into a real multi-node lineage DAG in P4 when
epochs/evoked can branch — the ``ContainerRef`` shape is already DAG-ready
(``parent_id`` + ``op_id``).

See docs/BUILD_PLAN_V2.md P0.1.
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
                label=f"Epochs · {len(session.epochs)}",
                parent_id="raw",
                op_id="epochs",
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
    if getattr(session, "stc", None) is not None:
        caps.add("source")
    try:
        from app.core.source import fsaverage_ready
        if fsaverage_ready():
            caps.add("fsaverage")
    except Exception:
        pass
    return caps
