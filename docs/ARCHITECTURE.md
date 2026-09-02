# EEGvis — Architecture

An open-source web UI over MNE-Python: upload an EEG recording, explore it,
clean it, and export the result — without writing a script per dataset.

## Goals

- Wrap the parts of the MNE-Python pipeline people actually repeat by hand
  every time (load → inspect → filter → mark bad channels → ICA → epoch →
  spectral view → export) behind a UI, not a notebook.
- Keep MNE doing all the signal processing. This project is a UI + API
  shell around it, not a reimplementation.
- Session-based, local-first. No account system, no cloud requirement —
  point it at a file, get a session, work in the browser.
- Support the file formats MNE already reads: EDF/EDF+, BDF, FIF,
  BrainVision, EEGLAB `.set`, CNT, and raw arrays via a CSV importer.

## Non-goals (v1)

- Real-time/streaming acquisition (LSL etc.) — batch/offline analysis only.
- Source localization / MRI co-registration — big scope, later milestone.
- Multi-user auth, cloud storage, or a database. Sessions live on local
  disk under a working directory; this is a single-user local tool first.

## High-level architecture

```
┌─────────────────────────┐        HTTP/JSON         ┌───────────────────────────┐
│        Frontend         │ ───────────────────────▶ │          Backend          │
│   React + TypeScript    │ ◀─────────────────────── │   FastAPI + MNE-Python    │
│   (Vite, Plotly.js)     │      PNG / JSON / WS      │                           │
└─────────────────────────┘                           └───────────┬───────────────┘
                                                                   │
                                                        ┌──────────▼───────────┐
                                                        │   Session Store       │
                                                        │  (in-proc dict now;   │
                                                        │  disk-backed later)   │
                                                        │  session_id → Raw /   │
                                                        │  Epochs / ICA state   │
                                                        └───────────────────────┘
```

The backend is a thin, well-typed REST layer over MNE objects kept alive
per-session in memory (an `mne.io.Raw`, optionally an `mne.Epochs`, optionally
a fitted `mne.preprocessing.ICA`). Every mutating endpoint (filter, re-ref,
mark-bads, ICA-exclude) mutates that in-memory object and returns a fresh
summary; nothing is recomputed from scratch on the client.

Heavy numeric payloads (raw traces, PSDs) are downsampled/decimated
server-side before serialization — the browser should never receive more
points than it can usefully render.

## Backend layout

```
backend/
  app/
    main.py                 FastAPI app, CORS, router mounting
    api/
      sessions.py            upload, session info, delete
      viewer.py               windowed raw-trace data for the scroller
      preprocessing.py        filter, notch, resample, re-reference, bad channels
      ica.py                   fit ICA, list components, topomap images, exclude/include
      epochs.py                create epochs from annotations/events, reject criteria
      spectral.py              PSD (Welch), band power, time-frequency (Morlet)
      export.py                export cleaned Raw/Epochs to FIF or CSV summary
    core/                      MNE wrapper functions — pure-ish, take/return MNE objects
      loader.py                format-sniffing reader → mne.io.Raw
      filters.py
      ica_ops.py
      epoching.py
      spectral_ops.py
      topomap.py               render component/band topomap → PNG bytes
    models/                    Pydantic request/response schemas
    services/
      session_manager.py       session_id lifecycle, TTL cleanup, disk paths
    utils/
      decimate.py               LTTB-ish downsampling for trace payloads
  tests/
  requirements.txt
```

## Frontend layout

```
frontend/
  src/
    api/client.ts              typed fetch wrappers over the backend routes
    state/sessionStore.ts       zustand store: current session, raw info, UI state
    components/
      UploadPanel.tsx
      InfoPanel.tsx             channel count, sfreq, duration, montage
      ChannelViewer.tsx         scrollable multi-channel trace view (Plotly)
      FilterControls.tsx        band-pass / notch / resample form
      BadChannelPicker.tsx      click channel name/trace to toggle bad
      ICAPanel.tsx              component grid (topomap thumbnails) + exclude toggle
      EpochsPanel.tsx           event/annotation-based epoching form
      SpectralPanel.tsx         PSD + band-power bar chart
      ExportPanel.tsx
    pages/App.tsx               top-level layout: sidebar (steps) + main viewer
  vite.config.ts
  package.json
```

## Core data flow (v1 pipeline)

1. **Upload** → backend sniffs extension, calls the matching `mne.io.read_raw_*`,
   stores the `Raw` under a new `session_id`, returns info (channel names/types,
   sfreq, duration, existing annotations).
2. **View** → frontend requests a time window + channel subset; backend slices
   the Raw, decimates to ≤ ~2000 points/channel, returns JSON arrays for Plotly.
3. **Preprocess** → filter/notch/resample/re-reference requests apply
   in-place to the session's Raw (each returns updated info so the UI can
   reflect e.g. new sfreq after resampling).
4. **Bad channels** → toggled by name; stored on `raw.info['bads']`.
5. **ICA** → fit on request (method + n_components configurable), then list
   components with variance-explained and a topomap PNG per component;
   toggling exclusion updates `ica.exclude` without refitting.
6. **Epochs** → build from existing annotations/events or a fixed-length
   grid; reject thresholds optional.
7. **Spectral** → Welch PSD over the current Raw or Epochs; per-band
   (delta/theta/alpha/beta/gamma) power table + topomaps.
8. **Export** → cleaned Raw/Epochs to `.fif`, or a CSV summary (band power
   per channel, ICA exclusion log) for downstream stats.

## Why these choices

- **FastAPI over Flask/Django** — async-friendly, automatic OpenAPI schema
  (useful for a typed frontend client), minimal ceremony for a project this
  size.
- **In-memory session objects, not a DB** — MNE objects are the actual state;
  serializing Raw to/from a database on every request would be slower and
  more complex than keeping it resident and TTL-evicting idle sessions.
- **Plotly.js over a custom canvas renderer** — EEG trace viewers need pan/
  zoom/hover for free; reinventing that isn't the point of this project.
  Can be swapped for a WebGL renderer later if channel counts get large
  (256+ channel HD-EEG) and Plotly's SVG/Canvas backends start to lag.
- **PNG topomaps rendered server-side (matplotlib via MNE)** rather than
  reimplementing topomap interpolation in JS — MNE's `plot_topomap` already
  does the sensor-layout interpolation correctly; no reason to duplicate it.

## Milestones

- **M0 (this commit)** — scaffold, health check, upload + info endpoint,
  minimal frontend that uploads a file and shows channel/sfreq/duration.
- **M1** — raw trace viewer (scroll/pan, channel picker), bad-channel toggle.
- **M2** — filtering (bandpass/notch/resample), re-referencing.
- **M3** — ICA fit + component browser + exclude/apply.
- **M4** — epoching from annotations, PSD/band-power view, topomaps.
- **M5** — export (FIF/CSV), session persistence to disk, packaging
  (Dockerfile, `pip install eegvis` + `eegvis` CLI to launch both halves).
