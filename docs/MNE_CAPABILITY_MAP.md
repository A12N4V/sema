# MNE-Python: capability map & how Sema surfaces it

The reference this project is built against. MNE-Python is large (~1,200 public
symbols) but its shape is simple: **a handful of data containers** flow through
**a fixed set of processing stages**, and each stage has **a few canonical
plots**. Get that skeleton into the UI and every feature has an obvious home.

This doc is in three parts:

1. **The shape of MNE**, containers, stages, modalities, the visualization catalog.
2. **The container-centric UI model**, how each container maps to a workspace.
3. **Coverage matrix**, every area, its status today, its UI home, its priority.

Companion docs: [`ARCHITECTURE.md`](ARCHITECTURE.md) (how the pieces fit),
[`EEGLAB_PARITY.md`](EEGLAB_PARITY.md) (the same question asked against the
tool most people actually use).

---

## Part 1: the shape of MNE

### 1.1 Data containers (the nouns)

Everything in MNE is a method on one of these. The arrows are the *only* legal
transitions; the UI's container strip is literally this graph.

```
                          ┌─────────────┐
   file / array  ───────▶ │    Raw      │  continuous, n_chan × n_times
                          └──────┬──────┘
              ┌──────────────────┼───────────────────┬─────────────────┐
              ▼                  ▼                   ▼                 ▼
        ┌───────────┐      ┌───────────┐      ┌────────────┐    ┌───────────┐
        │  Epochs   │      │ Spectrum  │      │    ICA     │    │   TFR     │
        │ trials    │      │ PSD       │      │ unmixing   │    │ (Raw)TFR  │
        └─────┬─────┘      └───────────┘      └────────────┘    └───────────┘
        ┌─────┼───────┬──────────┐
        ▼     ▼       ▼          ▼
   ┌────────┐ ┌──────────┐ ┌──────────────┐
   │ Evoked │ │EpochsTFR │ │EpochsSpectrum│
   │ average│ │          │ │              │
   └───┬────┘ └──────────┘ └──────────────┘
       │
       │  + Forward + Covariance + InverseOperator  (the source pipeline)
       ▼
  ┌──────────────────┐        ┌─────────────────────────────────┐
  │  SourceEstimate  │◀──────│ Forward ← BEM ← SourceSpaces ←   │
  │  stc, cortex     │        │ subject MRI (fsaverage or own)   │
  │  VolSourceEstimate│       │ Covariance ← baseline / emptyroom│
  └────────┬─────────┘        └─────────────────────────────────┘
           ▼
   Labels / parcellation time-courses · morph to fsaverage · dipoles
```

| Container | What it holds | Key state | Produced by |
|---|---|---|---|
| **`Raw`** | continuous signal + `Info` + `Annotations` + projectors | `bads`, `montage`, `highpass/lowpass`, `projs`, `ref` | `read_raw_*`, `RawArray`, `concatenate_raws`, ICA/SSP apply, `stc → apply_inverse_raw` |
| **`Info`** | channel names/types/positions, sfreq, filters, device→head transform, digitization, projectors, `meas_date` |, | carried by every container |
| **`Annotations`** | `onset / duration / description` list, `orig_time` |, | file, `annotate_*`, manual, events↔annotations |
| **`Epochs`** | `n_epochs × n_chan × n_times` + `events` + `event_id` + `metadata` (DataFrame) | `drop_log`, `baseline`, `reject/flat`, `selection` | `mne.Epochs(raw, events…)`, `read_epochs`, `EpochsArray` |
| **`Evoked`** | one condition's average (or GFP/std) | `nave`, `comment`, `baseline` | `epochs.average()`, `combine_evoked`, `grand_average`, `read_evokeds` |
| **`Spectrum` / `EpochsSpectrum`** | PSD: `freqs × chan` (Welch or multitaper) | method, `fmin/fmax` | `.compute_psd()` on Raw/Epochs/Evoked |
| **`AverageTFR` / `EpochsTFR` / `RawTFR`** | power (& ITC) over `freqs × times × chan` | method (Morlet/multitaper/Stockwell), baseline | `tfr_morlet`, `tfr_multitaper`, `tfr_stockwell`, `raw.compute_tfr()` |
| **`ICA`** | unmixing/mixing matrices, `n_components_`, `exclude`, PCA | fitted-on, `exclude`, per-comp scores | `ICA().fit(raw|epochs)` |
| **`Projection` (SSP)** | spatial projection vectors | active/inactive | `compute_proj_*`, file |
| **`SourceSpaces`** | dipole grid: surface (`oct6`, `ico5`) or volume | subject, spacing | `setup_source_space`, `setup_volume_source_space` |
| **`BEM` model / solution** | head-compartment conductivity geometry | conductivities, `ico` | `make_bem_model` → `make_bem_solution`, `make_watershed_bem` |
| **`Forward`** | leadfield `n_chan × n_dipoles×3` | fixed/free orientation | `make_forward_solution` |
| **`Covariance`** | noise (or data) covariance `n_chan × n_chan` | method, rank, `nfree` | `compute_covariance` (epochs), `compute_raw_covariance`, `make_ad_hoc_cov` |
| **`InverseOperator`** | prepared inverse (fwd + cov + source cov + whitener) | loose, depth, method-independent | `make_inverse_operator` |
| **`SourceEstimate` (+Vol/Vector/Mixed)** | activation per source vertex over time | `subject`, `vertices`, `tmin/tstep` | `apply_inverse[_raw/_epochs]`, `apply_lcmv`, `apply_dics`, `mixed_norm`, `gamma_map` |
| **`Label` / `BiHemiLabel`** | a set of surface vertices (an ROI) | name, hemi, color | `read_labels_from_annot`, `grow_labels`, `stc_to_label` |
| **`Dipole`** | discrete dipole fit(s) over time | position, orientation, GOF, amplitude | `fit_dipole` |
| **`Report`** | ordered HTML sections |, | `mne.Report().add_*` |

