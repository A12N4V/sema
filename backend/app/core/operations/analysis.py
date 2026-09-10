"""The epoched half of MNE: Epochs, Evoked, time-frequency.

This is the chain that was missing, and it is the one that gates most of what a
professional does after cleaning. Everything downstream of `make_epochs` in
MNE (evoked contrasts, TFR, connectivity, decoding, cluster statistics) hangs
off this node.
"""
from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.core.containers import ContainerKind
from app.core.operations.base import Operation, OpParams, register

RAW = (ContainerKind.RAW,)
EPOCHS = (ContainerKind.EPOCHS,)


class EpochsParams(OpParams):
    tmin: float = Field(-0.2, description="Start of each epoch relative to the event, seconds")
    tmax: float = Field(0.8, description="End of each epoch relative to the event, seconds")
    description: Optional[str] = Field(
        None, description="Only use annotations with this label. Null uses every non-BAD label.")
    baseline: bool = Field(True, description="Subtract the pre-event mean")
    reject_uv: Optional[float] = Field(
        150.0, description="Drop an epoch whose peak-to-peak exceeds this, in µV. Null keeps all.")


register(Operation(
    id="make_epochs", stage="Epoching", label="Create epochs",
    inputs=RAW, output=ContainerKind.EPOCHS, params_model=EpochsParams,
    run=lambda s, p: s.make_epochs(p.tmin, p.tmax, p.description, p.baseline, p.reject_uv),
    doc=("Cut trials around annotations, or on a fixed-length grid when the "
         "recording has no events. mne.Epochs"),
))


class AverageParams(OpParams):
    condition: Optional[str] = Field(None, description="Event label to average. Null averages all.")


register(Operation(
    id="average_epochs", stage="Evoked", label="Average to evoked",
    inputs=EPOCHS, output=ContainerKind.EVOKED, params_model=AverageParams,
    run=lambda s, p: s.average_epochs(p.condition),
    requires=("epochs",),
    doc="The condition average with its butterfly and peak topographies. epochs.average",
))


class TFRParams(OpParams):
    fmin: float = Field(4.0, gt=0, description="Lowest frequency, Hz")
    fmax: float = Field(40.0, gt=0, description="Highest frequency, Hz")
    n_freqs: int = Field(24, ge=2, le=120, description="Number of frequencies")
    decim: int = Field(3, ge=1, le=20, description="Keep every nth sample, to bound the cost")


register(Operation(
    id="compute_tfr", stage="Time-frequency", label="Morlet time-frequency",
    inputs=EPOCHS, output=ContainerKind.TFR, params_model=TFRParams,
    run=lambda s, p: s.compute_tfr(p.fmin, p.fmax, p.n_freqs, p.decim),
    requires=("epochs",), long_running=True,
    doc="Morlet wavelet power across the epoch. epochs.compute_tfr('morlet')",
))
