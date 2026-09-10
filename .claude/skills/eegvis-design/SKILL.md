---
name: eegvis-design
description: Factual reference for EEGvis UI work, the MNE-Python workbench in this repo. Load before changing UI in frontend/src, building a wireframe deck, or adding a panel/view/operation surface. Records the backend structures the UI renders, the layout conventions already settled, and mistakes already paid for.
---

# EEGvis design reference

A workbench over MNE-Python for **EEG professionals** who already know MNE and
would otherwise be writing the script by hand. Density over hand-holding.

## Current direction (v4.1)

Four surfaces, all settled: do not re-litigate without being asked:

| Surface | State |
|---|---|
| **Signal** | shipped. Waveform · transport · og-strip · a tabbed Visuals pane (topography / 3D field / spectrum / band power) · ICA. |
| **Channels & Annotations** | proposed. A sortable channel table + montage preview + annotation list, opened as a panel from Signal. |
| **Analysis** | proposed. Source (built) plus Epochs / Evoked / TFR as sibling tabs. |
| **Pipeline** | shipped as a step list with the MNE call under each step, a params panel, a live script preview and the export buttons. An n8n-style node canvas was designed for it and not built. |

## Backend structures the UI renders

Do not invent parallel models: these exist:

| Structure | Where | Gives the UI |
|---|---|---|
| `Operation` registry | `core/operations/base.py` | Per op: `inputs`/`output` container kinds, a Pydantic `params_model` → JSON schema, `requires` capability tokens, `long_running`. One definition drives the palette entry, the param form, the ledger row and the `pipeline.py` line. **Never hand-write a form.** `ops_for(kind)` filters ops to a container, use it to offer only legal next operations. |
| `Ledger` | `services/ledger.py` | `parent` per entry (0 = pristine), `head`, `leaves()`, `path_to(seq)`, `on_path`, and `rendered` (the generated python line). Already a branching DAG; re-running from a non-head point forks and keeps the old branch. Nothing is deleted. `replayable=False` marks ops needing a snapshot (ICA apply), those cannot be freely re-run in place. |
| `ContainerRef` | `core/containers.py` | `id`, `kind`, `label`, `parent_id`, `op_id`, the lineage edges a flow canvas draws. |
| `session_capabilities()` | `core/containers.py` | Tokens (`montage`, `filtered_1hz`, `has_bads`, `ica`, `epochs`, `source`, `fsaverage`). Gate affordances on these and show **the path to unlock**, never a raw error. |
| Job system | `services/jobs.py` | Every `long_running` op. Show progress on the thing being computed. |

## Layout conventions already settled

1. **No rails.** v2's left container rail and right inspector were deleted for costing ~28% of the window in chrome. Don't reintroduce one without a measured argument.
2. **Flat top page bar**, Signal / Analysis / Pipeline. Adding a fifth destination needs justification; prefer a panel or a view.
3. **Tabs for views of one object looked at one at a time.** The Visuals pane consolidation (4 cards → 4 tabs) shipped and is correct.
4. **Any pane maximizes** via `paneId` on `Panel`, keep new panes compatible.
5. **Below 900px** is one scrolling column at fixed working heights. Never hide the only route to a feature (past bug: export was `max-[900px]:hidden`).
6. **Server-rendered PNGs** (topomaps, ICA properties, 3D brain) are cached by `(container-hash, view, params, cursor-bucket)`. Client canvas is for cursor-linked 60fps views (waveform, spectrum, heatmaps).

## Mistakes already paid for

- **Permanently-quartered tiles and dashed "not built" stubs** holding the same square footage as working features. A stub gets a line or a greyed node, not a quadrant.
- **A feature-checklist redesign**, bolting a table, tabs and a button onto existing pages and calling it a rethink.
- **Over-abstraction in a wireframe deck.** A deck is *screens*. Comparison diagrams, keyboard tables, latency budgets and philosophy pages are not screens, and a reviewer cannot tell what they are looking at. If a page isn't a drawn screen with callouts, it probably shouldn't be in the deck.
- **Advertising capability that isn't wired**, the Connect screen lists ~13 formats; verify readers exist before claiming them.

## Coverage reality

`docs/MNE_CAPABILITY_MAP.md` is current: read it before claiming what is built.
~19% of MNE's surface is reachable via 10 registered ops. The structural gaps:
**no channels table, no annotation UI, and no `mne.Epochs`**, Epochs is the single
blocking node for Evoked, TFR, connectivity, decoding and stats.

## Deliverables

Wireframe decks were deleted once the v6 shell shipped: the app itself is now the reference. `docs/ARCHITECTURE.md` carries the decisions.
with the `wireframe-pdf` skill. This is a **desktop web app**, override that skill's
phone artboard with a wide browser-chrome frame and put callouts in a row beneath.
The v4.1 source has a reusable `.flowcanvas` / `.node` / `.port` system with a
rough.js wire renderer driven by `data-edges="a>b,b>c"`.
