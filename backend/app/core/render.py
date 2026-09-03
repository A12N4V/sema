"""Server-side figure rendering (docs/BUILD_PLAN_V2.md P0.5).

One place that turns an MNE figure into a PNG, with a disk cache keyed on the
session's signal state + the render spec + (for cursor-linked views) a
quantised cursor time. Topomaps, sensor maps, and ICA panels all go through
here instead of a JS reimplementation of MNE's interpolation.

3D (`stc.plot`, `plot_alignment`) will hang off ``render_3d`` once the source
pipeline lands (P6); for now everything is matplotlib-Agg.
"""
from __future__ import annotations

import base64
import hashlib
import io
from pathlib import Path
from typing import Any, Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import mne  # noqa: E402
import numpy as np  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from app.core.spectral_ops import BANDS, compute_band_power  # noqa: E402


class RenderSpec(BaseModel):
    view: str = Field(..., description="topomap | sensors | field3d | ica_component | ica_properties")
    source: Optional[str] = Field(None, description="topomap: 'cursor' | 'band'")
    t: Optional[float] = Field(None, description="cursor time in seconds (topomap/field3d)")
    band: Optional[str] = Field(None, description="delta|theta|alpha|beta|gamma (topomap source='band')")
    component: Optional[int] = Field(None, description="ICA component index")
    azimuth: float = Field(-35.0, description="field3d camera azimuth (deg)")
    elevation: float = Field(16.0, description="field3d camera elevation (deg)")
    width: int = Field(320, ge=80, le=1400)
    height: int = Field(320, ge=80, le=1400)

    def cache_key(self, state_hash: str) -> str:
        # bucket the cursor time so scrubbing hits the cache
        tb = None if self.t is None else round(self.t, 1)
        parts = [self.view, self.source or "", str(tb), self.band or "",
                 str(self.component), f"{self.azimuth:.0f},{self.elevation:.0f}",
                 f"{self.width}x{self.height}", state_hash]
        return hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]


def _fig_to_png(fig, width: int, height: int) -> bytes:
    fig.set_size_inches(width / 100, height / 100)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


# --- individual renderers ---------------------------------------------------

def _topomap_cursor(raw: mne.io.BaseRaw, t: float, spec: RenderSpec) -> bytes:
    if raw.get_montage() is None:
        raise ValueError("Set a montage first")
    picks = mne.pick_types(raw.info, eeg=True, exclude=())
    sfreq = raw.info["sfreq"]
    s = int(np.clip(round(t * sfreq), 0, raw.n_times - 1))
    data = raw.get_data(picks=picks, start=s, stop=s + 1)[:, 0] * 1e6
    info = mne.pick_info(raw.info, picks)
    fig, ax = plt.subplots()
    mne.viz.plot_topomap(data, info, axes=ax, show=False, cmap="RdBu_r")
    ax.set_title(f"t = {s / sfreq:.2f} s", fontsize=8)
    return _fig_to_png(fig, spec.width, spec.height)


def _topomap_band(raw: mne.io.BaseRaw, band: str, spec: RenderSpec) -> bytes:
    if raw.get_montage() is None:
        raise ValueError("Set a montage first")
    if band not in BANDS:
        raise ValueError(f"Unknown band {band!r}")
    bp = compute_band_power(raw)
    idx = mne.pick_channels(raw.ch_names, bp["channels"], ordered=True)
    info = mne.pick_info(raw.info, idx)
    vals = np.asarray(bp["bands"][band])
    fig, ax = plt.subplots()
    mne.viz.plot_topomap(vals, info, axes=ax, show=False)
    ax.set_title(f"{band}", fontsize=8)
    return _fig_to_png(fig, spec.width, spec.height)


def _sensors(raw: mne.io.BaseRaw, spec: RenderSpec) -> bytes:
    if raw.get_montage() is None:
        raise ValueError("Set a montage first")
    fig = raw.plot_sensors(show=False, show_names=True)
    return _fig_to_png(fig, spec.width, spec.height)


