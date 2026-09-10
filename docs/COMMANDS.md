# Controls

Two axes and one viewport.

- **The ribbon** across the top is **verbs**: what you want to do. Its tabs are
  Home, Clean, Decompose, Epochs, Source, View, Export.
- **The container strip** across the bottom is **nouns**: which MNE object you
  are looking at. Raw, Channels, ICA, Epochs, Evoked, TFR, Source. Most of them
  are filled in for you as the recording loads, so they open with a figure
  instead of a form; Connectivity is drawn as a ghost because it is not built.

Everything in between is one surface, and everything on it answers to the same
clock.

## Automatic contents

ICA, Epochs, Evoked, TFR and Source are computed on a filtered copy while the
recording loads, with documented defaults, so you can see what is there before
deciding what to do about it. Those panes carry a line under the header naming
what was run, and a warning triangle beside the expand button that opens the
exact MNE call and every assumption behind it.

None of it is in the ledger, so `pipeline.py` still exports only what you ran.
Running the real operation replaces the automatic result and clears the badge.
Source needs the fsaverage template already on disk; without it that workspace
stays empty and offers to fetch it.

## The two clocks

The recording clock runs in file seconds. Everything downstream of `mne.Epochs`
runs in trial seconds, where zero is the event. When the transport cursor lands
inside a trial, the ERP image highlights that trial, the evoked butterfly and
its topography move to that latency, and the spectrogram column follows. When it
lands between trials, those panes say so and keep their own default rather than
inventing a link. Clicking any of them moves the transport cursor back.

---

## Keyboard

| Key | |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette: every operation, filtered to what the current container can do |
| `⌘1` `⌘2` `⌘3` | Signal · Channels · ICA |
| `Space` | Play / pause |
| `←` `→` | Page the window |
| `Shift` + `←` `→` | Nudge the cursor one second |
| `[` `]` | Shrink / grow the window |
| `Esc` | Exit a maximized pane |

Any pane can be maximized from the arrows in its top-right corner.

---

## The operations

Twenty-two, each one MNE call, each recorded. The palette is the fastest way to
any of them; the ribbon groups the common ones.

| Stage | Operation | MNE |
|---|---|---|
| Ingest & assembly | Resample | `raw.resample(sfreq)` |
| Montage & channels | Set montage | `raw.set_montage(name)` |
| | Mark bad channels | `raw.info["bads"] = [...]` |
| | Set reference | `raw.set_eeg_reference(...)` |
| | Drop channels | `raw.drop_channels(...)` |
| | Rename channels | `raw.rename_channels(...)` |
| | Reorder channels | `raw.reorder_channels(...)` |
| | Set channel types | `raw.set_channel_types(...)` |
| Filter & repair | Band-pass | `raw.filter(l_freq, h_freq)` |
| | Notch | `raw.notch_filter(freqs)` |
| | Detect bad channels | `preprocessing.find_bad_channels_lof(raw)` |
| | Interpolate bads | `raw.interpolate_bads()` |
| Artifact ID | Annotate by amplitude | `preprocessing.annotate_amplitude(...)` |
| | Detect muscle | `preprocessing.annotate_muscle_zscore(...)` |
| | Set annotations | `raw.set_annotations(...)` |
| Decompose | Fit ICA | `preprocessing.ICA(...).fit(raw)` |
| | Classify components | `mne_icalabel.label_components(raw, ica, "iclabel")` |
| | Exclude by label | `ica.exclude = [...]` |
| Epoching | Make epochs | `mne.Epochs(raw, events, tmin, tmax)` |
| Evoked | Average epochs | `epochs.average()` |
| Time-frequency | Morlet TFR | `epochs.compute_tfr("morlet", ...)` |
| Source | Source estimate | `minimum_norm.apply_inverse_raw(...)` |

---

## The workspaces

**Signal.** The trace, with µV per division stated, a numbered time axis, and
the channel range in the header so you always know how many of the montage you
are looking at. Bad channels are struck through. Annotations are drawn as spans,
`BAD_*` in alert colour. Beside it, two visualisation panes you can each set to
Topography, 3D field, Spectrum or Band power. Drag across the topography to
sweep the whole recording through it.

**Channels.** A sortable table: name, type, peak-to-peak µV, standard deviation
µV, bad, shown, drop. Rename inline, retype from the dropdown, filter by name.
**Detect bad** runs `find_bad_channels_lof` and merges with your manual list.
Below it, the annotation table: create at the cursor, edit, delete, click to
seek. **Detect muscle** appends to your marks rather than replacing them.

**ICA.** The component grid, each card carrying its topography, the variance it
explains, and (after Classify) its ICLabel class and confidence. Artifacts sort
to the front. Click to inspect the activation and spectrum, double-click to mark
for removal, **Auto-mark** selects everything classified as an artifact at ≥80%,
**Apply** zeroes the marked components as a revertible step.

**Epochs.** The ERP image: one row per trial, diverging colour ramp centred on
zero. Drop count and reasons in the header.

**Evoked.** Butterfly with global field power, and a topography at whatever
latency you click.

**TFR.** Morlet power, baseline-corrected in dB, with the event onset marked and
the colour scale numbered at both ends.

**Source.** The inflated `fsaverage` brain with the dSPM estimate on it, and the
peak vertex time course.

**Pipeline.** Every step, with the MNE call that made it. Click a step to see
its parameters and fork from it. Copy the script, or download `pipeline.py`,
`raw.fif`, `epochs.fif`, `summary.csv`.

---

## Provenance

Every operation appends a ledger entry. Reverting to an earlier step and
re-running **forks** rather than overwrites: both branches survive and either is
one click away. `pipeline.py` is generated from the path you are standing on, so
it reproduces the session you actually have, not an idealised version of it.