### 1.2 Processing stages (the verbs)

The pipeline everyone repeats by hand. Each stage is a UI "operation group".

| # | Stage | Core operations | Inputs → output |
|---|---|---|---|
| 0 | **Ingest** | `read_raw_*` · `read_raw_bids` · `RawArray` · `anonymize` · `concatenate_raws` · `crop` · `resample` | file → `Raw` |
| 1 | **Montage & channels** | `set_montage` (standard ×~30 / custom file / `make_dig_montage`) · `set_channel_types` · `rename_channels` · `set_eeg_reference` (average / REST / bipolar / specific) · `set_bipolar_reference` · `pick` / `drop_channels` / `reorder_channels` / `add_reference_channels` · `interpolate_bads` | `Raw` → `Raw` |
| 2 | **Filter & repair** | `filter` (FIR/IIR, design params) · `notch_filter` (fixed / `spectrum_fit`) · `apply_hilbert` · `savgol_filter` · Maxwell/SSS (`maxwell_filter`, `find_bad_channels_maxwell`, cHPI) · OTP · `compute_current_source_density` (Laplacian) · fNIRS chain (`optical_density` → `beer_lambert_law`, `scalp_coupling_index`, `tddr`) | `Raw` → `Raw` |
| 3 | **Artifact ID** | `annotate_muscle_zscore` · `annotate_amplitude` · `annotate_break` · `annotate_movement` · `find_eog_events` / `find_ecg_events` · `create_eog_epochs` / `create_ecg_epochs` · `regress_artifact` (EOG regression) · `find_bad_channels_lof` | `Raw` → `Annotations` / bad list |
| 4 | **Decompose** | **ICA** (`fastica` / `infomax` / `extended-infomax` / `picard`; `find_bads_eog/ecg/muscle/ref`; **ICLabel** via `mne-icalabel`; `apply`) · **SSP** (`compute_proj_raw/epochs`, `compute_proj_ecg/eog`, `apply_proj`) | `Raw` → `ICA` / `Projection`, then `Raw` → `Raw` |
| 5 | **Segment** | `find_events` · `events_from_annotations` · `make_fixed_length_events` · `merge_events` / `define_target_events` · `mne.Epochs(...)` (baseline, reject/flat, `reject_by_annotation`, decim, detrend) · `make_metadata` · autoreject · `equalize_event_counts` · `drop_bad` | `Raw` → `Epochs` |
| 6 | **Average** | `epochs.average()` (mean / median / robust) · `combine_evoked` · `grand_average` · `apply_baseline` · `.get_peak()` · rERP (`linear_regression_raw`) | `Epochs` → `Evoked` |
| 7 | **Spectral** | `compute_psd` (Welch / multitaper) · `tfr_morlet` / `tfr_multitaper` / `tfr_stockwell` · ITC · `csd_*` · band power | Raw/Epochs/Evoked → `Spectrum` / `TFR` |
| 8 | **Source, model** | `fetch_fsaverage` / dataset MRIs · `setup_source_space` / `setup_volume_source_space` · `make_bem_model` → `make_bem_solution` (`make_watershed_bem`) · **coregistration** (`Coregistration`, `mne coreg`, fiducials + ICP) · `make_forward_solution` | MRI + `Info` + trans → `SourceSpaces` + `BEM` + `Forward` |
| 9 | **Source, estimate** | `compute_covariance` / `compute_raw_covariance` (+ regularization, rank) · `make_inverse_operator` · `apply_inverse[_raw/_epochs]` (MNE / dSPM / sLORETA / eLORETA) · beamformers `make_lcmv` / `make_dics` · `mixed_norm` / `gamma_map` · `fit_dipole` · RAP/TRAP-MUSIC | `Evoked`/`Epochs`/`Raw` + `Forward` + `Covariance` → `SourceEstimate` / `Dipole` |
| 10 | **Source, interpret** | `extract_label_time_course` · `read_labels_from_annot` (aparc / a2009s / HCPMMP1 / Yeo) · `SourceMorph` (→ fsaverage) · `stc.get_peak` · `save_as_volume` → NIfTI | `SourceEstimate` → label time-courses / group-space stc |
| 11 | **Connectivity** *(mne-connectivity)* | `spectral_connectivity_epochs` / `_time` (coh, imcoh, PLV, ciPLV, wPLI, PLI, PPC, GC) · `envelope_correlation` · `vector_auto_regression` · `phase_slope_index` | Epochs / label-TC → `Connectivity` |
| 12 | **Decode** *(mne.decoding)* | `Scaler` / `Vectorizer` / `UnsupervisedSpatialFilter` · `CSP` / `SPoC` · `SlidingEstimator` / `GeneralizingEstimator` + `cross_val_multiscore` · `ReceptiveField` (mTRF/STRF) · `EMS` · `get_coef` (+ `LinearModel` patterns) | `Epochs` → scores / patterns |
| 13 | **Statistics** | `permutation_cluster_test` / `_1samp_test` · `spatio_temporal_cluster_test` · TFCE · `f_mway_rm` · `fdr_correction` / `bonferroni_correction` · `bootstrap_confidence_interval` · adjacency (`find_ch_adjacency`, `spatio_temporal_src_adjacency`) | arrays → clusters / p-maps |
| 14 | **Export & report** | `save` (fif) · `export` (EDF / EEGLAB / BrainVision / EDF) · `write_raw_bids` (+ derivatives) · `mne.Report` (HTML) · `to_data_frame` · `pipeline.py` codegen · events / annotations files | any → files |

