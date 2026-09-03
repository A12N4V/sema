"""Provenance ledger — an append-only record of every mutating operation
applied to a session.

One structure, several payoffs:
  * an audit trail the UI can show ("Pipeline" tile),
  * deterministic revert via ``Session.replay(up_to=n)``,
  * a runnable ``pipeline.py`` via ``Session.to_python()`` (each entry carries
    a ``template`` string that renders to an ``mne`` call).

Entries are plain dataclasses so they serialise straight to JSON.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class LedgerEntry:
    seq: int                      # 1-based position in the ledger
    op: str                       # canonical verb: "filter", "notch", "set_montage", ...
    params: dict[str, Any]        # kwargs the op was called with
    label: str                    # human summary: "Band-pass 1–40 Hz"
    template: str                 # python source line(s), ``str.format``-ready against ``params``
    ts: float = field(default_factory=time.time)
    info_before: dict[str, Any] = field(default_factory=dict)
    info_after: dict[str, Any] = field(default_factory=dict)
    replayable: bool = True       # False => needs a snapshot (e.g. ICA apply)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["rendered"] = self.render()
        return d

    def render(self) -> str:
        """The python source line(s) for this step, params substituted in."""
        try:
            return self.template.format(**self.params)
        except (KeyError, IndexError):
            return self.template


class Ledger:
    def __init__(self) -> None:
        self._entries: list[LedgerEntry] = []

    def __len__(self) -> int:
        return len(self._entries)

    def __iter__(self):
        return iter(self._entries)

    @property
    def entries(self) -> list[LedgerEntry]:
        return list(self._entries)

    def append(
        self,
        op: str,
        params: dict[str, Any],
        label: str,
        template: str,
        *,
        info_before: dict[str, Any] | None = None,
        info_after: dict[str, Any] | None = None,
        replayable: bool = True,
    ) -> LedgerEntry:
        entry = LedgerEntry(
            seq=len(self._entries) + 1,
            op=op,
            params=params,
            label=label,
            template=template,
            info_before=info_before or {},
            info_after=info_after or {},
            replayable=replayable,
        )
        self._entries.append(entry)
        return entry

    def truncate(self, keep: int) -> None:
        """Drop everything after entry ``keep`` (1-based). ``keep=0`` clears."""
        self._entries = self._entries[:keep]

    def to_list(self) -> list[dict[str, Any]]:
        return [e.to_dict() for e in self._entries]
