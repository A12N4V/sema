"""Channel and annotation operations: the two surfaces EEGLAB has and this
project did not.

Every one of these is a plain MNE call recorded in the ledger. The point of
putting them in the registry rather than behind bespoke routes is that the
command palette, the auto-generated form, the pipeline script and the capability
gate all fall out of the same declaration.
"""
from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.core.containers import ContainerKind
from app.core.operations.base import Operation, OpParams, register

RAW = (ContainerKind.RAW,)


# --- the channel table's operations ---------------------------------------

class RenameParams(OpParams):
    mapping: dict[str, str] = Field(..., description='Old name to new name, e.g. {"EEG 001": "Fp1"}')


register(Operation(
    id="rename_channels", stage="Montage & channels", label="Rename channels",
    inputs=RAW, params_model=RenameParams,
    run=lambda s, p: s.rename_channels(p.mapping),
    doc="Rename one or more channels. raw.rename_channels",
))


class ChannelTypeParams(OpParams):
    mapping: dict[str, str] = Field(
        ..., description='Channel to type, e.g. {"EOG1": "eog", "ECG": "ecg"}')


register(Operation(
    id="set_channel_types", stage="Montage & channels", label="Set channel types",
    inputs=RAW, params_model=ChannelTypeParams,
    run=lambda s, p: s.set_channel_types(p.mapping),
    doc="Retype channels so EOG/ECG/misc are excluded from EEG maths. raw.set_channel_types",
))


class DropParams(OpParams):
    channels: list[str] = Field(..., description="Channels to remove from the recording")


register(Operation(
    id="drop_channels", stage="Montage & channels", label="Drop channels",
    inputs=RAW, params_model=DropParams,
    run=lambda s, p: s.drop_channels(p.channels),
    doc="Remove channels entirely. Irreversible within this branch. raw.drop_channels",
))


class ReorderParams(OpParams):
    order: list[str] = Field(..., description="Channel names in the order to display them")


register(Operation(
    id="reorder_channels", stage="Montage & channels", label="Reorder channels",
    inputs=RAW, params_model=ReorderParams,
    run=lambda s, p: s.reorder_channels(p.order),
    doc="Change the display and storage order. raw.reorder_channels",
))


class DetectBadsParams(OpParams):
    threshold: float = Field(1.5, gt=1.0, le=10.0,
                             description="Outlier factor above which a channel is bad")
    n_neighbors: int = Field(20, ge=2, le=100, description="Neighbours in the LOF estimate")


register(Operation(
    id="detect_bad_channels", stage="Filter & repair", label="Detect bad channels",
    inputs=RAW, params_model=DetectBadsParams,
    run=lambda s, p: s.detect_bad_channels(p.threshold, p.n_neighbors),
    requires=("montage",),
    doc=("Local Outlier Factor over the channel covariance, the channel half of "
         "EEGLAB's clean_rawdata. mne.preprocessing.find_bad_channels_lof"),
))


# --- annotations ----------------------------------------------------------

class Annotation(OpParams):
    onset: float = Field(..., ge=0, description="Start in seconds")
    duration: float = Field(0.0, ge=0, description="Length in seconds, 0 for a marker")
    description: str = Field(..., min_length=1, description="Label, e.g. 'BAD_blink' or 'stim'")


class AnnotationsParams(OpParams):
    annotations: list[Annotation] = Field(
        default_factory=list, description="The complete annotation set, replacing what is there")


register(Operation(
    id="set_annotations", stage="Artifact ID", label="Set annotations",
    inputs=RAW, params_model=AnnotationsParams,
    run=lambda s, p: s.set_annotations([a.model_dump() for a in p.annotations]),
    doc="Replace every annotation. Segments named BAD_* are excluded from later maths.",
))


class MuscleParams(OpParams):
    threshold: float = Field(5.0, gt=0, description="z-score of high-frequency power")
    min_length_good: float = Field(0.2, ge=0, description="Shortest gap kept as clean, seconds")


register(Operation(
    id="annotate_muscle", stage="Artifact ID", label="Annotate muscle artifact",
    inputs=RAW, params_model=MuscleParams,
    run=lambda s, p: s.annotate_muscle(p.threshold, p.min_length_good),
    long_running=True,
    doc="z-scored high-frequency power marks EMG bursts. mne.preprocessing.annotate_muscle_zscore",
))