### 1.3 Modalities & formats

MNE is not EEG-only. Channel types the same containers carry:

| Modality | Channel types | Notes for the UI |
|---|---|---|
| **EEG** | `eeg`, `ref_meg` | the current focus |
| **MEG** | `mag`, `grad` (+ `ref_meg` for CTF/4D) | needs per-type scaling, helmet (not scalp) topomap, SSS stage |
| **sEEG / ECoG / DBS** | `seeg`, `ecog`, `dbs` | electrodes on a brain surface / depth, `plot_alignment`, `snapshot_brain_montage`, `locate_ieeg` GUI, gray-matter reref |
| **fNIRS** | `fnirs_cw_amplitude`, `fnirs_od`, `hbo`, `hbr` | dedicated preprocessing chain; source-detector layout, not a montage |
| **Eyetracking** | `eyegaze`, `pupil` | `read_raw_eyelink`, gaze plots, blink annotations, EEG↔ET alignment |
| **Auxiliary bio** | `eog`, `ecg`, `emg`, `bio`, `gsr`, `temperature`, `resp` | ride along; used for artifact regression / HEP |
| **Stim** | `stim` | event extraction source |

**Readers** (`mne.io.read_raw_*`, one call per format, extension-sniffable):

`edf` `bdf` `gdf` · `brainvision` (.vhdr+.eeg+.vmrk) · `eeglab` (.set+.fdt) ·
`fif` (+ MEGIN/Elekta) · `ctf` (.ds) · `kit` (.sqd/.con) · `bti`/4D · `artemis123` ·
`egi` (.mff, .raw) · `nihon` (.eeg) · `nicolet` · `persyst` (.lay) · `cnt` (Neuroscan) ·
`curry` (.dat/.cdt) · `eximia` (.nxe) · `ant` (eego .cnt) · `neuralynx` · `nsx` (Blackrock) ·
`fil` (OPM) · `snirf` · `nirx` · `hitachi` · `boxy` · `eyelink` (.asc) · `xdf` (via pyxdf) ·
`fieldtrip` · `RawArray` (numpy) · **BIDS** via `mne-bids`

