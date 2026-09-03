# EEGvis — UI backlog

Audit + prioritized todo. Ordered by leverage: fix what's broken, then ship the
mapped-but-unbuilt features, then polish.

Tested at 375 (phone), 768 (tablet), 1024, 1280, 1440, 1920.

---

## Shipped since the audit

- **CSS `@layer base` fix** — an unlayered `* { padding: 0 }` was killing every Tailwind spacing utility app-wide. Moved to `@layer base`; spacing now actually applies.
- **Light / dark / system theme** — `lib/theme.ts` + `settingsSlice`; canvas panels repaint off `themeTick` via `lib/plot/paint.ts` (reads the resolved CSS custom properties).
- **Settings modal** (`shell/Settings.tsx`) — theme switch + keyboard reference, opened from the gear in the status bar.
- **Typography** — Space Grotesk (UI/grotesque) + JetBrains Mono (data/code) via Google Fonts; tighter tracking, lighter panel-title weight.
- **Absolute-black dark theme** — `--color-bg: #000`, panels pulled to `#0a0b0e`.
- **Text-density pass (partial)** — trimmed status-ticker stats, toolbar form copy, ICA / Settings / History strings; panel titles de-emphasised. Ongoing — see P4.5.
- **`pipeline.py` preview removed from the History panel** — it no longer lingers in the always-on UI. Full move to an Export popup is P1.

---

## Responsive audit — where it breaks

| Width | State |
|---|---|
| **≥ 1440** | Clean. Good use of space. |
| **1024 – 1440** | Works. Power Spectrum panel gets tight (~150 px) but readable; filename truncates. |
| **768 – 1024** | Toolbar + tabs still fit, but Spectrum/Band-Power panels crush; status ticker crowds. |
| **500 – 768** | Toolbar overflows (Montage onward clipped, no overflow menu). Panel tabs overflow. Ticker clipped. |
| **< 500 (phone)** | Fully broken — desktop grid crammed into one column; Spectrum/Band-Power become ~40 px slivers; New-session + Settings scrolled off; no scroll to recover (`body { overflow: hidden }`). No mobile layout exists. |

### Concrete shortcomings

1. ~~**CSS reset was unlayered** → `* { padding: 0 }` beat every Tailwind `px-*`/`p-*`/`m-*` utility app-wide; all the "polish pass" spacing was silently dead.~~ **Fixed** — resets moved into `@layer base`. This alone moved the "cramped" threshold from ~1400 down to ~1000.
2. **StatusTicker** has no degradation — overflows and clips below ~950 px; on phone the right end (New session, Settings) is unreachable.
3. **Toolbar** is a fixed horizontal row — overflows below ~900 px with no wrap and no "More ⋯" overflow menu.
4. **Panel tab strip** (FKeyStrip) overflows below ~800 px — no scroll, no dropdown fallback.
5. **Toolbar popovers** use a fixed `width` + left-anchor; the right-side ones (Export) can spill off the right edge, and none clamp to the viewport on narrow screens.
6. **Settings modal** is `w-[420px]` fixed — overflows viewports < ~440 px.
7. **No touch support** — waveform scrub and minimap drag are `onMouseMove`; splitter drag is mouse-only. (Scalp-field rotate uses pointer events and is fine.) No `touch-action` hints.
8. **`body { overflow: hidden }`** — a short or narrow viewport just clips content with no way to scroll to it.
9. **Canvas plot margins are fixed px** (`M.left = 44`, etc.) — below ~200 px panel width the plot area collapses to nothing; panels have no `min-width`.
10. **Tiler has no min sizes** — flex children can shrink to slivers (Spectrum at ~40 px on mobile). Needs min-size + collapse/stack behaviour.
11. **ICA detail pane** is a fixed 42 % split — the two LinePlots get unusably small when the ICA panel itself is small.

---

## P0 — breakage & foundations

- [x] **P0.1** CSS `@layer base` fix (done).
- [ ] **P0.2 Responsive shell.** Three layouts driven by container width:
  - `≥ 1200` — current 3-region grid.
  - `768 – 1200` — 2 columns: waveform + topography on top, spectral row below; drop the always-on right column.
  - `< 768` — single column, **vertical scroll enabled**, panels stacked full-width at sensible fixed heights; panel tab strip becomes a sticky selector.
- [ ] **P0.3 Toolbar overflow.** Measure available width; move trailing groups into a **"More ⋯"** menu. Never clip.
- [ ] **P0.4 StatusTicker degradation.** Below ~1100 px collapse the middle stats into a single **"session info ▾"** popover; keep name + cursor + New session + Settings always visible.
- [ ] **P0.5 Popover viewport-clamping.** Flip to right-anchor near the right edge; `max-width: 92vw`; never render off-screen. Applies to toolbar menus + Settings + the new Export/History popups.
- [ ] **P0.6 Panel min-sizes + tiler.** Min 240 px per panel; if the row can't honour it, stack instead of shrink.
- [ ] **P0.7 Touch.** Convert waveform scrub, minimap drag, splitter drag to pointer events; add `touch-action: none` where dragging; test tap-to-seek.

## P1 — remove the Pipeline panel; export becomes a popup

