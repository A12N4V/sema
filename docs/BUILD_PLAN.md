# EEGvis — Build Plan

Target: the "terminal for brain science" in `docs/wireframes/Wireframes.pdf` — one
absolute-black tiled workspace per recording, every panel driven by a shared time
cursor, shipped as a drop-in MNE-Python plugin with full export + provenance.

This plan is ordered by **leverage**, not by screen. The first section builds the
*compounding systems* — the substrate that makes every later panel cheap. Skipping
them to "just build the waveform" is the slow path.

Legend: 🔩 = compounding system (build once, pays back on every feature after it) ·
`S/M/L` = rough effort · ⚠ = has a real unknown to resolve first.

---

## Status (prototype build)

**Done:** P0.1 dev env (`dev.sh` + Vite `/api` proxy) · P0.2 `Session` service object ·
P0.3 provenance ledger (`replay` / `revert` / `to_python`, snapshot for ICA apply) ·
P0.4 `to_wire()` + `POST /sessions/demo` (synthetic EEG, no download) · P0.6 Tailwind +
black tokens · P0.7 the store (5 slices, cursor spine frozen) · P0.8 `<Panel>` +
`usePanelData()` · P0.9 → **replaced by a clickable toolbar + `lib/ops.ts`** (user
correction: this is a web GUI over MNE, not a command-line; the `:` bar / ⌘K palette
were removed) · P0.10 plot substrate (canvas `<LinePlot>` / `<Heatmap>`) ·
P0.12 backend golden-session + API smoke tests (10, green) · R0 shell (CSS-grid tiler +
toolbar + panel strip; app auto-loads the sample recording) · R1 waveform + shared
cursor + minimap + mark-bad · R2 3D scalp field (**canvas** oblique-projection surface)
+ PSD + band heatmap · **R3 ICA workspace** (fit → component grid w/ topographies +
variance → per-component activation + spectrum → mark + apply, all revertible) ·
ledger UX (step list, revert, live `pipeline.py`).

**Deferred:** P0.5 OpenAPI→TS codegen (hand-written typed client for now) · P0.11
`eegvis` package · ICLabel auto-suggestions + clean/raw overlay · R2 spectrogram (TFR) +
windowed PSD + small-multiples · R4 disk persistence + export report/BIDS + multi-file
upload · Storybook / Playwright.

**UI direction (2026-09-02):** "terminal" = *research/stock-analytics desk* (dense,
organized, few clicks), **not** a CLI. Command bar + palette removed; every op is a
toolbar button. Polish pass done: refined dark palette + full **light theme**,
Settings modal (System/Light/Dark, persisted; canvas panels repaint via `themeTick`
+ `lib/plot/paint.ts`), type scale, consistent iconography, radius/shadow tokens.
Still to do: a proper transport bar (play/scrub/speed), a visuals gallery surfacing
more MNE plot types (2D topomap, band-topo row, sensor map).

---

## Single-thread priority list (if you do one thing at a time)

1. 🔩 Dev environment: one-command up, Python 3.11 + MNE pin locked
2. 🔩 Backend `Session` service object + typed state (wrap `Raw/Epochs/ICA`)
3. 🔩 Provenance ledger: `@records` decorator on every mutating op
4. 🔩 Wire format: one `to_wire()` serializer + `/sessions/demo` fixture route
5. 🔩 OpenAPI → TypeScript client codegen (kills hand-written `client.ts`)
6. 🔩 Frontend base: Vite + Tailwind + shadcn + tokens + black theme
7. 🔩 The store: `session · cursor · selection · layout · pipeline` (zustand slices)
8. 🔩 `<Panel>` shell + `usePanelData()` hook (loading/stale/error, abort, debounce)
9. 🔩 Command bus: `verb → {schema, handler, ledgerLabel}` — powers `:` bar, F-keys, ⌘K, buttons
10. 🔩 Plot substrate: `<LinePlot>` (WebGL) + `<Heatmap>` (canvas) + scale utils
11. R0 — dock layout (dockview) + ticker + command bar + F-key strip; port existing panels into tiles
12. R1 — shared cursor + WebGL waveform + minimap (`/viewer/overview`)
13. R2 — 3D scalp field (r3f) + spectral workspace (PSD@window, spectrogram, band heatmap, small-multiples)
14. R3 — ICA workspace (grid + properties + ICLabel) + ledger UX (revert, diff)
15. R4 — `eegvis` plugin (`launch(raw)` + CLI) + export matrix (.py / report / CSV / BIDS) + disk persistence
16. Cross-cutting: Storybook states, Playwright visual regression, golden-session tests