**Standard montages** (`make_standard_montage`): `standard_1005/1020`, `biosemi16/32/64/128/160/256`, `easycap-M1/M10`, `GSN-HydroCel-32…256`, `mgh60/70`, `standard_alphabetic`, `standard_postfixed/prefixed/primed`, `artinis-*` (fNIRS). **Custom**: `.bvef .elc .elp .sfp .csd .hpts .xyz .loc`, or digitized (`read_dig_polhemus_isotrak`, `read_dig_captrak`, `read_dig_egi`, …).

### 1.4 Visualization catalog

~60 plot types. Grouped by what container they belong to, this **is** the card
catalog for the workspace.

| Container | Plots (MNE method / `mne.viz.*`) |
|---|---|
| **Raw** | `plot` (scroller) · `plot_psd` · `plot_psd_topo` · `plot_sensors` (2D/3D) · `plot_projs_topomap` · `plot_montage` · annotations overlay |
| **Epochs** | `plot` (scroller) · `plot_image` / `plot_topo_image` · `plot_drop_log` · `plot_psd` · `plot_psd_topomap` · ERP-image sorted by metadata |
| **Evoked** | `plot` (butterfly) · `plot_joint` (butterfly + topo pins) · `plot_topomap` (grid / sequence / `animate_topomap`) · `plot_image` · `plot_topo` · `plot_white` (whitened GFP) · `plot_field` (scalp/helmet field map) · `plot_compare_evokeds` |
| **Spectrum** | `plot` · `plot_topo` · `plot_topomap` (band grid) |
| **TFR** | `plot` (per channel) · `plot_joint` · `plot_topo` · `plot_topomap` (time×freq window) · ITC variants |
| **ICA** | `plot_components` (topo grid) · `plot_properties` (topo + epochs-image + ERP + PSD + variance) · `plot_sources` · `plot_overlay` (clean vs raw) · `plot_scores` (find_bads correlation) |
| **Covariance** | `plot` (matrix + eigenspectrum) · `plot_cov` · whitened-evoked check |
| **Forward / BEM / coreg** | `plot_alignment` (3D: head, sensors, sources, MRI) · `plot_bem` (MRI slices + surfaces) · sensitivity maps (`sensitivity_map`) |
| **SourceEstimate** | `stc.plot` (inflated brain, PyVista) · `plot_3d` · `plot_volume_source_estimates` (ortho slices) · label-TC line plots · `Brain` (add_data / add_annotation / add_label / add_foci / save_movie) |
| **Dipole** | `plot_locations` (3D / ortho) · `plot_amplitudes` · GOF over time |
| **Connectivity** | `plot_connectivity_circle` (connectogram) · matrix heatmap · `plot_sensors_connectivity` (3D lines) |
| **Decoding** | score-over-time · temporal generalization matrix · CSP patterns (topomaps) · TRF weights |
| **Stats** | cluster time-course with sig. bars · cluster topomap/brain masks · p-histogram |
| **Group / misc** | `plot_ch_adjacency` · Report thumbnails · `plot_events` (event raster) |

---

## Part 2: the container-centric UI model

The shipped shell is two tab axes and one viewport, Excel-style.

- **The ribbon** along the top is the **verb** axis: Home, Clean, Decompose,
  Epochs, Source, View, Export. Each tab is a row of grouped controls.
- **The container strip** along the bottom is the **noun** axis, and it is the
  graph in §1.1. The route segment *is* the container. A chip greys out until
  the operation that produces it has run.
- **One viewport** in between, holding the workspace for the active container.
  Any pane maximizes.
- **One transport and one overview strip** above the container strip, so the
  recording's silhouette and the shared clock are always in view.

Three shells were tried before this one. A left container rail plus a right
inspector spent 27.6% of the screen on chrome; a Signal / Analysis / Pipeline
split defined "Analysis" by negation and became a junk drawer. The grading
metric that settled it was **degrees of separation**: the number of actions
between the user and each MNE capability, which must be inversely proportional
to how often that capability is used.