- [~] **P1.1** Live `pipeline.py` preview removed from the History panel (done). Still to do: drop `Ledger`/`History` from the default grid entirely once P1.2 + P1.3 land; keep the ledger **data** in the store.
- [ ] **P1.2 Export popup** (`shell/ExportPanel.tsx`, a `.pop` modal like Settings), opened from the toolbar **Export** button. Sections: **Pipeline script** (live `pipeline.py`, Copy, Download `.py`) · **Data** (cleaned `raw.fif`, `summary.csv`) · **Report** (stub). Model the layout on a Google Workspace / M365 export dialog — clear sections, primary action per row.
- [ ] **P1.3 History popover** — a "N steps ▾" control in the status ticker → step list with **revert to here**. Keeps revert reachable without a panel.
- [ ] **P1.4 A "…more" / overflow menu in the toolbar** for the popup panels (Settings, Export, later: View, Session info) — one consistent home for app-level actions, à la the Workspace toolbar overflow.

## P2 — playback / transport

- [ ] **P2.1 Transport bar** docked above the minimap: ⏮ ⏯ ⏭ (prev/next annotation), speed (0.5×/1×/2×/4×), current time, loop-region toggle.
- [ ] **P2.2 Playback engine** — prefetch the next waveform window; smooth cursor advance at the chosen speed; auto-scroll.
- [ ] **P2.3 Windowed PSD** — add `start`/`dur` to `/spectral/psd`; PSD + Band Power recompute (debounced) as the cursor sweeps, so the spectral panels animate during playback.

## P3 — topography views ("other image waveforms at the scalp field")

- [ ] **P3.1** Rename the panel **Topography**; add a view switcher (segmented control):
  - **Surface 3D** — current oblique field.
  - **Topomap 2D** — flat interpolated scalp map @ cursor (`mne.viz.plot_topomap` idiom).
  - **Bands** — δ θ α β γ row of 2D topomaps over the window.
  - **Sensors** — named electrode map; click a sensor to select / mark bad everywhere.
- [ ] **P3.2** Backend: reuse `/viewer/field` for 2D (client renders the flat grid); keep `/spectral/band-topomap`; add a multi-band data endpoint if PNGs feel heavy.
- [ ] **P3.3** (optional) PSD small-multiples — montage-positioned thumbnail spectra — as a spectral-workspace view.
- [ ] **P3.4 Cortical source view** (the MNE `stc.plot()` brain — inflated fsaverage surface with a source estimate overlay + a colorbar + the activation trace strip). Scope honestly:
  - Needs `mne.datasets.fetch_fsaverage` (one-time ~1 GB download, cached), a BEM, a forward solution, a noise covariance, and an inverse operator (dSPM / sLORETA / eLORETA).
  - Only meaningful once the recording has a montage + (ideally) is epoched/averaged — surface it as a distinct **"Source"** view, gated on those prerequisites with a clear "set montage → compute inverse" path.
  - Rendering: server-side render the PyVista brain to a short image sequence keyed on the cursor time (cheap on the client, no WebGL brain mesh), OR a simplified client canvas projection of the fsaverage surface. Start with server PNG-per-cursor-time, like the ICA topographies.
  - This is a multi-day feature with its own backend pipeline (`core/source.py`, `/source/*` routes) — not a quick add. Slot it after P3.1–P3.3 unless it becomes a headline demo.

## P4 — toolbar & waveform controls (Google Workspace / MS 365 feel)

- [ ] **P4.1 Toolbar grouping** — visually grouped, icon + label, separators: *Filtering* (Filter, Notch) · *Montage & reference* (Reference, Montage) · *Channels* (Bad channels, Resample) · ICA · Export. Trailing groups collapse into "More ⋯" (P0.3).
- [ ] **P4.2 Waveform control cluster** — replace the cryptic `+ / −` header buttons with a tidy, labelled group: amplitude (gain), trace spacing, channels shown, a **channel picker** popover, **add annotation**.
- [ ] **P4.3 Spectrogram / TFR** panel (Morlet), cursor-synced.
- [ ] **P4.4 Channel rail** — scroll-synced names with type dots on the waveform, click to select.
- [ ] **P4.5 Finish the text-density pass** — audit every visible string for length; icon-only + tooltip where the meaning is obvious; one-word buttons in popovers; drop redundant panel-header captions. Empty states get one short line, no instructions.
- [ ] **P4.6 Iconography pass** — consistent lucide set at one size per context (13 in toolbar, 14 in chrome, 11 in panel headers); every icon-only control has a `title`/`aria-label`; align stroke weight.
- [ ] **P4.7 Spacing / rhythm** — one vertical rhythm across panels (7 px header, consistent gutters), consistent popover padding, align the toolbar / ticker / tab strip heights.

## P5 — mobile (view-first)

- [ ] Single-column, swipeable panels, bottom tab bar. Preprocessing/ICA hidden or read-only on phone; the phone use-case is *review*, not *clean*.

---

## Deferred (unchanged)

`eegvis` pip package / `launch()` / CLI · OpenAPI→TS codegen · ICLabel auto-suggest ·
clean/raw overlay · disk persistence · report.pdf / BIDS · multi-file upload ·
Storybook / Playwright / CI · offline fonts (`@fontsource/*` instead of the Google
Fonts `@import`).
