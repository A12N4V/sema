"""Provenance ledger: a branching DAG of every mutating operation applied
to a session.

Each entry records its ``parent`` (0 = the pristine recording). A ``head``
pointer marks the current leaf. ``revert`` moves the head without deleting
anything, so re-running an op from an earlier point *forks* a new branch and
the old one stays available for comparison .

One structure, several payoffs:
  * an audit trail / "History" tree the UI can show,
  * deterministic checkout via ``Session.replay(seq)`` (walks root→seq),
  * a runnable ``pipeline.py`` for the current path via ``Session.to_python()``.

Entries are plain dataclasses so they serialise straight to JSON.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class LedgerEntry:
    seq: int                      # 1-based, unique across the whole tree
    op: str                       # canonical verb: "filter", "notch", ...
    params: dict[str, Any]        # kwargs the op was called with
    label: str                    # human summary: "Band-pass 1–40 Hz"
    template: str                 # python source line(s), str.format-ready against params
    parent: int = 0               # seq of the entry this was applied on top of (0 = pristine)
    ts: float = field(default_factory=time.time)
    info_before: dict[str, Any] = field(default_factory=dict)
    info_after: dict[str, Any] = field(default_factory=dict)
    replayable: bool = True       # False => needs a snapshot (e.g. ICA apply)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["rendered"] = self.render()
        return d

    def render(self) -> str:
        try:
            return self.template.format(**self.params)
        except (KeyError, IndexError):
            return self.template


class Ledger:
    def __init__(self) -> None:
        self._entries: list[LedgerEntry] = []   # all entries, all branches; never truncated
        self._head: int = 0                     # current leaf seq (0 = pristine)

    def __len__(self) -> int:
        return len(self._entries)

    def __iter__(self):
        return iter(self._entries)

    @property
    def head(self) -> int:
        return self._head

    @property
    def entries(self) -> list[LedgerEntry]:
        """Every entry across every branch."""
        return list(self._entries)

    def _by_seq(self, seq: int) -> LedgerEntry | None:
        return self._entries[seq - 1] if 1 <= seq <= len(self._entries) else None

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
            parent=self._head,
            info_before=info_before or {},
            info_after=info_after or {},
            replayable=replayable,
        )
        self._entries.append(entry)
        self._head = entry.seq
        return entry

    def path_to(self, seq: int) -> list[LedgerEntry]:
        """Entries from the root down to ``seq`` (inclusive), root first."""
        out: list[LedgerEntry] = []
        cur = seq
        seen: set[int] = set()
        while cur != 0:
            if cur in seen:  # defensive against a malformed cycle
                break
            seen.add(cur)
            e = self._by_seq(cur)
            if e is None:
                break
            out.append(e)
            cur = e.parent
        out.reverse()
        return out

    def current_path(self) -> list[LedgerEntry]:
        return self.path_to(self._head)

    def set_head(self, seq: int) -> None:
        if seq != 0 and self._by_seq(seq) is None:
            raise ValueError(f"No ledger entry {seq}")
        self._head = seq

    def leaves(self) -> list[int]:
        """Seqs that are nobody's parent: the tips of every branch."""
        parents = {e.parent for e in self._entries}
        tips = [e.seq for e in self._entries if e.seq not in parents]
        return tips or [0]

    def to_list(self) -> list[dict[str, Any]]:
        on_path = {e.seq for e in self.current_path()}
        out = []
        for e in self._entries:
            d = e.to_dict()
            d["on_path"] = e.seq in on_path
            out.append(d)
        return out
