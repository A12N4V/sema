"""3D scalp-field rendering: a real head surface with the instantaneous EEG
potential interpolated across it (Perrin spherical spline, the same maths MNE
uses for topomaps), rendered off-screen with PyVista/VTK.

This is *not* a cortical source estimate (that needs the forward + inverse
pipeline: P6). It's the sensor-space field on the head, in 3D, at the cursor
time. The card upgrades to a real inflated brain once a SourceEstimate exists.
"""
from __future__ import annotations

import functools
import io
import os

os.environ.setdefault("PYVISTA_OFF_SCREEN", "true")

import numpy as np

_AVAILABLE = True
try:  # pyvista is optional-but-recommended
    import pyvista as pv

    pv.OFF_SCREEN = True
except Exception:  # pragma: no cover
    _AVAILABLE = False

# head ellipsoid: narrower ear-to-ear, longest nose-to-occiput, a touch short top-to-chin
_ELLIP = np.array([0.82, 1.02, 0.92])


class NotAvailable(RuntimeError):
    pass


def available() -> bool:
    return _AVAILABLE


@functools.lru_cache(maxsize=8)
def _head_and_weights(pos_key: tuple) -> tuple:
    from mne.channels.interpolation import _make_interpolation_matrix

    pos = np.array(pos_key, dtype=float).reshape(-1, 3)
    centre = pos.mean(axis=0)
    p = pos - centre
    radius = float(np.linalg.norm(p, axis=1).mean())
    p_unit = p / np.linalg.norm(p, axis=1, keepdims=True)

    sphere = pv.Sphere(radius=1.0, theta_resolution=96, phi_resolution=96)
    v = sphere.points / np.linalg.norm(sphere.points, axis=1, keepdims=True)
    W = _make_interpolation_matrix(p_unit, v)

    head = sphere.copy()
    hp = v * _ELLIP * radius
    # gently flatten the lower back of the head (below the equator, behind)
    low = np.clip(-hp[:, 2] / (radius), 0, 1) ** 2
    hp[:, 1] -= low * 0.10 * radius
    head.points = hp + centre
    head.compute_normals(inplace=True, auto_orient_normals=True)

    elec_on = p_unit * _ELLIP * radius * 1.01 + centre  # markers sit just proud of the surface
    return head, W, elec_on, centre, radius


def render_field(values_uv: np.ndarray, positions: np.ndarray, *, width: int, height: int,
                 azimuth: float = -35.0, elevation: float = 16.0, theme: str = "dark") -> bytes:
    if not _AVAILABLE:
        raise NotAvailable("pyvista is not installed: `pip install pyvista`")

    from app.core.figtheme import palette

    p = palette(theme)

    key = tuple(np.round(positions.ravel(), 5).tolist())
    head, W, elec, centre, radius = _head_and_weights(key)

    scalars = W @ np.asarray(values_uv, dtype=float)
    lim = float(np.percentile(np.abs(scalars), 97)) or 1.0

    mesh = head.copy()
    mesh["field"] = scalars

    pl = pv.Plotter(off_screen=True, window_size=(width, height), lighting="three lights")
    pl.add_mesh(
        mesh, scalars="field", cmap="RdBu_r", clim=(-lim, lim),
        smooth_shading=True, specular=0.3, specular_power=18, ambient=0.32, diffuse=0.9,
        show_scalar_bar=True,
        scalar_bar_args={"title": "µV", "n_labels": 3, "vertical": True,
                         "position_x": 0.9, "position_y": 0.22, "width": 0.05, "height": 0.55,
                         "label_font_size": 11, "title_font_size": 13, "color": p["dim"]},
    )
    # electrode dots read against the head, not against the page, but they must
    # not vanish into a black ground when the scalp is deep blue
    pl.add_points(elec, color=p["fg"] if theme == "dark" else "#2b2b2b",
                  point_size=5, render_points_as_spheres=True, opacity=0.85)
    nose = pv.Cone(center=centre + np.array([0, 1.03 * _ELLIP[1] * radius, 0.0]),
                   direction=(0, 1, 0), height=0.18 * radius, radius=0.09 * radius, resolution=24)
    pl.add_mesh(nose, color="#9aa0ab")
    for sx in (-1, 1):
        ear = pv.ParametricEllipsoid(0.06 * radius, 0.13 * radius, 0.09 * radius)
        ear.translate(centre + np.array([sx * _ELLIP[0] * radius * 0.98, -0.05 * radius, -0.02 * radius]), inplace=True)
        pl.add_mesh(ear, color="#9aa0ab")

    pl.camera.focal_point = centre
    az, el = np.radians(azimuth), np.radians(elevation)
    pl.camera.position = centre + radius * 5.2 * np.array([
        np.cos(el) * np.sin(az),
        np.cos(el) * np.cos(az),   # +y is the nose → camera sits on the face side
        np.sin(el),
    ])
    pl.camera.up = (0, 0, 1)
    pl.reset_camera(bounds=mesh.bounds)
    pl.camera.zoom(1.15)

    img = pl.screenshot(return_img=True, transparent_background=True)
    pl.close()

    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")
    return buf.getvalue()
