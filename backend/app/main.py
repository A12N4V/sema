from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import sessions as sessions_api
from app.api import viewer, preprocessing, ica, epochs, spectral, export
from app.services.session_manager import sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Nothing to clean up on shutdown yet — sessions are in-memory and die
    # with the process. A periodic sweep task could be added here later.


app = FastAPI(
    title="EEGvis API",
    description="A web UI over MNE-Python for exploring and cleaning EEG recordings.",
    version="0.1.0",
    lifespan=lifespan,
)

# Dev-friendly CORS: the Vite dev server runs on a different port than the
# API. Tighten this before shipping anything beyond localhost use.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "active_sessions": len(sessions._sessions)}
