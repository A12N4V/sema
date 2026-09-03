from __future__ import annotations

import csv
import io

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse

from app.core import spectral_ops
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/export", tags=["export"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Sync def: raw.save() and the Welch PSD for the CSV are blocking work.
@router.get("/raw.fif")
def export_raw_fif(session_id: str):
    session = _get_session(session_id)
    out_path = sessions.session_dir(session_id) / "cleaned_raw.fif"
    with session.lock:
        session.raw.save(str(out_path), overwrite=True, verbose="ERROR")
    return FileResponse(str(out_path), filename="eegvis_cleaned_raw.fif", media_type="application/octet-stream")


@router.get("/epochs.fif")
def export_epochs_fif(session_id: str):
    session = _get_session(session_id)
    with session.lock:
        if session.epochs is None:
            raise HTTPException(status_code=400, detail="No epochs created yet")
        out_path = sessions.session_dir(session_id) / "epochs-epo.fif"
        session.epochs.save(str(out_path), overwrite=True, verbose="ERROR")
    return FileResponse(str(out_path), filename="eegvis_epochs-epo.fif", media_type="application/octet-stream")


@router.get("/pipeline.py", response_class=PlainTextResponse)
def export_pipeline_py(session_id: str) -> str:
    session = _get_session(session_id)
    return session.to_python()


@router.get("/summary.csv")
def export_summary_csv(session_id: str):
    session = _get_session(session_id)
    buf = io.StringIO()
    w = csv.writer(buf)

    with session.lock:
        w.writerow(["# EEGvis session summary", session.filename])
        w.writerow([])
        w.writerow(["## pipeline"])
        w.writerow(["seq", "op", "label"])
        for e in session.ledger.entries:
            w.writerow([e.seq, e.op, e.label])
        w.writerow([])

        w.writerow(["## band power (mean, µV²/Hz)"])
        try:
            bp = spectral_ops.compute_band_power(session.raw)
            w.writerow(["channel", *bp["bands"].keys()])
            for i, ch in enumerate(bp["channels"]):
                w.writerow([ch, *(f"{bp['bands'][b][i]:.4g}" for b in bp["bands"])])
        except Exception as e:  # pragma: no cover - defensive
            w.writerow([f"(band power unavailable: {e})"])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=eegvis_summary.csv"},
    )
