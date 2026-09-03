from __future__ import annotations

import os
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from app.core.demo import make_demo_raw
from app.core.loader import load_raw, raw_summary, UnsupportedFormatError, SUPPORTED_EXTENSIONS
from app.models.schemas import SessionInfo
from app.services import persistence
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# Upload ceiling. EEG recordings are rarely over a few hundred MB; the cap is a
# guard against a single request filling the disk. Override with EEGVIS_MAX_UPLOAD_MB.
MAX_UPLOAD_MB = int(os.getenv("EEGVIS_MAX_UPLOAD_MB", "500"))
_CHUNK = 1024 * 1024


@router.post("/demo", response_model=SessionInfo)
def demo() -> SessionInfo:
    """Spin up a session backed by a synthetic recording — no upload needed."""
    raw = make_demo_raw()
    session = sessions.create(filename="demo · synthetic 32ch", raw=raw)
    return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))


@router.post("/upload", response_model=SessionInfo)
def upload(file: UploadFile = File(...)) -> SessionInfo:
    # Never trust the client-supplied name as a path — strip every directory
    # component so "../../etc/x.edf" can't escape the uploads dir.
    safe_name = Path(file.filename or "").name
    suffix = Path(safe_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type {suffix!r}. Supported: {', '.join(SUPPORTED_EXTENSIONS)}",
        )

    # Write to a temp dir first — MNE readers need a real path, and some formats
    # (BrainVision, EEGLAB) expect sibling files (.eeg/.vmrk, .fdt) next to the
    # header, so this single-file path covers the self-contained formats
    # (EDF/BDF/FIF/GDF/CNT); multi-file formats are a follow-up.
    tmp_dir = Path.home() / ".eegvis" / "uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / (safe_name or f"upload{suffix}")

    limit = MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with tmp_path.open("wb") as out:
            while chunk := file.file.read(_CHUNK):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_UPLOAD_MB} MB upload limit")
                out.write(chunk)
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise

    try:
        raw = load_raw(tmp_path)
    except UnsupportedFormatError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {e}")

    session = sessions.create(filename=safe_name or tmp_path.name, raw=raw)
    return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))


@router.get("/recent")
def recent() -> dict:
    """Reopenable session bundles on disk, newest first (P0.11)."""
    return {"recent": persistence.recent()}


@router.post("/attach", response_model=SessionInfo)
def attach(file: UploadFile = File(...)) -> SessionInfo:
    """Attach an in-memory Raw serialized to FIF — the ``eegvis.launch()`` path."""
    tmp_dir = Path.home() / ".eegvis" / "uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"attach_{Path(file.filename or 'raw').name}"
    with tmp_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    try:
        raw = load_raw(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to read attached Raw: {e}")
    session = sessions.create(filename=file.filename or "attached", raw=raw)
    return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))


@router.get("/{session_id}", response_model=SessionInfo)
def get_info(session_id: str) -> SessionInfo:
    try:
        session = sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    with session.lock:
        return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))


@router.delete("/{session_id}")
def delete_session(session_id: str) -> dict:
    sessions.delete(session_id)
    return {"deleted": session_id}
