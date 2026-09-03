from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import sessions as sessions_api
from app.api import viewer, preprocessing, ica, epochs, spectral, export, provenance, geometry, ops, jobs, render
from app.core import operations  # noqa: F401  — importing populates the op registry
from app.services.session_manager import sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Nothing to clean up on shutdown yet — sessions are in-memory and die
    # with the process. A periodic sweep task could be added here later.


app = FastAPI(
    title="EEGvis API",
    description="A web UI over MNE-Python for exploring and cleaning EEG recordings.",
    version="0.2.0",
    lifespan=lifespan,
)

# Dev-friendly CORS. In dev the Vite server proxies /api so requests are
# same-origin and this doesn't even fire; it's here for the "hit :8123
# directly" case. Override / tighten with EEGVIS_CORS_ORIGINS (comma list)
# before exposing anything beyond localhost.
_default_origins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
_origins = [o.strip() for o in os.getenv("EEGVIS_CORS_ORIGINS", _default_origins).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_api.router)
app.include_router(viewer.router)
app.include_router(preprocessing.router)
app.include_router(ica.router)
app.include_router(epochs.router)
app.include_router(spectral.router)
app.include_router(export.router)
app.include_router(provenance.router)
app.include_router(geometry.router)
app.include_router(ops.router)
app.include_router(jobs.router)
app.include_router(render.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "active_sessions": sessions.active_count()}