---

## P0 — Compounding systems (do these first)

### P0.1 🔩 Dev environment & one-command up — `S`
- [ ] `Procfile` / `justfile` / `mprocs` config: `backend` (uvicorn --reload), `web` (vite), `codegen` (openapi-typescript --watch)
- [ ] Pin the toolchain: `backend/.python-version` (3.11), lockfile for MNE deps (`uv` or `pip-tools`); document the "MNE not solid on 3.13" constraint in one place
- [ ] `.env` for `EEGVIS_API_URL` — remove the hardcoded `BASE` in `frontend/src/api/client.ts`
- [ ] Make `npm run dev` proxy `/api` → backend so prod and dev use the same relative URLs
- **Payback:** every dev loop after this. No "which port / which python / CORS" tax.

### P0.2 🔩 Backend `Session` service object — `M`
- [ ] Grow `services/session_manager.py`'s `Session` dataclass into a service with typed methods: `filter()`, `notch()`, `resample()`, `set_reference()`, `set_montage()`, `set_bads()`, `fit_ica()`, `apply_ica()`, `psd()`, `band_power()`, `tfr()`, `export_*()`
- [ ] Routes in `api/*` become 3-liners: parse Pydantic → call `session.method()` → return schema
- [ ] Hold derived state on the session: `montage_name`, `applied_steps`, `original_raw` (for revert), cached PSD/interp matrices
- [ ] Unit-testable with zero HTTP (feed it `mne.io.read_raw_fif` of the sample dataset)
- **Payback:** every new endpoint; every test; the ledger and export both read from here.

### P0.3 🔩 Provenance ledger — `M` ⚠
- [ ] A `@records("filter", capture=["l_freq","h_freq"])` decorator on `Session` mutating methods → appends `LedgerEntry{seq, op, params, ts, info_before, info_after}`
- [ ] `GET /api/sessions/{id}/history` → the ledger
- [ ] `session.replay(up_to=n)` — rebuild from `original_raw` by re-running entries 1..n (deterministic). This is **revert** and the basis of clean/raw overlay.
- [ ] Ledger → codegen: `session.to_python()` emits a runnable `mne` script (each op has a `template` string)
- [ ] ⚠ Decide: snapshot-per-step (fast revert, memory heavy) vs replay-from-origin (cheap memory, slower). **Default: replay**, snapshot only if a step is expensive (ICA fit).
- **Payback:** undo/revert, the Export screen's `pipeline.py` + report, the audit trail, and regression fixtures all fall out of this one structure.

### P0.4 🔩 Wire format + demo fixture — `S`
- [ ] One `to_wire(data: np.ndarray, times, max_points) -> {channels, sfreq, t0, dt, data}` used by `/viewer/window`, `/viewer/overview`, TFR marginals, IC time courses — frontend gets **one** parser
- [ ] Reuse `utils/decimate.minmax_decimate`; add a channel-batched version
- [ ] `POST /api/sessions/demo` → loads `mne.datasets.sample` (or `testing`) into a session in <1s
- [ ] `frontend` dev bootstraps against `/demo` so no file upload needed to iterate
- **Payback:** every panel's fetch/parse code; every manual test starts from a known session instantly.

### P0.5 🔩 OpenAPI → TypeScript client — `S`
- [ ] Add `openapi-typescript` + `openapi-fetch` (or `orval`); script: `openapi-typescript http://localhost:8123/openapi.json -o src/api/schema.d.ts`
- [ ] Replace `src/api/client.ts` hand wrappers with a typed `api` from `openapi-fetch`
- [ ] `codegen --watch` in the Procfile so adding a backend route → types appear
- [ ] Keep one thin `req()` wrapper only for error → Sonner toast normalization
- **Payback:** R1–R4 add ~12 endpoints. Each is free on the client instead of a hand-written wrapper + interface.

