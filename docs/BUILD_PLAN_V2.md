# EEGvis — Build Plan v2

**Supersedes `BUILD_PLAN.md`.** That plan shipped a working prototype but hit a
ceiling: a fixed grid, a preprocessing-only toolbar, per-operation routes and
per-panel wiring. Every new MNE capability costs the same as the last one. This
plan front-loads the **compounding systems** that make capability N+1 cheaper
than N, then walks the phases.

Companion: [`MNE_CAPABILITY_MAP.md`](MNE_CAPABILITY_MAP.md) (the full surface +
coverage matrix), [`wireframes/`](wireframes/) (the v2 UI).

Legend: 🔩 compounding system · `S/M/L/XL` effort · ⚠ has an unknown to resolve first.

---

## Progress

Branch `v2-foundations` — the P0 compounding systems and the P1 shell are **built and
verified in-app**. Additive: the older per-op routes still work alongside `/ops`.

| Item | Status | Where |
|---|---|---|
| **P0.1** container graph + lineage | ✅ | `core/containers.py`; `GET /sessions/{id}/graph` |
| **P0.2** operation registry | ✅ | `core/operations/`; `GET /ops`, `POST /sessions/{id}/ops` |
| **P0.3** generic endpoint + job runner | ✅ | `services/jobs.py`, `api/jobs.py`; `202 {job_id}` for long ops |
| **P0.4** card registry + canvas substrate | ✅ | `components/cards/registry.tsx`, `CardCanvas.tsx` (reuses `lib/plot`) |
| **P0.5** server render service | ✅ | `core/render.py`, `api/render.py`; disk-cached PNGs |
| **P0.6** provenance DAG (branch/fork) | ✅ | `services/ledger.py` (parent + head); `replay(seq)` / checkout |
| **P0.7** capability gating + wizard primitive | ✅ | gate in `/ops`; `components/ops/Wizard.tsx` (ICA setup flow) |
| **P0.8** typed client codegen | ⏸ deferred | hand-written `client.ts` is fully typed + small; revisit when the API surface is larger |
| **P0.9** param forms + design system | ✅ | `ParamForm.tsx`, `ui/primitives.tsx`; truncation + 860px responsive floor |
| **P0.10** format / modality adapters + datasets | ✅ | `core/loader.py` (auto-detect + ~16 formats), `core/modality.py`, `core/datasets.py` |
| **P0.11** session attach + `eegvis` plugin + disk persistence | ✅ | `app/plugin.py`, `eegvis/`, `backend/pyproject.toml`, `services/persistence.py` (autosave → rehydrate on `GET`) |
| **P0.12** test harness | ✅ | backend `test_op_contract.py` + 8 suites (50 green); frontend `vitest` (16 green) |
| **P1** the shell | ✅ | `shell/Workspace.tsx` (CommandBar · ContainerRail · CardCanvas · Inspector · ProvenanceStrip), `lib/router.ts` |

**What the shell does now:** routed `/s/:id` (survives refresh *and* a server restart —
sessions autosave to `~/.eegvis/sessions/` and rehydrate on demand) · container-graph rail
with ghost nodes · modular card canvas with per-container presets · ⌘K palette generating
forms from the registry (montage picker is a real dropdown; ~9 ops) · real MNE topomap/sensor
cards via the render service (the fake "Scalp field" is gone) · provenance filmstrip with fork
markers + checkout · transport (play/scrub/speed) · one context inspector (channel /
component / step) · ICA setup wizard · Connect with a format grid + `mne.datasets` picker +
recent sessions.

**The priority list (P0.1–P0.12 + P1) is done**, except P0.8 (deferred). Small follow-ups:
a card-grid density pass, and porting the ICA "Apply" / component-inspect paths onto the
registry.

**Then the feature phases P2–P8 below** populate the registries — each is now ~1 `Operation`
+ ~1 `CardDef` per capability.

---

## The core idea