def _ica_component(ica: mne.preprocessing.ICA, raw: mne.io.BaseRaw, idx: int, spec: RenderSpec) -> bytes:
    if not (0 <= idx < ica.n_components_):
        raise ValueError(f"Component {idx} out of range")
    fig = ica.plot_components(picks=[idx], show=False, res=64)
    return _fig_to_png(fig, spec.width, spec.height)


def _ica_properties(ica: mne.preprocessing.ICA, raw: mne.io.BaseRaw, idx: int, spec: RenderSpec) -> bytes:
    if not (0 <= idx < ica.n_components_):
        raise ValueError(f"Component {idx} out of range")
    figs = ica.plot_properties(raw, picks=[idx], show=False)
    return _fig_to_png(figs[0], max(spec.width, 520), max(spec.height, 420))


def _field3d(raw: mne.io.BaseRaw, spec: RenderSpec) -> bytes:
    from app.core import render3d, wire

    if not render3d.available():
        raise ValueError("3D rendering needs pyvista — `pip install pyvista`")
    layout = wire.montage_layout(raw)
    if not layout["has_montage"] or not layout["pos3d"]:
        raise ValueError("Set a montage first — the 3D field needs electrode positions")
    names = layout["channels"]
    pos = np.asarray(layout["pos3d"], dtype=float)
    vals = np.asarray(wire.field_at(raw, spec.t or 0.0, names)["values"], dtype=float)
    return render3d.render_field(
        vals, pos, width=spec.width, height=spec.height,
        azimuth=spec.azimuth, elevation=spec.elevation,
    )


# --- dispatch + cache -----------------------------------------------------

def render(session, spec: RenderSpec) -> bytes:
    """Return a PNG for ``spec``, from the on-disk cache when possible."""
    cache_dir = _cache_dir(session)
    key = spec.cache_key(session.state_hash)
    path = cache_dir / f"{key}.png"
    if path.exists():
        return path.read_bytes()

    raw = session.raw
    if spec.view == "topomap":
        if spec.source == "band":
            png = _topomap_band(raw, spec.band or "alpha", spec)
        else:
            png = _topomap_cursor(raw, spec.t or 0.0, spec)
    elif spec.view == "sensors":
        png = _sensors(raw, spec)
    elif spec.view == "field3d":
        png = _field3d(raw, spec)
    elif spec.view in ("ica_component", "ica_properties"):
        if session.ica is None:
            raise ValueError("No ICA fitted yet")
        if spec.component is None:
            raise ValueError("component index required")
        fn = _ica_component if spec.view == "ica_component" else _ica_properties
        png = fn(session.ica, raw, spec.component, spec)
    else:
        raise ValueError(f"Unknown view {spec.view!r}")

    _write_cache(cache_dir, path, png)
    return png


def render_b64(session, spec: RenderSpec) -> str:
    return base64.b64encode(render(session, spec)).decode("ascii")


_CACHE_BUDGET = 400  # PNGs per session before LRU eviction


def _cache_dir(session) -> Path:
    from app.core.paths import SESSIONS_DIR
    d = SESSIONS_DIR / session.id / "render-cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write_cache(cache_dir: Path, path: Path, png: bytes) -> None:
    path.write_bytes(png)
    files = sorted(cache_dir.glob("*.png"), key=lambda p: p.stat().st_mtime)
    for stale in files[:-_CACHE_BUDGET]:
        stale.unlink(missing_ok=True)


def state_hash_for(raw: mne.io.BaseRaw, ledger_head: int, has_ica: bool) -> str:
    info = raw.info
    parts: list[Any] = [
        ledger_head, int(raw.n_times), float(info["sfreq"]),
        info["highpass"], info["lowpass"], tuple(info["bads"]), has_ica,
    ]
    return hashlib.sha1(repr(parts).encode()).hexdigest()[:16]