### P0.6 🔩 Frontend base & theme tokens — `S`
- [ ] Add Tailwind + `shadcn/ui` (Radix), `lucide-react`, `framer-motion`, `sonner`
- [ ] `tokens.css`: `--bg:#000 --panel:#0A0A0C --seam:#26262E --accent:#4FB0FF --alert:#C0603A --fg:#D7D7D7`; mono for data, UI font for chrome
- [ ] Global: black body, 1px seams, dim-on-stale utility class, `prefers-reduced-motion` guard
- [ ] Delete `App.css` hand-rolled styles as panels move over
- **Payback:** every component. Consistency is free once tokens exist.

### P0.7 🔩 The store (zustand slices) — `M` ⚠
- [ ] `sessionSlice` — `SessionInfo`, optimistic patch helpers
- [ ] `cursorSlice` — `t: number`, `window: {start,dur}`, `playing`, setters; **this is the spine**
- [ ] `selectionSlice` — `channels: string[]`, `component: number | null`, `band`
- [ ] `layoutSlice` — dockview model, active workspace preset, per-session persistence
- [ ] `pipelineSlice` — ledger mirror, `pending` op (for before/after previews)
- [ ] ⚠ Freeze the cursor contract now (units = seconds, absolute; window is derived). Every panel depends on it; changing it later is a rewrite.
- **Payback:** panels become pure subscribers. Adding a panel = read store + render, no plumbing.