> **One registry entry per MNE operation. One card definition per MNE plot. One
> renderer. One provenance graph. Everything else is generated.**

v1 has ~35 hand-written route handlers, ~12 hand-written client wrappers, 7
hard-referenced panels, and a preprocessing-only command surface. v2 replaces the
per-feature work with per-feature *data*:

| To add an MNE operation in v2 | You write |
|---|---|
| Backend | one `Operation` (id, stage, input/output container types, Pydantic param schema, MNE call, `pipeline.py` template) |
| Frontend | nothing — the param form, palette entry, ledger row, and codegen all read the registry |
| To add an MNE plot | one `CardDef` (id, container type, data endpoint or render spec, default size) |

That's the whole bet. The phases below are mostly "populate the registries".

---

## Status carried over from v1

**Keep:** FastAPI + MNE backend · in-proc session store + TTL · the provenance
ledger (`replay` / `revert` / `to_python`) · `to_wire` serializer · zustand store
· the sync-paint canvas substrate (`lib/plot/`) · theme system (`themeTick` +
`paint()`) · Tailwind v4 tokens · the smoke + golden-session tests.

**Recently fixed:** route handlers moved off the event loop (sync `def` +
per-session `RLock`); `revert()` re-derives montage/epochs; upload path-traversal
+ size cap; shared `useSignatureKey`.

**Replace:** the fixed `Terminal.tsx` grid · the preprocessing `Toolbar` · per-op
routes in `api/*` · hard-coded `panelRegistry` + `PANELS` · `ScalpField3D` framed
as "3D" · hand-written `client.ts`.

**Known broken (v1 audit, still true):** responsive < 1000 px · text clipping in
the ticker / toolbar / plot axes · no routing / session URL · playback doesn't
animate spectral panels · no touch.

---

## P0 — Compounding systems (build before any feature)

### P0.1 🔩 Container graph + lineage model — `M` ⚠

The left rail, the "what can I do now" logic, and revert all read from one
structure.

- [ ] `ContainerRef { id, kind: 'raw'|'epochs'|'evoked'|'spectrum'|'tfr'|'ica'|'forward'|'cov'|'inverse'|'stc'|'dipole', label, parentId, opId, createdAt }`
- [ ] `Session` holds a `dict[str, Container]` + a lineage DAG, not just `raw/epochs/ica`
- [ ] `GET /sessions/{id}/graph` → nodes + edges; the rail renders it directly
- [ ] Active-container is client state (`store.activeContainerId`); every card + the command bar read it
- [ ] ⚠ Decide identity: content-hash vs monotonic id. **Default:** monotonic id + a cheap `state_hash` for render-cache keys.
- **Payback:** every workspace, the rail, capability gating, and multi-object views (compare two evokeds) fall out of this.

### P0.2 🔩 Operation registry — `L`

The single biggest accelerator.

