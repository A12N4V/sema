"""In-memory session state.

A "session" is one uploaded recording plus whatever MNE objects have been
derived from it so far (a filtered Raw, a fitted ICA, an Epochs object).
Kept resident in a process-wide dict — see ARCHITECTURE.md for why this
isn't a database. Idle sessions are evicted after SESSION_TTL_SECONDS.
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import mne

SESSION_TTL_SECONDS = 60 * 60 * 2  # 2 hours of inactivity
WORKDIR = Path.home() / ".eegvis" / "sessions"
WORKDIR.mkdir(parents=True, exist_ok=True)


@dataclass
class Session:
    id: str
    filename: str
    raw: mne.io.BaseRaw
    epochs: Optional[mne.Epochs] = None
    ica: Optional[mne.preprocessing.ICA] = None
    created_at: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)

    def touch(self) -> None:
        self.last_used = time.time()


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
