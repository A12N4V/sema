"""Source localisation: the real ``stc.plot()`` inflated brain (P6).

Template pipeline for EEG with no individual MRI, exactly as the MNE docs
prescribe: fsaverage source space + BEM (both ship prebuilt with
``fetch_fsaverage``), ``trans='fsaverage'``, an ad-hoc noise covariance, a
dSPM/MNE/sLORETA inverse operator, ``apply_inverse_raw`` over a window around
the cursor, then a PyVista render of the inflated surface with the activation
overlaid.

The forward solution (~15-20 s) is cached on disk per montage; re-applying the
inverse for a new time window is ~1 s.
"""
from __future__ import annotations

import functools
import hashlib
import io
import os

os.environ.setdefault("PYVISTA_OFF_SCREEN", "true")

import numpy as np

from app.core.paths import DATA_DIR

_CACHE = DATA_DIR / "cache"
_CACHE.mkdir(parents=True, exist_ok=True)

METHODS = ("dSPM", "MNE", "sLORETA", "eLORETA")
_LAMBDA2 = 1.0 / 9.0          # SNR 3
_WINDOW = 8.0                 # seconds of stc computed around the cursor

_PV_OK = True
try:
    import pyvista as pv

    pv.OFF_SCREEN = True
except Exception:  # pragma: no cover
    _PV_OK = False


class SourceError(RuntimeError):
    pass


# --- fsaverage assets -----------------------------------------------------

@functools.lru_cache(maxsize=1)
def fsaverage_paths() -> dict:
    """Fetch fsaverage (once, ~770 MB, cached under ~/mne_data) and return the
    prebuilt source space / BEM / trans paths."""
    import mne

    fs = mne.datasets.fetch_fsaverage(verbose="ERROR")
    return {
        "subjects_dir": os.path.dirname(fs),
        "subject": "fsaverage",
        "src": os.path.join(fs, "bem", "fsaverage-ico-5-src.fif"),
        "bem": os.path.join(fs, "bem", "fsaverage-5120-5120-5120-bem-sol.fif"),
        "trans": os.path.join(fs, "bem", "fsaverage-trans.fif"),
        "surf": os.path.join(fs, "surf"),
    }


_FS_READY: bool | None = None


def fsaverage_ready() -> bool:
    """Cheap check (cached): is fsaverage already on disk? Called on every
    graph refresh, so it must not hit the network or walk the tree."""
    global _FS_READY
    if _FS_READY:
        return True
    try:
        import mne

        sd = mne.get_config("SUBJECTS_DIR") or os.path.join(
            mne.get_config("MNE_DATA", os.path.join(os.path.expanduser("~"), "mne_data")),
            "MNE-fsaverage-data",
        )
        _FS_READY = os.path.exists(os.path.join(sd, "fsaverage", "bem", "fsaverage-ico-5-src.fif"))
    except Exception:
        _FS_READY = False
    return bool(_FS_READY)


# --- the pipeline -------------------------------------------------------

def _fwd_cache_key(raw) -> str:
    key = repr([sorted(raw.ch_names), round(float(raw.info["sfreq"]), 3),
                raw.get_montage() is not None])
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def _forward(raw):
    import mne

    p = fsaverage_paths()
    cache = _CACHE / f"fwd_{_fwd_cache_key(raw)}.fif"
    if cache.exists():
        return mne.read_forward_solution(cache, verbose="ERROR")
    fwd = mne.make_forward_solution(
        raw.info, trans=p["trans"], src=p["src"], bem=p["bem"],
        eeg=True, meg=False, mindist=5.0, n_jobs=1, verbose="ERROR",
    )
    mne.write_forward_solution(cache, fwd, overwrite=True, verbose="ERROR")
    return fwd


