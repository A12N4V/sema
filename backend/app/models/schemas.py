"""Pydantic request/response schemas shared across routers."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SessionInfo(BaseModel):
    session_id: str
    filename: str
    channel_names: list[str]
    channel_types: list[str]
    channel_type_counts: dict[str, int]
    n_channels: int
    sfreq: float
    n_times: int
    duration_seconds: float
    bads: list[str]
    highpass: Optional[float]
    lowpass: Optional[float]
    has_montage: bool
    annotations: list[dict]
    meas_date: Optional[str]


class TraceWindowRequest(BaseModel):
    start: float = Field(0, ge=0, description="Window start, in seconds")
    duration: float = Field(10, gt=0, description="Window length, in seconds")
    channels: Optional[list[str]] = Field(None, description="Subset of channel names; all if omitted")
    max_points: int = Field(2000, gt=10, le=20000)


class TraceWindowResponse(BaseModel):
    channels: list[str]
    sfreq: float
    time: list[float]
    traces: dict[str, list[float]]


class BandpassRequest(BaseModel):
    l_freq: Optional[float] = None
    h_freq: Optional[float] = None


class NotchRequest(BaseModel):
    freqs: list[float]


class ResampleRequest(BaseModel):
    sfreq: float = Field(..., gt=0)


class BadChannelsRequest(BaseModel):
    bads: list[str]


class ReferenceRequest(BaseModel):
    ref_channels: str | list[str] = "average"


class MontageRequest(BaseModel):
    montage_name: str = "standard_1020"


class ICAFitRequest(BaseModel):
    # int (e.g. 15) = exact component count; float in (0,1) (e.g. 0.99) =
    # "explain this fraction of variance". Pydantic's smart-mode union picks
    # int for a bare integer like `4` and float for `0.99`, matching what
    # MNE's ICA(n_components=...) expects for each type.
    n_components: int | float = Field(0.99, gt=0)
    method: str = "fastica"


class ICAExcludeRequest(BaseModel):
    exclude: list[int]


class EpochsFromAnnotationsRequest(BaseModel):
    tmin: float = -0.2
    tmax: float = 0.8
    event_id: Optional[dict[str, int]] = None


class FixedLengthEpochsRequest(BaseModel):
    duration: float = Field(..., gt=0)
    overlap: float = Field(0.0, ge=0)


class PSDRequest(BaseModel):
    fmin: float = 1.0
    fmax: float = 45.0
    channels: Optional[list[str]] = None


class BandPowerTopomapRequest(BaseModel):
    band: str
    channels: Optional[list[str]] = None
