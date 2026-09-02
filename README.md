# EEGvis

A web UI over [MNE-Python](https://mne.tools/) for exploring, cleaning, and
exporting EEG recordings — upload a file, get an interactive multi-channel
viewer, filtering, ICA artifact removal, and spectral analysis, all backed
by MNE doing the actual signal processing.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design
writeup (why FastAPI, why in-memory sessions, why Plotly, milestone plan).

## Status: M0–M4 scaffolded and smoke-tested

Upload → viewer → filtering/re-reference/montage → ICA (fit/topomap/
exclude/apply) → PSD + band-power topomaps → export to `.fif` all work
end-to-end against real MNE objects. Not yet done: disk-persisted sessions,
packaging (Docker/CLI), multi-file format upload (BrainVision/EEGLAB's
sidecar files), tests beyond manual smoke-testing.

## Running it

**Backend** (Python 3.11 — MNE's dependency chain isn't yet solid on 3.13+):

```bash
cd backend
python3.11 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8123
```

**Frontend**:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies API calls to
`http://localhost:8123` (hardcoded in `src/api/client.ts` for now — move to
an env var before deploying anywhere but localhost).

Interactive API docs (Swagger UI) are auto-generated at
`http://localhost:8123/docs` once the backend is running.

## Supported file formats

EDF, BDF, FIF, GDF, CNT — anything MNE reads from a single self-contained
file. BrainVision (`.vhdr`+`.eeg`+`.vmrk`) and EEGLAB (`.set`+`.fdt`) are
wired into the loader but need a multi-file upload endpoint before they'll
actually work through the UI (single-file upload only right now).

## Project layout

```
backend/    FastAPI + MNE-Python API (see backend/app/)
frontend/   React + TypeScript + Vite + Plotly UI
docs/       Architecture and design notes
```

## License

MIT — see [LICENSE](LICENSE).