- [ ] `Operation` dataclass: `id`, `stage`, `inputs: list[ContainerKind]`, `output: ContainerKind | None`, `params: pydantic.BaseModel`, `run(session, inputs, params) -> Container|None`, `template: str` (for `to_python`), `label(params) -> str`, `long_running: bool`, `requires: list[Capability]`
- [ ] Register every op in `core/operations/*.py` — one module per stage
- [ ] `GET /ops?input=raw` → the operations valid for a container kind, with JSON-schema params (from Pydantic)
- [ ] The command bar renders that list grouped by `stage`; selecting one auto-generates the param form from the JSON schema (see P0.9)
- [ ] Each `run` appends a `LedgerEntry` automatically (the decorator from v1's P0.3, finally done)
- **Payback:** ~60 MNE operations become ~60 small dataclasses. No routes, no forms, no client wrappers, no codegen templates written by hand per op.

### P0.3 🔩 Generic op endpoint + job system — `M` ⚠

- [ ] `POST /sessions/{id}/ops` `{ op_id, input_ids, params }` → dispatches through the registry, returns `{ container_graph, ledger_entry }` or `{ job_id }`
- [ ] `long_running` ops (ICA fit, forward, inverse, TFR, permutation stats, `fetch_fsaverage`) enqueue a job: `Job { id, op_id, state: queued|running|done|error, progress: float, log: str[], result }`
- [ ] `GET /jobs/{id}` + SSE `/jobs/{id}/stream` for progress; MNE's `verbose` / `tqdm` hooks pipe into `log`
- [ ] Frontend: a jobs tray in the transport bar; cards for a pending container show a progress skeleton
- [ ] ⚠ Execution model: threadpool (current) vs a real worker process. **Default:** `ProcessPoolExecutor(max_workers=2)` for `long_running`, threadpool for the rest — keeps a 30 s inverse off the request path *and* off the GIL.
- **Payback:** kills "the UI froze during ICA"; makes fsaverage download / forward solution / cluster stats usable at all.

### P0.4 🔩 View / card registry + one canvas substrate — `L`

- [ ] `CardDef { id, title, container: ContainerKind, kind: 'canvas'|'image'|'table'|'wizard', dataEndpoint?, renderSpec?, defaultSize, minSize }`
- [ ] `<Card def={} containerId={} />` — owns loading/stale/error (the v1 `<Panel>` + `usePanelData`), a resize observer, the sync-lock toggle, pop-out, and a "swap card" menu
- [ ] Canvas renderer: **WebGL lines** (`regl` or `webgl-plot`, ≤64 ch on `uPlot`, above on WebGL — resolve in P0.10 of v1, still open) + canvas raster for heatmaps + an image layer for server PNGs/frames. One `<Plot>` API.
- [ ] `scales.ts`, shared cursor overlay, tabular tick formatting (fixes the `125250375Hz` axis clipping)
- **Payback:** waveform, PSD, TFR, minimap, IC time-course, connectivity matrix, score-over-time, band heatmap — one renderer, ~8 cards.

### P0.5 🔩 Server render service — `M`

- [ ] `render(session, spec) -> PNG|frames` worker: matplotlib-Agg for 2D (topomaps, `plot_properties`, `plot_joint`, `plot_compare_evokeds`, connectogram, BEM slices), PyVista-offscreen for 3D (`plot_alignment`, `stc.plot`, `Brain`)
- [ ] Cache keyed `(container.state_hash, spec, cursor_bucket)` on disk under the session dir; LRU evict
- [ ] Cursor-linked image cards request `spec.time = cursorBucket` (0.1 s buckets); prefetch ±2 buckets during playback
- [ ] Headless 3D: `mne.viz.set_3d_backend('notebook')` / `pyvista.OFF_SCREEN`; document the EGL/OSMesa system dep
- **Payback:** every topomap, every properties panel, the 3D brain, coregistration view — all one endpoint. No JS reimplementation of MNE's interpolation/rendering.

### P0.6 🔩 Provenance DAG (branch + compare) — `M`

- [ ] Ledger becomes a tree: entries have `parent_seq`; `branch(from_seq)` starts an alternative line
- [ ] `replay` walks a path to a node; `revert` = check out a node (keep siblings)
- [ ] `GET /history` returns the tree; the provenance strip renders it as a horizontal filmstrip with branch points
- [ ] "Compare" = load two leaf containers into a split card (filter A vs filter B on the waveform; two evokeds)
- [ ] `to_python(leaf)` emits the path to that leaf
- **Payback:** the core research loop ("try this, try that, keep the better one") without losing work; clean/raw overlay is just a 2-leaf compare.

### P0.7 🔩 Capability gating + wizards — `S`

- [ ] `Capability` enum: `montage`, `filtered_1hz`, `events`, `epochs`, `evoked`, `covariance`, `forward`, `inverse`, `fsaverage`
- [ ] `session.capabilities()` → set; each `Operation.requires` and `CardDef` checks it
- [ ] Ungated UI shows the **path to unlock**: a disabled card renders "Needs: montage → [Set montage]"; the Source rail item opens the setup wizard
- [ ] `<Wizard steps={}>` primitive for source-setup, BIDS export, epoching
- **Payback:** no more raw MNE exceptions in the UI; the 3D brain has an honest on-ramp instead of a broken-looking empty panel.

### P0.8 🔩 Typed client codegen — `S`

- [ ] `openapi-typescript` on the FastAPI schema → `src/api/schema.d.ts` in the Procfile (`--watch`)
- [ ] `openapi-fetch` client; keep one `req()` wrapper for error→toast + the `session-lost` event
- [ ] Op param forms are typed from the generated JSON schema
- **Payback:** the registry's Pydantic schemas flow to the frontend for free; deleting `client.ts` deletes a maintenance tax.

### P0.9 🔩 Auto-generated param forms + design system — `M`

- [ ] `<ParamForm schema={jsonSchema} onSubmit={}>` — renders number / select / multiselect / channel-picker / band-picker / range from JSON-schema + a few `x-widget` hints
- [ ] Design tokens as code: type scale (tabular numerals for data), spacing rhythm, `Card` / `Inspector` / `DataTable` / `Toolbar` / `Chip` primitives, one icon set at fixed sizes
- [ ] **Fix the v1 visual debt here**: every label owns its box (truncate + tooltip), responsive breakpoints (≥1200 / 768–1200 / <768), status bar collapses to a popover, no `overflow:hidden` traps
- **Payback:** every operation gets a usable form with zero bespoke UI; "cluttered and clipped" is fixed structurally, once.

### P0.10 🔩 Format / modality adapter layer — `S`

- [ ] `readers.py`: extension → `read_raw_*` registry (all ~25 formats), multi-file group-by-stem, friendly errors
- [ ] `modality.py`: from `Info` derive the active modality set (eeg/meg/seeg/fnirs/eyetrack) → drives per-type scaling, topomap style (scalp vs helmet vs cortex-surface), and which stages appear
- [ ] Dataset picker: `mne.datasets.*` (eegbci, sample, somato, fnirs_motor, ssvep, erp_core…) with one-line fetch
- **Payback:** "MNE but GUI" means *all* of MNE's inputs. Every modality rides the same containers.

### P0.11 🔩 Session bundle + plugin path — `M`

- [ ] Bundle = `ledger.json` + container snapshots (`.fif` per node) + `render-cache/` under `~/.eegvis/sessions/{id}/`
- [ ] `session.save()` / `load()`; recent-sessions list on Connect; `sweep_expired` writes-then-evicts
- [ ] `eegvis` package: `eegvis.launch(raw, block=False)` → serialize to fif buffer → `POST /sessions/attach` → open browser; `eegvis <file>` console script boots both halves
- **Payback:** every dev iteration goes through the real attach path; refresh/re-open stops losing work; `pip install eegvis` is the distribution story.

### P0.12 🔩 Test & fixture harness — `M`

- [ ] Golden pipelines per stage (fixed op list → snapshotted container hashes); assert DAG replay reproduces them
- [ ] `Operation` contract test: every registered op round-trips through `/ops` on a fixture session and emits valid `pipeline.py` that `compile()`s
- [ ] Frontend: Vitest for store + registry; Playwright per-card screenshots against mock containers; Storybook card states (loading / 32ch / 256ch / meg / error)
- [ ] CI: lint + type + pytest + playwright on PR
- **Payback:** populating registries with 60 ops without silently breaking the 59 before it.

---

## Single-thread priority list

1. P0.1 container graph → P0.2 operation registry → P0.3 generic endpoint + jobs
2. P0.4 card registry + renderer → P0.5 server render service
3. P0.9 design system + param forms (visual debt paid here) → P0.8 codegen
4. P0.6 provenance DAG → P0.7 capability gating → P0.10 formats → P0.11 bundle/plugin
5. P0.12 harness in parallel throughout
6. **P1 shell** — assemble the above into the workspace; port Raw
7. P2 Raw complete → P3 ICA v2 + SSP → P4 Epochs/Evoked → P5 Spectral/TFR
8. P6 Source (the 3D brain) → P7 Connectivity/Decoding/Stats → P8 Report/BIDS/persistence

---

## P1 — the shell — `L`

Assemble P0 into the workspace from [`wireframes/`](wireframes/) p.4.

- [ ] **App routing**: `/s/:sessionId`, deep-linkable; Connect posts and navigates; refresh restores from bundle (P0.11)
- [ ] **Container rail** (left): the lineage DAG (P0.1); click sets active; "+" per node shows valid ops
- [ ] **Card canvas** (center): a real tiling layer with **min-sizes** and stack-don't-shrink (fixes v1 audit P0.6); per-workspace default layouts; add/remove/swap/pop-out cards from the registry
- [ ] **Inspector** (right): context router — channel / component / label / step / edge; one panel replaces v1's scattered detail panes
- [ ] **Command bar** (top): visible `+ Operation` button *and* ⌘K; both dispatch the registry (P0.2); fuzzy over ops + channels + components + steps
- [ ] **Transport + provenance** (bottom): real play/scrub/speed/loop (P2.x of v1) driving the shared cursor; the DAG filmstrip (P0.6); export menu
- [ ] **Status bar**: name + active container + capability pills; collapses to a popover < 1100 px
- [ ] Port the **Raw** workspace: waveform · sensors 2D · PSD · band heatmap · minimap as cards; every current op re-expressed in the registry
- [ ] Workspace presets (Clean / ERP / Time-Frequency / Source) = saved card layouts per container
- **Exit:** land from Connect in a routed workspace; the rail shows `Raw`; every v1 feature works through the registry; layout persists; nothing clips at 1280 or 1440.

## P2 — Raw complete — `M`

Fills the Ingest / Montage / Filter / Artifact-ID rows of the matrix.

- [ ] `interpolate_bads` — **first** (closes the mark-bad loop)
- [ ] Montage: all standard montages + custom-file upload + digitized; montage preview card
- [ ] Reference: average / REST / bipolar / specific / keep-drop ref channel (mode switch)
- [ ] Channels table in the inspector: type, rename, reorder, pick/drop, per-channel PSD sparkline
- [ ] Filter advanced: FIR/IIR, transition bw, phase, window + a filter-response preview card
- [ ] Notch: `spectrum_fit` mode + harmonics helper
- [ ] Annotation mode on the waveform: draw / label / delete; `BAD_*` spans excluded downstream
- [ ] Artifact ID ops: `annotate_muscle_zscore`, `annotate_amplitude`, `annotate_break`, EOG/ECG event detection, `regress_artifact`, `find_bad_channels_lof`
- [ ] Multi-file upload (BrainVision trio, EEGLAB pair) + the extra readers (P0.10)
- [ ] `crop`, `anonymize`, `concatenate_raws`
- **Exit:** a real recording goes load → montage → filter → annotate → interpolate → clean, all in the registry, all in `pipeline.py`.

## P3 — ICA v2 + SSP — `M`

- [ ] `plot_properties` as a proper card (topo + epochs-image + ERP + PSD + variance), server-rendered
- [ ] **ICLabel** (`mne-icalabel`): class + probability badge per component; "auto-exclude eye/muscle/heart ≥ 0.8" action
- [ ] `find_bads_eog/ecg/muscle/ref` + `plot_scores` card
- [ ] Clean/raw overlay before apply (a 2-leaf compare, P0.6) in the waveform
- [ ] ICA methods: `picard`, `infomax`; fit on Epochs; montage/hi-pass gate with a fix path (P0.7)
- [ ] SSP: `compute_proj_raw/epochs`, `compute_proj_ecg/eog`, projector toggle card, `plot_projs_topomap`
- **Exit:** fit → auto-label → inspect → exclude → preview overlay → apply, all recorded, all revertible.

## P4 — Events / Epochs / Evoked — `L`

- [ ] Events: `find_events` (stim), `events_from_annotations`, `make_fixed_length_events`, merge/target; an events raster card + editable events table
- [ ] Epoching op: tmin/tmax, baseline, reject/flat, `reject_by_annotation`, decim, detrend; autoreject
- [ ] `make_metadata` + a metadata table with pandas-query epoch selection
- [ ] Epochs cards: `plot_image`, `plot_drop_log`, `plot_topo_image`, PSD-by-condition
- [ ] Average op: mean/median/robust, `combine_evoked`, `grand_average`, baseline
- [ ] Evoked cards: butterfly, `plot_joint`, topo sequence / `animate_topomap`, `plot_white`, `plot_compare_evokeds` (± CI), field map (`make_field_map` — the honest scalp-field)
- [ ] Peak / GFP in the inspector
- **Exit:** Raw → events → epochs (with rejection) → evoked → compare conditions, as containers in the rail.

## P5 — Spectral + Time-Frequency — `M`

- [ ] PSD: multitaper method, windowed (`start`/`dur`) so it animates during playback, small-multiples view
- [ ] Band topomap row (δθαβγ)
- [ ] **TFR** workspace: `tfr_morlet` / `tfr_multitaper` / `tfr_stockwell`, power + ITC, baseline modes; cards = TFR heatmap (channel), `plot_joint`, topo-over-time
- [ ] Continuous spectrogram on Raw (`raw.compute_tfr` / sliding STFT)
- [ ] `apply_hilbert` envelope, CSD (feeds P6/P7)
- [ ] MEG per-type scaling + helmet topomap; fNIRS preprocessing chain + hbo/hbr views
- **Exit:** every spectral view redraws off the shared cursor/window; TFR is a first-class container.

## P6 — Source: the 3D brain — `XL` ⚠

Its own mini-plan. Gated behind the setup wizard (P0.7). See
[`MNE_CAPABILITY_MAP.md`](MNE_CAPABILITY_MAP.md) §2 "The 3D brain, specifically".

- [ ] **P6.0** honest intermediate: `make_field_map` + `evoked.plot_field` and 2-D `plot_topomap` at cursor — replaces `ScalpField3D`'s hand-rolled IDW with the real thing; **no inverse pipeline needed**
- [ ] **P6.1** `core/source.py` + `fetch_fsaverage` as a tracked job (P0.3), cached under `~/.eegvis/`
- [ ] **P6.2** source space (`oct6`) + BEM (fsaverage ships one) + `make_forward_solution`, cached per (montage, subject); `plot_alignment` 3D card (server render, P0.5)
- [ ] **P6.3** coregistration: template-fit (fiducials) for standard montages; ICP + a 3D `plot_alignment` adjust card for digitized; store `trans`
- [ ] **P6.4** `compute_covariance` (from epochs / ad-hoc / baseline) op + `plot_cov` card + whitened-evoked check
- [ ] **P6.5** `make_inverse_operator` + `apply_inverse` (dSPM default; MNE / sLORETA / eLORETA); `apply_inverse_raw` for a continuous stc
- [ ] **P6.6** the **brain card**: PyVista offscreen → frames keyed to cursor time (P0.5), inflated fsaverage, colorbar, hemi/view controls; a source-time-course strip below
- [ ] **P6.7** `extract_label_time_course` + parcellation picker (aparc / a2009s / HCPMMP1 / Yeo) → label table + TC card
- [ ] **P6.8** beamformers (`make_lcmv` / `make_dics`), `fit_dipole` + `Dipole.plot_locations`, volume stc + ortho slices
- [ ] **P6.9** `SourceMorph` → fsaverage for group work
- **Exit:** montage → forward → covariance → inverse → an inflated brain that animates on the shared cursor, with label time-courses; `pipeline.py` reproduces the whole inverse.

## P7 — Connectivity / Decoding / Stats — `L`

- [ ] Connectivity workspace (`mne-connectivity`): `spectral_connectivity_epochs/_time` (coh/PLV/wPLI/PLI/GC), `envelope_correlation`, `phase_slope_index`; connectogram + matrix + 3D sensor-lines cards; sensor- or label-space
- [ ] Decoding workspace (`mne.decoding`): `CSP`/`SPoC`, `SlidingEstimator`/`GeneralizingEstimator` + `cross_val_multiscore`, `ReceptiveField` (mTRF); score-over-time, generalization matrix, pattern topomaps
- [ ] Stats op: `permutation_cluster_1samp_test` / `spatio_temporal_cluster_test` / TFCE on Epochs / Evoked-contrast / STC; `fdr_correction`; cluster overlay on the relevant card
- [ ] rERP (`linear_regression_raw`), sparse inverses (`mixed_norm` / `gamma_map`), RAP-MUSIC
- **Exit:** a contrast → cluster stats → significant clusters drawn on the butterfly / brain.

## P8 — Report / BIDS / persistence / packaging — `M`

- [ ] `mne.Report`: build from the DAG (`add_raw/epochs/evokeds/ica/forward/inverse/cov/stc/bem/trans`), preview + download HTML
- [ ] `mne-bids`: `read_raw_bids` on Connect; `write_raw_bids` + derivatives export wizard
- [ ] `export` → EDF / EEGLAB / BrainVision
- [ ] Disk persistence + recent sessions + autosave (P0.11 finished)
- [ ] `eegvis` on PyPI: `launch()` + `eegvis <file>` CLI + Dockerfile
- [ ] `mne-bids-pipeline` import (read a config, replay it into a session)
- **Exit:** `eegvis.launch(raw)` from a notebook → clean → export a Report + a BIDS derivative + a `pipeline.py` that reproduces it; close the tab, reopen from Connect.

---

## Cross-cutting

- **Perf budget:** 60 fps pan/scrub at 64 ch; 256 ch degrades gracefully. Measure in Playwright.
- **Error surface:** every op error → typed (`ParamError` / `CapabilityError` / `MNEError`) → inline in the param form or a toast; no raw exception strings (v1 regression to fix).
- **Accessibility:** keyboard-reachable ops (the registry gives this), focus rings, `prefers-reduced-motion`, canvas cards get an ARIA summary + data-table fallback.
- **Security:** tighten CORS before non-localhost; `eegvis` binds `127.0.0.1`; upload cap (done); no path from client strings to filesystem (done).
- **Docs:** keep `MNE_CAPABILITY_MAP.md` coverage column current; `ARCHITECTURE.md` for the container/registry model; `COMMANDS.md` for the palette grammar.

## Unknowns to resolve before the phase that needs them

| Unknown | Needed by | Default if undecided |
|---|---|---|
| Container identity: hash vs id | P0.1 | monotonic id + `state_hash` for cache keys |
| Job executor: threadpool vs process pool | P0.3 | `ProcessPoolExecutor(2)` for `long_running`, threadpool else |
| WebGL line lib: `webgl-plot` vs `regl` vs `uPlot` | P0.4 | spike first; `uPlot` ≤ 64 series, WebGL above |
| Render-cache eviction & size | P0.5 | LRU, 500 MB/session, disk under session dir |
| 3D headless backend: PyVista EGL vs OSMesa vs Xvfb | P0.5 / P6 | PyVista off-screen + EGL; document OSMesa fallback |
| Provenance DAG storage | P0.6 | in-memory tree now; `ledger.json` in the bundle at P0.11 |
| Coregistration without individual MRI | P6.3 | template fiducial fit for standard montages; ICP for digitized; warn on accuracy |
| Multi-file / BIDS import UX | P0.10 / P8 | group-by-stem on one drop; BIDS = pick the dataset root |