def compute_source_estimate(session, *, method: str = "dSPM", center_t: float = 0.0) -> dict:
    """Build (and cache) the inverse operator, apply it over a window around
    ``center_t``, and stash the SourceEstimate on the session."""
    import mne
    from mne.minimum_norm import apply_inverse_raw, make_inverse_operator

    if method not in METHODS:
        raise SourceError(f"method must be one of {METHODS}")
    raw = session.raw
    if raw.get_montage() is None:
        raise SourceError("Set a montage first: source localisation needs electrode positions")

    work = raw.copy().pick("eeg")
    work.set_eeg_reference("average", projection=True, verbose="ERROR")

    fwd = _forward(work)
    cov = mne.make_ad_hoc_cov(work.info, verbose="ERROR")
    inv = make_inverse_operator(work.info, fwd, cov, loose=0.2, depth=0.8, verbose="ERROR")

    sf = work.info["sfreq"]
    half = _WINDOW / 2
    start = int(max(0, (center_t - half)) * sf)
    stop = int(min(work.n_times, (center_t + half) * sf))
    stc = apply_inverse_raw(work, inv, _LAMBDA2, method=method, start=start, stop=stop,
                            pick_ori=None, verbose="ERROR")

    session.stc = stc
    session.stc_meta = {
        "method": method,
        "tmin": float(stc.times[0]),
        "tmax": float(stc.times[-1]),
        "n_sources": int(stc.data.shape[0]),
        "subject": "fsaverage",
    }
    peak_vertno, peak_t = stc.get_peak()
    session.stc_meta["peak_time"] = float(peak_t)
    return session.stc_meta


# --- rendering ---------------------------------------------------------

@functools.lru_cache(maxsize=2)
def _surface(hemi: str):
    import mne

    p = fsaverage_paths()
    import nibabel as nib

    v, f = mne.read_surface(os.path.join(p["surf"], f"{hemi}.inflated"))
    curv = nib.freesurfer.read_morph_data(os.path.join(p["surf"], f"{hemi}.curv"))
    return v, f, curv


_HOT = None


def _hot_cmap():
    global _HOT
    if _HOT is None:
        from matplotlib.colors import LinearSegmentedColormap

        _HOT = LinearSegmentedColormap.from_list(
            "eeghot", ["#5c0000", "#e02200", "#ff9500", "#ffe400", "#ffffff"])
    return _HOT


