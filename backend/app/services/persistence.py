"""Session bundles on disk (docs/BUILD_PLAN_V2.md P0.11).

A bundle under ``~/.eegvis/sessions/{id}/`` is:
  bundle.json        filename, montage_name, ledger entries + head
  raw_original.fif    the pristine recording (for replay)
  raw_current.fif     the current signal state (fast reopen, no replay)
  ckpt_<seq>.fif      post-apply snapshot for each ICA-apply step

Auto-saved after each mutating op; reopened on demand so a browser refresh or
a server restart doesn't lose work.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import mne

from app.services.ledger import Ledger, LedgerEntry

WORKDIR = Path.home() / ".eegvis" / "sessions"


def _dir(session_id: str) -> Path:
    d = WORKDIR / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def save(session) -> None:
    d = _dir(session.id)
    try:
        session.raw.save(d / "raw_current.fif", overwrite=True, verbose="ERROR")
        if not (d / "raw_original.fif").exists() and session.original_raw is not None:
            session.original_raw.save(d / "raw_original.fif", overwrite=True, verbose="ERROR")
        for seq, snap in session._ica_checkpoints.items():
            p = d / f"ckpt_{seq}.fif"
            if not p.exists():
                snap.save(p, overwrite=True, verbose="ERROR")
        bundle = {
            "id": session.id,
            "filename": session.filename,
            "montage_name": session.montage_name,
            "saved_at": time.time(),
            "head": session.ledger.head,
            "entries": [
                {k: v for k, v in e.__dict__.items()}
                for e in session.ledger.entries
            ],
        }
        (d / "bundle.json").write_text(json.dumps(bundle, indent=1, default=str))
    except Exception:  # best-effort — a failed autosave must not break the request
        pass


def save_async(session) -> None:
    threading.Thread(target=save, args=(session,), daemon=True).start()


def exists(session_id: str) -> bool:
    return (WORKDIR / session_id / "bundle.json").exists()


def load(session_id: str):
    """Rehydrate a Session from its bundle. Raises FileNotFoundError if absent."""
    from app.services.session_manager import Session

    d = WORKDIR / session_id
    bundle = json.loads((d / "bundle.json").read_text())
    current = mne.io.read_raw_fif(d / "raw_current.fif", preload=True, verbose="ERROR")
    original = (
        mne.io.read_raw_fif(d / "raw_original.fif", preload=True, verbose="ERROR")
        if (d / "raw_original.fif").exists()
        else current.copy()
    )

    ledger = Ledger()
    ledger._entries = [
        LedgerEntry(
            seq=e["seq"], op=e["op"], params=e["params"], label=e["label"],
            template=e["template"], parent=e.get("parent", 0), ts=e.get("ts", 0.0),
            info_before=e.get("info_before", {}), info_after=e.get("info_after", {}),
            replayable=e.get("replayable", True),
        )
        for e in bundle["entries"]
    ]
    ledger._head = bundle.get("head", len(ledger._entries))

    session = Session(id=session_id, filename=bundle["filename"], raw=current, original_raw=original)
    session.ledger = ledger
    session.montage_name = bundle.get("montage_name")
    for p in d.glob("ckpt_*.fif"):
        seq = int(p.stem.split("_")[1])
        session._ica_checkpoints[seq] = mne.io.read_raw_fif(p, preload=True, verbose="ERROR")
    return session


def recent(limit: int = 12) -> list[dict[str, Any]]:
    if not WORKDIR.exists():
        return []
    out = []
    for d in WORKDIR.iterdir():
        b = d / "bundle.json"
        if not b.exists():
            continue
        try:
            data = json.loads(b.read_text())
            out.append({
                "session_id": data["id"],
                "filename": data.get("filename", d.name),
                "saved_at": data.get("saved_at", 0),
                "steps": len(data.get("entries", [])),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["saved_at"], reverse=True)
    return out[:limit]
