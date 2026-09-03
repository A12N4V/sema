# EEGvis

**MNE-Python, in a web UI** — a dense, point-and-click analysis desk over
[MNE-Python](https://mne.tools/) for exploring and cleaning EEG recordings. One
recording per session; every panel — waveform, 3D scalp field, power spectrum,
band-power heatmap, ICA — is driven by a single shared time cursor. Every
cleaning step is recorded in a provenance ledger that exports as a runnable
`pipeline.py`.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the original design
writeup, [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for the roadmap, and
[`docs/COMMANDS.md`](docs/COMMANDS.md) for the controls.

## Status: working prototype

Open the app → it lands on a sample recording → scrub the shared cursor across
the waveform, 3D scalp field, spectrum and band-power heatmap → filter / notch /
reference / montage / mark-bad / fit-ICA from the **toolbar** → every step lands
in the Pipeline panel → `revert` to any step → `export py|fif|csv`. Upload your
own file with **New session**.

- **Compounding systems in place:** `Session` service object, provenance ledger
  (`replay` / `revert` / `to_python`), one `to_wire()` serializer, a canvas plot
  substrate (`<LinePlot>` / `<Heatmap>`), a shared mutation helper (`lib/ops.ts`)
  that keeps the ledger + panels in lockstep, the zustand cursor spine, and a
  `<Panel>` + `usePanelData()` shell.
- **Not done yet:** the `eegvis` pip package / `launch(raw)` / CLI, ICLabel
  auto-suggestions, spectrogram (TFR), windowed PSD, disk-persisted sessions,
  multi-file upload, OpenAPI→TS codegen, visual-regression tests.

## Running it

One command (starts FastAPI on `:8123` and Vite on `:5173`):

```bash
./dev.sh
```

Or the two halves separately:

```bash
# backend — Python 3.11 (MNE's dependency chain isn't solid on 3.13+)
cd backend
python3.11 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/uvicorn app.main:app --reload --port 8123
```

```bash
# frontend
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173` — it lands on the sample recording automatically.
The Vite dev server proxies `/api` to the backend, so the frontend only ever
uses relative URLs (override the target with `EEGVIS_API_URL`). Swagger UI is at
`http://localhost:8123/docs`.

### Tests

```bash
cd backend && ./venv/bin/pip install -r requirements-dev.txt && ./venv/bin/pytest
cd frontend && npm run build   # tsc + vite build as the type/compile gate
```

## Supported file formats

EDF, BDF, FIF, GDF, CNT — anything MNE reads from a single self-contained file.
BrainVision / EEGLAB need a multi-file upload endpoint (not built yet).

## Project layout

```
backend/    FastAPI + MNE-Python API
  app/services/   session_manager.py (the Session service), ledger.py
  app/core/       wire.py (serializer + geometry), demo.py (synthetic EEG), MNE wrappers
  app/api/        thin routers: sessions, viewer, geometry, preprocessing, ica, spectral, provenance, export
frontend/   React + TypeScript + Vite + Tailwind
  src/store/         zustand slices (session · cursor · selection · layout · pipeline)
  src/lib/plot/      canvas plot substrate (LinePlot, Heatmap, scales, useCanvas)
  src/lib/ops.ts     shared mutation helper (API call → refresh session + ledger + geometry)
  src/components/panels/   Waveform, ScalpField3D, PSD, BandHeatmap, ICA, Ledger, Minimap, Panel shell
  src/components/shell/     Terminal (tiling), StatusTicker, Toolbar, FKeyStrip, Connect
docs/       ARCHITECTURE.md · BUILD_PLAN.md · COMMANDS.md · wireframes/
```

## License

MIT — see [LICENSE](LICENSE).
