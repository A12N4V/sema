"""Where EEGvis keeps its working data. Override with EEGVIS_DATA_DIR
(tests point it at a tmp dir so they don't pollute ~/.eegvis)."""
from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.getenv("EEGVIS_DATA_DIR", str(Path.home() / ".eegvis")))
SESSIONS_DIR = DATA_DIR / "sessions"
UPLOADS_DIR = DATA_DIR / "uploads"

for _d in (SESSIONS_DIR, UPLOADS_DIR):
    _d.mkdir(parents=True, exist_ok=True)