def render_brain(session, *, t: float, hemi: str = "lh", view: str = "lateral",
                 width: int = 760, height: int = 600, theme: str = "dark") -> bytes:
    import mne

    from app.core.figtheme import palette

    pal = palette(theme)

    if not _PV_OK:
        raise SourceError("pyvista is not installed")
    if getattr(session, "stc", None) is None:
        raise SourceError("No source estimate: run 'Compute source estimate' first")

    stc = session.stc
    if not (stc.times[0] - 1e-6 <= t <= stc.times[-1] + 1e-6):
        raise SourceError(
            f"cursor {t:.2f}s is outside the computed window "
            f"[{stc.times[0]:.1f}, {stc.times[-1]:.1f}], recompute here")

    tidx = int(np.argmin(np.abs(stc.times - t)))
    one = stc.copy().crop(stc.times[tidx], stc.times[tidx])
    p = fsaverage_paths()
    dense = mne.compute_source_morph(
        one, "fsaverage", "fsaverage", subjects_dir=p["subjects_dir"],
        spacing=None, smooth=10, warn=False, verbose="ERROR").apply(one)

    hemis = ["lh", "rh"] if hemi == "both" else [hemi]
    import pyvista as pv

    pl = pv.Plotter(off_screen=True, window_size=(width, height), lighting="three lights")

    hot = _hot_cmap()
    all_pos = np.concatenate([
        (dense.lh_data if h == "lh" else dense.rh_data)[:, 0] for h in hemis])
    all_pos = all_pos[all_pos > 0]
    lo, hi = (np.percentile(all_pos, [92, 99.8]) if all_pos.size else (0.0, 1.0))
    lo = max(lo, 1e-9)

    peak_xyz = None
    peak_val = -np.inf
    for h in hemis:
        v, f, curv = _surface(h)
        act = (dense.lh_data if h == "lh" else dense.rh_data)[:, 0].astype(float)
        rgb = np.repeat(np.where(curv > 0, 0.28, 0.58)[:, None], 3, axis=1).astype(float)
        m = act > lo
        rgb[m] = hot(np.clip((act[m] - lo) / (hi - lo), 0, 1))[:, :3]
        mesh = pv.PolyData(v, np.c_[np.full(len(f), 3), f].ravel())
        mesh["rgb"] = (rgb * 255).astype(np.uint8)
        pl.add_mesh(mesh, scalars="rgb", rgb=True, smooth_shading=True,
                    ambient=0.42, diffuse=0.72, specular=0.06)
        if act.max() > peak_val:
            peak_val = act.max()
            peak_xyz = v[int(np.argmax(act))]

    if peak_xyz is not None:
        pl.add_points(peak_xyz[None], color=pal["accent"], point_size=15,
                      render_points_as_spheres=True)

    # camera
    bounds = pl.bounds
    cx = np.array([(bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, (bounds[4] + bounds[5]) / 2])
    rad = max(bounds[1] - bounds[0], bounds[3] - bounds[2], bounds[5] - bounds[4])
    look = {
        "lateral": np.array([-2.7, 0.0, 0.1]) * (1 if hemi != "rh" else -1),
        "medial": np.array([2.4, 0.0, 0.1]) * (1 if hemi != "rh" else -1),
        "dorsal": np.array([0.0, 0.0, 3.0]),
        "ventral": np.array([0.0, 0.0, -3.0]),
    }.get(view, np.array([-2.7, 0.0, 0.1]))
    if hemi == "both":
        look = {"dorsal": np.array([0, 0, 3.0]), "ventral": np.array([0, 0, -3.0])}.get(
            view, np.array([0.0, -2.9, 0.6]))
    pl.camera.focal_point = cx
    pl.camera.position = cx + look * rad
    pl.camera.up = (0, 0, 1)
    pl.reset_camera(bounds=bounds)
    pl.camera.zoom(1.35)

    # transparent, so the brain sits on whatever ground the pane has
    brain_img = pl.screenshot(return_img=True, transparent_background=True)
    pl.close()

    # composite a matplotlib colorbar + time label
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image

    fig = plt.figure(figsize=(width / 100, height / 100), dpi=100)
    fig.patch.set_alpha(0)
    cax = fig.add_axes([0.905, 0.30, 0.02, 0.42])
    cb = matplotlib.colorbar.ColorbarBase(cax, cmap=hot, norm=plt.Normalize(lo, hi))
    cb.set_label(session.stc_meta.get("method", "dSPM"), color=pal["dim"], fontsize=10)
    cb.ax.tick_params(colors=pal["dim"], labelsize=8)
    fig.text(0.5, 0.045, f"time = {stc.times[tidx]:.3f} s", ha="center", color=pal["fg"], fontsize=13)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", transparent=True)
    plt.close(fig)
    buf.seek(0)

    over = Image.open(buf).convert("RGBA").resize((width, height))
    final = Image.fromarray(brain_img).convert("RGBA")
    final.alpha_composite(over)
    out = io.BytesIO()
    final.save(out, format="PNG")
    return out.getvalue()


def source_timecourse(session, vertex: int | None = None) -> dict:
    """Activation at the peak (or given) vertex over the computed window -
    the trace strip under the brain."""
    if getattr(session, "stc", None) is None:
        raise SourceError("No source estimate yet")
    stc = session.stc
    if vertex is None:
        vertno, _ = stc.get_peak(vert_as_index=True)
        vertex = int(vertno)
    y = stc.data[vertex]
    return {
        "t": [float(x) for x in stc.times],
        "y": [float(x) for x in y],
        "vertex": vertex,
        "label": f"vertex {vertex}",
        "method": session.stc_meta.get("method", "dSPM"),
    }
