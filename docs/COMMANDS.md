# EEGvis — controls

EEGvis is a point-and-click UI over MNE-Python. Every operation is a button in
the **toolbar** (top of the workspace); every operation appends a step to the
**Pipeline** panel, which drives revert and `export py`.

## Toolbar

| Control | MNE call |
|---|---|
| **Filter** — low / high Hz (blank or `-` = open end) | `raw.filter(l_freq, h_freq)` |
| **Notch** — comma-separated frequencies | `raw.notch_filter(freqs)` |
| **Reference** — average or specific channels | `raw.set_eeg_reference(...)` |
| **Montage** — standard montage picker | `raw.set_montage(...)` |
| **Resample** — new sampling rate | `raw.resample(sfreq)` |
| **Bad channels** — checklist of channel names | `raw.info['bads'] = [...]` |
| **ICA** — opens the ICA workspace | `mne.preprocessing.ICA` |
| **Export** — `pipeline.py` · `summary.csv` · cleaned `raw.fif` | — |

## ICA workspace

Fit → grid of component topographies (variance % per component). Click a card to
inspect its activation time-course (cursor-linked) and spectrum; double-click to
mark it for removal. **Apply** zeroes the marked components (recorded as a
revertible step).

## Panels

The bottom strip switches / solos panels: Waveform · Scalp field · Spectrum ·
Band power · ICA · Pipeline · Overview. `Workspace / Focus / Report` change the
layout.

## Keyboard

`Space` play/pause · `←/→` page the window · `Shift+←/→` nudge cursor 1 s ·
`[` `]` shrink / grow the window · `F1…F7` solo a panel · `Esc` un-solo.

## Provenance

Every toolbar action and ICA apply is a step in the Pipeline panel. `revert to
here` rebuilds the recording from the pristine original by replaying earlier
steps. `export py` emits a runnable MNE script of the whole sequence.
