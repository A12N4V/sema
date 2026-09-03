"""Raw-stage operations: montage & channels, reference, filter & repair.

Each ``Operation`` delegates to the matching ``Session`` method (which records
the ledger entry and stays replay-safe). New capabilities are added here, not
as new routes.
"""
from __future__ import annotations

from typing import Optional

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


# --- montage & reference -----------------------------------------------

class MontageParams(OpParams):
    montage_name: str = Field("standard_1020", description="A standard montage name")


register(Operation(
    id="set_montage", stage="Montage & channels", label="Set montage",
    inputs=RAW, params_model=MontageParams,
    run=lambda s, p: s.set_montage(p.montage_name),
    doc="Attach standard electrode positions. raw.set_montage",
))


class ReferenceParams(OpParams):
    ref_channels: str | list[str] = Field("average",
                                          description="'average' or a list of channel names")


register(Operation(
    id="set_reference", stage="Montage & channels", label="Re-reference",
    inputs=RAW, params_model=ReferenceParams,
    run=lambda s, p: s.set_reference(p.ref_channels),
    doc="Common-average or explicit reference. raw.set_eeg_reference",
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
