"""Where Sema keeps its working data. Override with SEMA_DATA_DIR
(tests point it at a tmp dir so they don't pollute ~/.sema)."""
from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.getenv("SEMA_DATA_DIR", str(Path.home() / ".sema")))
SESSIONS_DIR = DATA_DIR / "sessions"
UPLOADS_DIR = DATA_DIR / "uploads"

for _d in (SESSIONS_DIR, UPLOADS_DIR):
    _d.mkdir(parents=True, exist_ok=True)