The table below is the *target* per container, not a description of what is
built. Read the status column in Part 3 for that.

### Per-container workspace definitions

| Active container | Default cards | Operations offered (stage) | Inspector | Gated on |
|---|---|---|---|---|
| **Raw** | waveform · sensors 2D · PSD · annotations track | Ingest, Montage & channels, Filter & repair, Artifact ID, Decompose, Segment | channel (type, PSD, mark bad/interp), annotation |, |
| **ICA** | component grid · **properties** (selected) · sources scroller · overlay preview | fit params · auto-label (ICLabel) · `find_bads_*` · exclude · **apply** (guarded) | component (label, scores, variance, "why flagged") | montage; raw ≥1 Hz hi-pass |
| **Epochs** | epochs image · drop-log · evoked butterfly · PSD-by-condition | reject/flat · autoreject · metadata query · equalize · **average** | epoch (drop reason), condition | events exist |
| **Evoked** | butterfly · joint (topo pins) · topo sequence · compare-conditions · field map | baseline · combine · grand-average · peak · → Source | condition, peak/time | ≥1 Evoked |
| **Spectrum** | PSD (mean±CI) · band topomap row · PSD small-multiples (montage-positioned) | method (Welch/multitaper) · window · bands · → per-epoch | channel/band | montage for topo |
| **TFR** | TFR heatmap (channel) · joint · topo-over-time · ITC | Morlet/multitaper/Stockwell params · baseline · ROI | channel, time-freq box |, |
| **Source** | **3D brain** (inflated fsaverage) · source-time-course strip · label time-courses · parcellation table | setup wizard (space→BEM→coreg→fwd) · covariance · inverse method · beamformer · dipole fit | vertex/label (peak, waveform), MRI slice | forward + covariance |
| **Connectivity** | connectogram · matrix · 3D sensor lines | method · band · node grouping | edge (nodes, value, spectrum) | epochs or label-TC |
| **Decoding** | score-over-time · generalization matrix · CSP/TRF patterns | estimator · CV · features · sliding vs generalizing | fold, pattern topomap | epochs + ≥2 conditions |

### How each thing is rendered

- **Interactive canvas cards** (client-drawn, cursor-linked, 60 fps): waveform,
  PSD, band heatmap, TFR heatmap, minimap, IC time-course, connectivity matrix,
  score-over-time. One renderer (WebGL lines + canvas raster).
- **Server-rendered image cards** (matplotlib-Agg or PyVista-offscreen → PNG,
  cached by `(container-hash, view, params, cursor-bucket)`): topomaps, ICA
  `plot_properties`, evoked `plot_joint`, `plot_alignment`, BEM slices,
  connectogram, **the 3D brain** (frames keyed to cursor time). Same mechanism as
  today's ICA topo PNGs: see `backend/app/core/render.py`.
- **Tables**: events, epochs metadata, drop-log, label time-courses, dipole fits,
  cluster stats.
- **Wizards** (a gated multi-step form, not a card): source setup, BIDS export,
  epoching-from-scratch.

### The 3D brain, specifically (why it's not there yet)

