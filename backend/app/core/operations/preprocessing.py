"""Raw-stage operations: montage & channels, reference, filter & repair.

Each ``Operation`` delegates to the matching ``Session`` method (which records
the ledger entry and stays replay-safe). New capabilities are added here, not
as new routes.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from app.core.containers import ContainerKind
from app.core.operations.base import Operation, OpParams, register

RAW = (ContainerKind.RAW,)


# --- filter & repair -----------------------------------------------------

class FilterParams(OpParams):
    l_freq: Optional[float] = Field(1.0, description="High-pass edge in Hz (null = no high-pass)")
    h_freq: Optional[float] = Field(40.0, description="Low-pass edge in Hz (null = no low-pass)")


register(Operation(
    id="filter", stage="Filter & repair", label="Band-pass filter",
    inputs=RAW, params_model=FilterParams,
    run=lambda s, p: s.filter(p.l_freq, p.h_freq),
    doc="FIR band-pass (or high-/low-pass if one edge is null). raw.filter",
))


class NotchParams(OpParams):
    freqs: list[float] = Field([60.0],
                               description="Line-noise frequencies to notch, e.g. [60] or [50, 100]")


register(Operation(
    id="notch", stage="Filter & repair", label="Notch filter",
    inputs=RAW, params_model=NotchParams,
    run=lambda s, p: s.notch(p.freqs),
    doc="Notch out line noise and harmonics. raw.notch_filter",
))


class ResampleParams(OpParams):
    sfreq: float = Field(..., gt=0, description="Target sample rate in Hz")


register(Operation(
    id="resample", stage="Ingest & assembly", label="Resample",
    inputs=RAW, params_model=ResampleParams,
    run=lambda s, p: s.resample(p.sfreq),
    doc="Change the sample rate. raw.resample",
))


class InterpolateBadsParams(OpParams):
    reset_bads: bool = Field(True, description="Clear the bad list after interpolating")


register(Operation(
    id="interpolate_bads", stage="Filter & repair", label="Interpolate bad channels",
    inputs=RAW, params_model=InterpolateBadsParams, requires=("montage", "has_bads"),
    run=lambda s, p: s.interpolate_bads(p.reset_bads),
    doc="Spherical-spline interpolation of the channels marked bad. raw.interpolate_bads",
))


class AnnotateAmplitudeParams(OpParams):
    peak_uv: float = Field(150.0, gt=0, description="Peak-to-peak threshold (µV) — spans above this become BAD")
    flat_uv: Optional[float] = Field(None, description="Flat-signal threshold (µV); null = skip flat detection")


register(Operation(
    id="annotate_amplitude", stage="Artifact ID", label="Annotate by amplitude",
    inputs=RAW, params_model=AnnotateAmplitudeParams,
    run=lambda s, p: s.annotate_amplitude(p.peak_uv, p.flat_uv),
    doc="Flag high-amplitude (and optionally flat) segments as BAD_. mne.preprocessing.annotate_amplitude",
))


# --- montage & reference -----------------------------------------------

_MONTAGES = Literal[
    "standard_1020", "standard_1005", "biosemi16", "biosemi32", "biosemi64",
    "biosemi128", "biosemi256", "easycap-M1", "easycap-M10", "GSN-HydroCel-32",
    "GSN-HydroCel-64_1.0", "GSN-HydroCel-128", "GSN-HydroCel-256", "mgh60", "mgh70",
]


class MontageParams(OpParams):
    montage_name: _MONTAGES = Field("standard_1020", description="A standard montage")


register(Operation(
    id="set_montage", stage="Montage & channels", label="Set montage",
    inputs=RAW, params_model=MontageParams,
    run=lambda s, p: s.set_montage(p.montage_name),
    doc="Attach standard electrode positions. raw.set_montage",
))


class ReferenceParams(OpParams):
    mode: Literal["average", "channels"] = Field(
        "average", description="average = common-average reference · channels = explicit")
    channels: list[str] = Field(default_factory=list, description="channel names, for mode='channels'")


def _run_reference(s, p) -> None:
    if p.mode == "average":
        s.set_reference("average")
    else:
        if not p.channels:
            raise ValueError("mode='channels' needs at least one channel name")
        s.set_reference(p.channels)


register(Operation(
    id="set_reference", stage="Montage & channels", label="Re-reference",
    inputs=RAW, params_model=ReferenceParams,
    run=_run_reference,
    doc="Common-average / REST / explicit reference. raw.set_eeg_reference",
))


class BadsParams(OpParams):
    bads: list[str] = Field(default_factory=list, description="Channel names to mark bad")


register(Operation(
    id="set_bads", stage="Montage & channels", label="Mark bad channels",
    inputs=RAW, params_model=BadsParams,
    run=lambda s, p: s.set_bads(p.bads),
    doc="Set raw.info['bads'].",
))


# --- decompose ---------------------------------------------------------

class FitICAParams(OpParams):
    n_components: int | float = Field(
        0.99, gt=0,
        description="int = exact component count; float in (0,1) = fraction of variance kept",
    )
    method: str = Field("fastica", description="fastica | infomax | picard")


register(Operation(
    id="fit_ica", stage="Decompose", label="Fit ICA",
    inputs=RAW, params_model=FitICAParams, output=ContainerKind.ICA,
    long_running=True, requires=("montage",),
    run=lambda s, p: s.fit_ica(p.n_components, p.method),
    doc="Fit an ICA decomposition (best on data high-passed >= 1 Hz). mne.preprocessing.ICA",
))


# --- source ----------------------------------------------------------

class SourceParams(OpParams):
    method: str = Field("dSPM", description="dSPM | MNE | sLORETA | eLORETA")
    center_t: float = Field(0.0, ge=0, description="Centre of the ~8 s window to localise (seconds)")


register(Operation(
    id="compute_source", stage="Source", label="Compute source estimate",
    inputs=RAW, params_model=SourceParams, output=ContainerKind.STC,
    long_running=True, requires=("montage",),
    run=lambda s, p: s.compute_source(p.method, p.center_t),
    doc=("Template source localisation: fsaverage forward + ad-hoc covariance + "
         "minimum-norm inverse over a window around the cursor. First run fetches "
         "fsaverage (~770 MB) and builds the forward solution (~15 s)."),
))