### P0.8 🔩 `<Panel>` shell + `usePanelData()` — `M`
- [ ] `<Panel title source fkey onPopOut>` — 16px header, sync-lock toggle, pop-out, states: `loading | stale | error | ready` (stale = dim to 60%, don't unmount)
- [ ] `usePanelData(fetcher, deps, {debounceMs, stale})` — abort-on-dep-change, stale-while-revalidate, errors → toast, returns `{data, state}`
- [ ] `<PlotFrame>` — panel body that owns a resize observer and hands `{width,height}` to the plot
- **Payback:** 8+ panels. Every one is `<Panel>` + `usePanelData` + a plot; no bespoke loading/error/resize code.

### P0.9 🔩 Command bus — `M`
- [ ] `registerCommand({verb, aliases, args: zodSchema, run: (args, ctx) => Promise, ledger?: string})`
- [ ] Sources that dispatch through it: `:` command bar (with Tab-complete from the registry), F1–F8 (panel focus/solo), ⌘K palette (fuzzy over verbs + channels + components + steps), and UI buttons ("Apply", "Fit ICA" call the same command)
- [ ] Every command that mutates → auto-appends to the ledger with `ledger` label
- [ ] Command grammar frozen + documented in `docs/COMMANDS.md` (muscle memory)
- **Payback:** new capability = one `registerCommand` call, and it's instantly in the bar, palette, keys, and audit trail.

### P0.10 🔩 Plot substrate — `L` ⚠
- [ ] `<LinePlot series axes cursor>` — WebGL renderer for many lines. Eval `webgl-plot` vs a thin `regl` layer vs `uPlot` (uPlot for ≤32 series, WebGL above). One API regardless of backend.
- [ ] `<Heatmap data domain colormap>` — canvas `putImageData`; shared by spectrogram + band heatmap + small-multiples grid
- [ ] `scales.ts` — time/value ↔ pixel transforms, tick generation, shared cursor-line overlay
- [ ] ⚠ Spike: render 64ch × 10s at 60fps pan on a mid laptop before committing the renderer choice
- **Payback:** waveform, minimap, PSD, spectrogram, IC time course, small-multiples — 6 panels on one renderer.

### P0.11 🔩 `eegvis` python package skeleton — `S`
- [ ] `packages/eegvis/` (or top-level): `eegvis.launch(raw, port=8123)` → serialize `raw` to a fif buffer, `POST /api/sessions/attach`, `webbrowser.open` the session URL; spawn the server if not running
- [ ] `POST /api/sessions/attach` on the backend (accepts a fif upload from an in-memory `Raw`)
- [ ] Stub `eegvis` console-script entry (fills in for real in R4)
- **Payback:** from day one every dev test can go through the real plugin path, so `launch()` is never bolted on later.

### P0.12 🔩 Test & CI harness — `M`
- [ ] Backend: `pytest` against the sample dataset; a **golden session** — a fixed ledger of ops with snapshotted `SessionInfo` + array checksums; assert `replay()` reproduces it
- [ ] Frontend: Vitest for store logic + command bus; Playwright for per-panel + full-terminal screenshots (visual regression)
- [ ] Storybook/Ladle: each panel against mock store states (`loading`, `empty`, `64ch`, `256ch`, `error`)
- [ ] GitHub Actions: lint + type + pytest + playwright on PR
- **Payback:** adding panel N doesn't silently break panels 1..N-1; visual polish is iterable without fear.

---

## P1 — R0: the shell — `M`

- [ ] Dock layout with `dockview` (better TS than react-mosaic): the default "Terminal" grid from wireframe p10
- [ ] Status ticker component — binds `SessionInfo`, pill per field, alert segment when `bads > 0` / montage missing / unsaved
- [ ] Command bar (`:`) + F-key strip wired to the command bus (P0.9)
- [ ] Workspace preset switcher (Terminal / Clean / Report) — swaps the dock model
- [ ] Port the **existing** panels (`ChannelViewer`, `PreprocessPanel`, `ICAPanel`, `SpectralPanel`, `ExportPanel`) into `<Panel>` tiles **unchanged** (Plotly still inside, for now) — proves the shell before the rewrite
- [ ] Route: `/s/:sessionId`; Connect screen (`UploadPanel` → `Connect.tsx`) posts and navigates
- [ ] `AnimatePresence` cross-fade on the main dock area only; ticker + bars persist
- **Exit criteria:** you can upload, land in a tiled terminal, run every current feature from tiles + the `:` bar, layout persists per session.

## P2 — R1: the spine (cursor + waveform) — `L`

- [ ] `GET /api/sessions/{id}/viewer/overview` — ~1 value/s/channel (RMS or minmax) for the whole recording
- [ ] `<Waveform>` on `<LinePlot>` — stacked traces, per-type auto-scale + global µV/div, WebGL pan at 60fps
- [ ] Shared cursor line: mouse-move + `:goto <t>` publish `cursor.t`; every synced panel reads it
- [ ] `<Minimap>` — overview strip, draggable window box, click-to-jump; keeps `cursor.window` in sync
- [ ] Click trace / name / press `b` → `set_bads` (optimistic; row + trace go alert; ticker updates)
- [ ] Channel rail — scroll-synced names, type dots, click-to-select (feeds `selectionSlice`)
- [ ] Keyboard: `←/→` page, `↑/↓` scale, `[ ]` nudge cursor
- [ ] ⚠ Annotations (`a`) — decide free-text vs vocabulary; write to `raw.annotations` (feeds epoching later)
- **Exit criteria:** scrub the waveform and the cursor value is live in the store; mark-bad and window-nav feel instant; Plotly is gone from the viewer.

## P3 — R2: 3D field + spectral workspace — `L` ⚠

**3D scalp field**
- [ ] Backend: `GET /api/sessions/{id}/montage/interp-matrix` — precompute spherical-spline `M (V×N)` once per montage; `colors = M @ values` per frame on the client
- [ ] `<ScalpField>` — react-three-fiber head mesh (bundled generic head + electrode positions from montage), per-vertex colour, orbit controls, camera presets
- [ ] Field source toggle: instantaneous @ cursor · band power (δ…γ) over window
- [ ] `:play` — sweep the cursor at N×, prefetch window, field animates
- [ ] Sensor picking (raycast) → select channel everywhere / toggle bad
- [ ] Keep MNE PNG topomap (`/spectral/band-topomap`) as the reference sub-tile
- [ ] ⚠ Resolve: client-side interp matrix vs server value-grid per `t`. Prefer the matrix (one fetch, then GPU-cheap).

**Spectral workspace**
- [ ] `POST /api/sessions/{id}/spectral/psd` gains `start`/`dur` → PSD on the visible window; debounced recompute on scrub
- [ ] `<PSD>` — default mean ± IQR band; individual channels from selection
- [ ] `<BandHeatmap>` on `<Heatmap>` — channel×band from existing `/band-power`; click cell → set band + select channel
- [ ] `POST /api/sessions/{id}/spectral/tfr` — Morlet/multitaper on one channel, continuous; `<Spectrogram>` on `<Heatmap>` with synced cursor marker
- [ ] `<SmallMultiples>` — montage-positioned grid of thumbnail PSDs
- [ ] Source switch Raw ↔ Epochs (disabled until epochs exist)
- **Exit criteria:** every spectral view redraws off the shared cursor/window; the 3D field animates on `:play`.

## P4 — R3: ICA workspace + ledger UX — `M`

- [ ] `<ICAGrid>` — eager-load all N topomaps after fit (N small); excluded → alert outline
- [ ] `GET /api/sessions/{id}/ica/components/{i}/properties` — topomap + IC time course + IC PSD + variance (MNE `plot_properties` data, not a PNG)
- [ ] `<ICProperties>` tile — reuses `<LinePlot>` / `<Heatmap>`
- [ ] `POST /api/sessions/{id}/ica/label` — wrap `mne-icalabel`; class + probability badge per component
- [ ] Montage gate: disable Fit without a montage; ticker links to fix
- [ ] Apply guard: Dialog ("this rewrites the signal"); records a ledger step
- [ ] Clean/raw overlay in `<Waveform>` — ghost `replay(up_to=step-1)` behind current
- [ ] Ledger tile (F6): step list, `revert to step…`, `diff params`, selected-step detail
- **Exit criteria:** fit → label → inspect → exclude → preview overlay → apply, all recorded and revertible.

## P5 — R4: plugin + export + persistence — `M`

- [ ] `eegvis` package for real: `launch(raw, block=False)`, `eegvis <file>` console script boots backend + web + opens the terminal, `pip install eegvis`
- [ ] Export matrix: `GET /export/pipeline.py` (from `session.to_python()`), `GET /export/summary.csv` (band power + exclusion log), `GET /export/report.pdf` (topomaps + PSD + step list), `GET /export/bids` (MNE-BIDS derivatives)
- [ ] `pipeline.py` preview tile (live from the ledger)
- [ ] Disk persistence: `session.save()` / `load()` under `~/.eegvis/sessions/{id}/` (ledger JSON + `raw_clean.fif` or a bundle); `sweep_expired` writes-then-evicts
- [ ] Recent sessions list on Connect (reads the workdir)
- [ ] ⚠ Multi-file upload (BrainVision `.vhdr+.eeg+.vmrk`, EEGLAB `.set+.fdt`) — group-by-stem drop
- [ ] Epoching control (from annotations / fixed-length) feeding the Epochs source switch
- **Exit criteria:** `eegvis.launch(raw)` from a notebook → clean → `:export py` gives a script that reproduces the session; close the tab, reopen from Connect.

---

## Cross-cutting / ongoing

- **Perf budget:** 60fps pan/scrub on 64ch; 256ch degrades gracefully (fewer visible traces, coarser decimate). Measure in the Playwright harness.
- **Error surface:** all API errors → Sonner; validation → inline `<Alert>`. No full-screen spinners ever (P0.8 stale state).
- **Accessibility:** `prefers-reduced-motion`, keyboard reachability of every command (the bus gives this for free), focus rings on tiles.
- **Docs:** keep `ARCHITECTURE.md` current; `COMMANDS.md` for the `:` grammar; a short `CONTRIBUTING.md` once the harness exists.
- **Security/CORS:** tighten `allow_origins` before any non-localhost deploy; `eegvis` binds `127.0.0.1` by default.

## Known unknowns to resolve before the phase that needs them

| Unknown | Needed by | Default if undecided |
|---|---|---|
| Revert: snapshot vs replay | P0.3 | Replay from origin; snapshot only ICA fit |
| WebGL line lib: webgl-plot vs regl vs uPlot | P0.10 | Spike first; uPlot ≤32 series, WebGL above |
| 3D interp: client matrix vs server grid | P3 | Client `M×values` per frame |
| Dock lib: dockview vs react-mosaic | P1 | dockview |
| Annotation vocabulary | R1 | Free-text + recent list |
| Session bundle format | P5 | ledger.json + raw_clean.fif in a dir |
| Multi-file import UX | P5 | group-by-stem on one drop |
