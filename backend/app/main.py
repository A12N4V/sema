from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import sessions as sessions_api
from app.api import (
    viewer, ica, spectral, export, provenance, geometry,
    ops, jobs, render, datasets, source, channels, analysis,
)
from app.core import operations  # noqa: F401 , importing populates the op registry
from app.services.session_manager import sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Nothing to clean up on shutdown yet: sessions are in-memory and die
    # with the process. A periodic sweep task could be added here later.


app = FastAPI(
    title="Sema API",
    description="A web UI over MNE-Python for exploring and cleaning EEG recordings.",
    version="0.2.0",
    lifespan=lifespan,
)

# Dev-friendly CORS. In dev the Vite server proxies /api so requests are
# same-origin and this doesn't even fire; it's here for the "hit :8123
# directly" case. Override / tighten with SEMA_CORS_ORIGINS (comma list)
# before exposing anything beyond localhost.
_default_origins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
_origins = [o.strip() for o in os.getenv("SEMA_CORS_ORIGINS", _default_origins).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_api.router)
app.include_router(viewer.router)
app.include_router(ica.router)
app.include_router(spectral.router)
app.include_router(export.router)
app.include_router(provenance.router)
app.include_router(geometry.router)
app.include_router(ops.router)
app.include_router(jobs.router)
app.include_router(render.router)
app.include_router(datasets.router)
app.include_router(source.router)
app.include_router(channels.router)
app.include_router(analysis.router)


# Plethos (bulk RNA-seq) and Karyon (snRNA-seq) live in their own sub-app:
# runs on disk and a ledger per run, not in-memory MNE sessions.
from app.omics.main import app as omics_app  # noqa: E402
app.mount("/omics", omics_app)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "active_sessions": sessions.active_count()}


# Production: serve the built frontend from the same origin as the API, so one
# container is the whole app (the Hugging Face Space does this). Off in dev,
# where Vite serves the UI and proxies /api.
_static = os.getenv("SEMA_STATIC_DIR")
if _static and os.path.isfile(os.path.join(_static, "index.html")):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    _root = os.path.realpath(_static)
    app.mount("/assets", StaticFiles(directory=os.path.join(_root, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = os.path.realpath(os.path.join(_root, path))
        if candidate.startswith(_root + os.sep) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_root, "index.html"))