The panel currently labelled "Scalp field" is **not** a brain, it's an
inverse-distance interpolation of sensor voltages drawn as an oblique wireframe
(`ScalpField3D.tsx` + `wire.field_at`). The tutorial's
[`stc.plot()`](https://mne.tools/stable/auto_tutorials/inverse/10_stc_class.html)
renders an **estimated cortical current distribution** on an inflated brain, a
different quantity that requires the entire **Source, model** and **Source -
estimate** stages (§1.2 rows 8–9), none of which exist:

1. a source space (`fetch_fsaverage`, ~1 GB one-time),
2. a BEM + `make_forward_solution`,
3. a `Covariance` (needs a baseline / empty-room / epochs),
4. `make_inverse_operator` + `apply_inverse` (dSPM/sLORETA/eLORETA), and
5. an offscreen PyVista/VTK renderer server-side.

It's a real multi-phase feature,
gated behind a setup wizard. An honest intermediate that needs *none* of the
inverse pipeline: `mne.make_field_map` + `evoked.plot_field`, a principled
scalp/helmet field map (spherical-spline / minimum-norm surface), which is what
`ScalpField3D` approximates by hand. And a flat 2-D `plot_topomap` at the cursor
is a one-day add.

---

## Part 3: coverage matrix

Status: ✅ built · 🟡 partial · ⬜ missing. Priority: **P1**=next shell, then by phase.

### Ingest & I/O

| Capability | Status | UI home | Priority |
|---|---|---|---|
| `read_raw_edf/bdf/fif/brainvision/eeglab/cnt/gdf` | ✅ | Connect |, |
| Multi-file formats (BrainVision trio, EEGLAB .set+.fdt) | ⬜ | Connect (group-by-stem drop) | P2 |
| EGI, Persyst, Nihon Kohden, Curry, ANT, Neuralynx, SNIRF/NIRx, EyeLink, XDF | ⬜ | Connect (reader registry) | P2 |
| MEG readers (CTF, KIT, 4D, FIF-MEG) | ⬜ | Connect + per-type scaling | P5 |
| `read_raw_bids` / `write_raw_bids` / derivatives | ⬜ | Connect + Export wizard | P8 |
| Sample datasets (`eegbci`, `sample`, `somato`, `fnirs_motor`, `ssvep`, `erp_core`…) | 🟡 (1 synthetic demo) | Connect → dataset picker | P1 |
| `anonymize`, `crop`, `concatenate_raws` | ⬜ | Raw ops | P2 |
| `export` → EDF / EEGLAB / BrainVision | ⬜ | Export | P8 |

### Montage, channels, reference

| Capability | Status | UI home | Priority |
|---|---|---|---|
| `set_montage` standard | ✅ (7 offered) | Montage op | 🟡→P2 (all ~30 + custom-file) |
| Custom montage file (`.elc/.sfp/.bvef/…`), digitized | ⬜ | Montage op → upload | P2 |
| `set_eeg_reference` average / specific | ✅ | Reference op |, |
| REST reference, `set_bipolar_reference`, keep/drop ref chan | ⬜ | Reference op (mode switch) | P2 |
| `set_channel_types`, `rename_channels`, `reorder_channels` | ✅ | Channels workspace |, |
| `drop_channels` | ✅ | Channels workspace |, |
| `pick` / `add_reference_channels` | ⬜ | Channels workspace | P2 |
| **`interpolate_bads`** (spherical spline) | ✅ | Raw op |, |
| `compute_current_source_density` (Laplacian) | ⬜ | Filter & repair op | P5 |
| `find_bad_channels_lof` / RANSAC-style auto-bad | ✅ (LOF) | Channels workspace → Detect bad |, |

### Filter & repair

| Capability | Status | UI home | Priority |
|---|---|---|---|
| `filter` band/high/low | ✅ | Filter op |, |
| Filter **design** (FIR/IIR, transition bw, phase, window) + response preview | ⬜ | Filter op (advanced) | P2 |
| `notch_filter` fixed | ✅ | Notch op |, |
| `notch_filter(method='spectrum_fit')`, harmonics helper | ⬜ | Notch op | P2 |
| `resample` | ✅ | Resample op |, |
| `apply_hilbert` (envelope), `savgol_filter` | ⬜ | Filter & repair op | P5 |
| Maxwell / SSS / tSSS, cHPI, `find_bad_channels_maxwell` | ⬜ | MEG-only stage | P5 |
| fNIRS chain (`optical_density`, `beer_lambert_law`, `scalp_coupling_index`, `tddr`) | ⬜ | fNIRS-only stage | P5 |

### Artifact identification

| Capability | Status | UI home | Priority |
|---|---|---|---|
| `annotate_muscle_zscore`, `annotate_amplitude` | ✅ | Artifact ID ops → write Annotations |, |
| `annotate_break` | ⬜ | Artifact ID op | P3 |
| `find_eog_events` / `find_ecg_events`, `create_eog/ecg_epochs` | ⬜ | Artifact ID op | P3 |
| `regress_artifact` (EOG regression) | ⬜ | Artifact ID op | P3 |
| Manual annotation create/edit/label | ✅ | Channels workspace → Annotations; drawn as spans on the trace |, |

### Decompose (ICA / SSP)

| Capability | Status | UI home | Priority |
|---|---|---|---|
| ICA fit (`fastica`) | ✅ | ICA workspace |, |
| Other methods (`infomax`, `picard`) | ⬜ | fit params | P3 |
| `plot_components` grid | ✅ (PNG) | ICA workspace |, |
| **`plot_properties`** (full 5-panel) | 🟡 (TC + PSD only) | ICA properties card | P3 |
| **ICLabel** auto-classification (`mne-icalabel`) | ✅ | ICA workspace: class badges, artifacts-first sort, auto-mark |, |
| `find_bads_eog/ecg/muscle/ref` + `plot_scores` | ⬜ | ICA workspace | P3 |
| `plot_overlay` clean-vs-raw preview before apply | ⬜ | ICA workspace / Waveform ghost | P3 |
| Apply (revertible) | ✅ | ICA workspace |, |
| SSP: `compute_proj_*`, `compute_proj_ecg/eog`, toggle/apply, `plot_projs_topomap` | ⬜ | Projectors op + card | P3 |

### Segment / Epochs / Evoked

| Capability | Status | UI home | Priority |
|---|---|---|---|
| `events_from_annotations`, `make_fixed_length_events` → Epochs | ✅ | Epochs workspace + Epochs ribbon tab |, |
| `find_events` (stim channel), `merge_events`, `define_target_events` | ⬜ | Segment op | P4 |
| `Epochs` peak-to-peak reject, baseline | ✅ | make_epochs params |, |
| `Epochs` flat, decim, detrend, `reject_by_annotation` flag | ⬜ | make_epochs params | P4 |
| autoreject (global + local) | ⬜ | Segment op | P4 |
| `make_metadata` + pandas-query epoch selection | ⬜ | Epochs workspace (metadata table) | P4 |
| `plot_image` (ERP image) + drop log | ✅ | Epochs workspace |, |
| `plot_topo_image` | ⬜ | Epochs workspace | P4 |
| `epochs.average()` (mean) | ✅ | Evoked workspace |, |
| median/robust average, `combine_evoked`, `grand_average` | ⬜ | Average op | P4 |
| Evoked butterfly + latency-linked topomap (a live `plot_joint`) | ✅ | Evoked workspace |, |
| `plot_topomap` sequence / `animate_topomap` / `plot_white` | ⬜ | Evoked cards | P4 |
| `plot_compare_evokeds` (conditions ± CI) | ⬜ | Evoked compare card | P4 |
| `get_peak`, GFP | ✅ | Evoked workspace header and trace |, |
| rERP `linear_regression_raw` | ⬜ | Average op (advanced) | P7 |

### Spectral & time-frequency

| Capability | Status | UI home | Priority |
|---|---|---|---|
| `compute_psd` Welch, whole recording | ✅ | Spectrum card |, |
| Multitaper PSD | ⬜ | method switch | P5 |
| Windowed PSD (`start`/`dur`, animates on playback) | ⬜ | Spectrum card + transport | P5 |
| Band power table / heatmap | ✅ | Band power card |, |
| Band topomap (single) | ✅ (PNG) | Topography card |, |
| Band topomap **row** δθαβγ | ⬜ | Topography card view | P3 |
| PSD small-multiples (montage-positioned) | ⬜ | Spectrum card view | P5 |
| **`tfr_morlet`** (baseline-corrected dB) | ✅ | TFR workspace |, |
| `tfr_multitaper` / `tfr_stockwell` + ITC | ⬜ | TFR workspace, method switch | P5 |
| `csd_*` (cross-spectral density) | ⬜ | (feeds DICS + connectivity) | P6/P7 |

### Source analysis

| Capability | Status | UI home | Priority |
|---|---|---|---|
| `fetch_fsaverage` + caching | ⬜ | Source wizard step 1 | **P6** |
| `setup_source_space` / `setup_volume_source_space` | ⬜ | Source wizard | P6 |
| BEM (`make_bem_model/solution`, watershed) | ⬜ | Source wizard | P6 |
| Coregistration (`Coregistration`, fiducials, ICP) | ⬜ | Source wizard (3D `plot_alignment`) | P6 |
| `make_forward_solution` (+ `plot_alignment`, sensitivity maps) | ⬜ | Source wizard | P6 |
| `compute_covariance` / `compute_raw_covariance` (+ regularization, rank, `plot_cov`) | ⬜ | Covariance op | P6 |
| `make_inverse_operator` + `apply_inverse[_raw/_epochs]` (MNE/dSPM/sLORETA/eLORETA) | ⬜ | Inverse op | P6 |
| Beamformers `make_lcmv` / `make_dics` | ⬜ | Inverse op (method) | P6 |
| `mixed_norm` / `tf_mixed_norm` / `gamma_map` (sparse) | ⬜ | Inverse op (advanced) | P7 |
| `fit_dipole` + `Dipole.plot_locations` | ⬜ | Dipole op + card | P6 |
| **`stc.plot()`, inflated brain** (PyVista offscreen → frames) | ⬜ | Source workspace, the 3D brain | **P6** |
| `plot_volume_source_estimates` (ortho slices) | ⬜ | Source workspace (volume mode) | P6 |
| `extract_label_time_course` + parcellations (aparc / a2009s / HCPMMP1 / Yeo) | ⬜ | Source workspace (label table + TC) | P6 |
| `SourceMorph` → fsaverage (group) | ⬜ | Source op | P7 |
| RAP-MUSIC / TRAP-MUSIC | ⬜ | Inverse op (advanced) | P7 |

### Connectivity / decoding / stats

| Capability | Status | UI home | Priority |
|---|---|---|---|
| `spectral_connectivity_epochs/_time` (coh, PLV, wPLI, PLI, GC…) | ⬜ | Connectivity workspace | P7 |
| `envelope_correlation`, `phase_slope_index`, `vector_auto_regression` | ⬜ | Connectivity workspace | P7 |
| `plot_connectivity_circle`, matrix, 3D sensor lines | ⬜ | Connectivity cards | P7 |
| `CSP` / `SPoC` + patterns | ⬜ | Decoding workspace | P7 |
| `SlidingEstimator` / `GeneralizingEstimator` + `cross_val_multiscore` | ⬜ | Decoding workspace | P7 |
| `ReceptiveField` (mTRF / STRF) | ⬜ | Decoding workspace | P7 |
| `permutation_cluster_*`, `spatio_temporal_cluster_*`, TFCE | ⬜ | Stats op (on Epochs/Evoked/STC) | P7 |
| `fdr_correction` / `bonferroni_correction` | ⬜ | Stats op | P7 |

### Provenance, report, packaging

| Capability | Status | UI home | Priority |
|---|---|---|---|
| Ledger (append-only, replay, revert) | ✅ | Provenance strip |, |
| `pipeline.py` codegen | ✅ | Export |, |
| Provenance **DAG** (branch / compare "filter A vs B") | ⬜ | Provenance strip (tree) | P1 |
| `summary.csv` | ✅ | Export |, |
| **`mne.Report`** (HTML, every stage) | ⬜ | Export → Report | P8 |
| Disk persistence / recent sessions / session bundle | ⬜ | Connect + autosave | P8 |
| `sema.launch(raw)` / `sema <file>` plugin + CLI | ⬜ | (packaging) | P8 |
| Job system for long ops (ICA, forward, TFR, permutation) with progress | ⬜ | Transport / toast | **P0** |

---

> **Status note, 2026-09-03.** This matrix is behind the code. Since it was
> written, these moved ⬜ → ✅: `interpolate_bads`, `annotate_amplitude`, the
> provenance **DAG** (branch/fork), disk persistence + recent sessions, the job
> system, the sample-dataset picker (5 datasets), and the whole source chain
> (`compute_source` → `stc.plot()` brain + peak-vertex trace). Two Epochs
> endpoints exist but have no UI. Re-counted against the live registry and API
> routes, coverage was **≈ 35 of ≈ 180 capabilities (19 %)** at that point.
>
> **Updated 2026-09-08.** The two structural blocks named above are gone. There is
> a channels workspace (rename / retype / drop / mark bad / automatic LOF
> detection) and an annotations editor, and the whole epoched chain exists
> (`make_epochs` → `average_epochs` → `compute_tfr`) with an ERP image, a
> butterfly with a latency-linked topomap, and a baseline-corrected spectrogram.
> ICLabel classifies and auto-marks ICA components. The registry went from 10
> operations to 22; this table now shows **29 built of 164**
> rows. What remains is mostly breadth inside stages that exist (filter design,
> more ICA methods, more TFR methods) plus the two genuinely large gaps:
> **multi-recording / group analysis** and **connectivity**.

*Sources: MNE-Python 1.12 API reference, tutorials, and the `mne-icalabel` /
`mne-connectivity` / `mne-bids` companion packages. Keep this doc in sync when a
capability moves from ⬜ to ✅.*
