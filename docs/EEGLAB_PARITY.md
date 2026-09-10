# Sema against EEGLAB

*Updated 2026-09-09. Numbers re-counted against the live operation registry and
the MNE 1.12 API, not from memory.*

EEGLAB (SCCN, UCSD) is the most widely used graphical EEG analysis tool in
research. Brainstorm is the strongest GUI for source analysis. Both are MATLAB.
FieldTrip and MNE-Python are script-first with no real GUI, which is the space
this project occupies.

This document is the honest ledger: what Sema now matches, what it does
better, and what EEGLAB still does that this does not. It is meant to be
uncomfortable to read in places, because a parity claim nobody checks is worth
nothing.

---

## 1. What Sema now matches

Each row is a feature an EEGLAB user reaches for by reflex, and the surface that
answers it here.

| EEGLAB | Sema | Notes |
|---|---|---|
| Channel locations editor | **Channels workspace** | Sortable table: name, type, peak-to-peak µV, sd µV, bad, shown, drop. Inline rename, type dropdown, live filter. |
| `pop_select` / channel removal | `drop_channels` operation | Refuses to drop the last channel rather than leaving an empty recording. |
| `clean_rawdata` (channel half) | **Detect bad channels** | `find_bad_channels_lof`. Merges with, rather than replaces, the manual list. |
| `pop_interp` | `interpolate_bads` | Gated on there being a bad channel to interpolate. |
| Event / annotation table | **Annotations workspace** | Create at the cursor, edit, delete, seek. `BAD_*` called out, since MNE excludes those spans from later maths. |
| `pop_rejcont`, muscle rejection | **Detect muscle** | `annotate_muscle_zscore`, appended to your own marks rather than replacing them. |
| `pop_runica` | `fit_ica` | fastica. |
| **ICLabel** | **Classify + Auto-mark** | `mne-icalabel`, ONNX backend. Class badge and confidence on every component card, artifacts-first sort, one-click auto-mark at ≥80%. |
| `pop_epoch` | `make_epochs` | From annotations, or a fixed grid when the recording has no events, so a resting session still reaches the epoched half. |
| `pop_rejepoch` | `reject_uv` parameter + drop log | Drop count and percentage in the pane header, reasons on hover. |
| `pop_erpimage` | **ERP image** | Every trial a row, diverging colour ramp centred on zero. |
| `pop_timtopo` / `plot_joint` | **Evoked workspace** | Butterfly with GFP, and a topography at whatever latency you click. |
| `pop_newtimef` | **Time-frequency** | Morlet, baseline-corrected in dB. |
| Scrolling data viewer | **Waveform** | µV per division stated, numbered time axis, channel paging with the range in the header, bad channels struck through, annotations as spans. |
| Plugin architecture | `@sema.operation` | A decorator turns any function into a first-class operation: palette entry, form generated from its type hints, capability gate, ledger row, and a line in the exported script. |
| `EEG.history` | **Provenance ledger** | Branching, checkout-able, exported as a runnable `pipeline.py`. |

The registry went from **10 operations to 22**, and the capability map from
**35 built rows to 29 of 164 checked rows** after the rows were re-scoped. See
`docs/MNE_CAPABILITY_MAP.md` for the per-stage detail.

---

## 2. What this does better

Not a longer list, but the reasons someone would choose this.

**It runs in a browser on localhost, and there is no MATLAB licence.** That is
the whole premise. A lab machine, a shared server, a student laptop, a container
in a cluster: same tool, one URL.

**Provenance is a DAG you can check out, not a log you can read.** EEGLAB's
`EEG.history` is a flat transcript. Here, re-running from an earlier step forks
rather than overwrites, both branches survive, and any point is one click away.
`pipeline.py` is generated from that path, so what you export is what you did.

**Figures are precomputed and the timeline is linked to them.** On load the
server renders the whole recording's topographies (180 frames for a 3-minute
recording) into a disk cache. Dragging across the topography then sweeps
the entire recording under your finger with no lag. No MATLAB tool does this.

**Every figure is drawn in the app's ink.** Transparent PNGs with theme-aware
foregrounds, so nothing is a white card pasted onto a dark workbench, and the
light/dark switch re-renders rather than inverting.

**One shared clock.** The trace, the topography, the ICA activation and the
source estimate all answer to the same cursor, on every container, with the
recording's silhouette always in view.

**It works on a phone.** Not a claim EEGLAB can make.

---

## 3. What EEGLAB still does that this does not

The uncomfortable half.

| Gap | Size | Why it matters |
|---|---|---|
| **STUDY: multi-subject, group statistics, IC clustering across subjects** | Large | This is the single biggest gap. Sema is one recording at a time. Real studies are twenty subjects and a contrast. Nothing here addresses that yet. |
| **Connectivity** | Medium | `mne-connectivity` exists and is not wired in. Shown as a ghost chip in the strip rather than hidden. |
| **Dipole fitting (`dipfit`)** | Medium | Per-component equivalent dipoles, and the residual variance number people filter components by. |
| **ASR (artifact subspace reconstruction)** | Medium | The other half of `clean_rawdata`. We detect bad channels; we do not reconstruct contaminated segments. `asrpy` would be the route. |
| **Breadth inside stages we have** | Medium | One ICA method (fastica, not infomax or picard); one TFR method (morlet, no multitaper or Stockwell, no ITC); no filter design controls or response preview; `plot_properties` is two panels of five. |
| **~100 community plugins** | Large | We now have the door (`@sema.operation`); nobody has walked through it. An extension surface with no ecosystem is a promise, not a feature. |
| **BIDS read/write, format re-export** | Medium | `read_raw_bids`, `write_raw_bids`, and export to EDF/EEGLAB/BrainVision. Currently FIF and CSV only. |
| **Twenty years of papers citing it** | Not a feature | It is the reason reviewers know what `pop_runica` means. Worth naming honestly. |

---

## 4. Where to go next, in order

1. **ASR**, to finish `clean_rawdata`. `asrpy`, one operation, high recognition.
2. **Dipole fitting**, which pairs with ICLabel and is what makes a component
   list actionable rather than descriptive.
3. **Connectivity**, the one ghost chip left in the strip.
4. **Multi-recording**, which is a change to the session model rather than one
   more operation, and should not be started until the single-recording surfaces
   have stopped moving.

Everything above is deliberately ordered by value over effort, not by how close
it gets to a parity checkbox. The wedge is "browser-native, reproducible,
MNE-backed", and the list is chosen to sharpen that rather than to chase a tool
with a twenty-year head start on breadth.
