from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from app.core.loader import load_raw, raw_summary, UnsupportedFormatError, SUPPORTED_EXTENSIONS
from app.models.schemas import SessionInfo
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("/upload", response_model=SessionInfo)
async def upload(file: UploadFile = File(...)) -> SessionInfo:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type {suffix!r}. Supported: {', '.join(SUPPORTED_EXTENSIONS)}",
        )

    # Write to a temp session-scoped dir first — MNE readers need a real path,
    # and some formats (BrainVision, EEGLAB) expect sibling files (.eeg/.vmrk,
    # .fdt) alongside the header, so this single-file upload covers the
    # self-contained formats (EDF/BDF/FIF/GDF/CNT) fully; multi-file formats
    # are a v1.1 follow-up (an upload-set endpoint).
    tmp_dir = Path.home() / ".eegvis" / "uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / (file.filename or "upload" + suffix)
    with tmp_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        raw = load_raw(tmp_path)
    except UnsupportedFormatError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {e}")

    session = sessions.create(filename=file.filename or tmp_path.name, raw=raw)
    return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))


@router.get("/{session_id}", response_model=SessionInfo)
async def get_info(session_id: str) -> SessionInfo:
    try:
        session = sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))


@router.delete("/{session_id}")
async def delete_session(session_id: str) -> dict:
    sessions.delete(session_id)
    return {"deleted": session_id}
