"""Generate the Sema mark by putting a seizure through MNE-Python.

Not an illustration of a source estimate: an actual one. A focal temporal-onset
seizure is placed on a cortical vertex, projected to the scalp through the
fsaverage forward model, and then recovered by the same dSPM inverse the app
runs on real data. What comes out is the picture MNE draws, from a recording
that could have been recorded.

    backend/.venv/bin/python scripts/make_logo.py

Writes docs/img/logo-brain.png (and -light). Needs fsaverage, which the app
fetches on first use of the Source workspace.
"""
from __future__ import annotations

import io
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import mne  # noqa: E402
import numpy as np  # noqa: E402

from app.core import source as src  # noqa: E402
from app.services.session_manager import Session  # noqa: E402

mne.set_log_level("ERROR")

SFREQ = 256.0
DUR = 8.0
SEIZURE_HZ = 3.0          # spike-and-wave repeats at ~3 Hz
ONSET, OFFSET = 2.0, 6.5


def spike_and_wave(t: np.ndarray) -> np.ndarray:
    """The classic ictal morphology: a sharp spike, then a slow wave, at 3 Hz.

    Built rather than sampled so the shape is explicit: a narrow Gaussian for
    the spike, a wider negative one for the wave that follows it, repeated at
    the discharge frequency and ramped in and out so the seizure evolves rather
    than switching on.
    """
    y = np.zeros_like(t)
    period = 1.0 / SEIZURE_HZ
    for k in range(int(DUR / period) + 1):
        t0 = k * period
        if not (ONSET <= t0 <= OFFSET):
            continue
        spike = np.exp(-0.5 * ((t - t0) / 0.012) ** 2)
        wave = -0.45 * np.exp(-0.5 * ((t - (t0 + 0.085)) / 0.055) ** 2)
        y += spike + wave
    # evolve: recruit over the first second, decay over the last
    env = np.clip((t - ONSET) / 1.0, 0, 1) * np.clip((OFFSET - t) / 1.2, 0, 1)
    return y * env


def render_logo(session, t: float, width: int = 1400, height: int = 1120,
                simplify: bool = False) -> bytes:
    """The brain alone: no colorbar, no time stamp, cropped to the silhouette.

    `source.render_brain` composites the chrome a *workspace* needs. A mark
    needs the opposite, so this reuses the app's surface loader and colormap and
    draws only the mesh.
    """
    import pyvista as pv
    from PIL import Image

    stc = session.stc
    tidx = int(np.argmin(np.abs(stc.times - t)))
    one = stc.copy().crop(stc.times[tidx], stc.times[tidx])
    p = src.fsaverage_paths()
    dense = mne.compute_source_morph(
        one, "fsaverage", "fsaverage", subjects_dir=p["subjects_dir"],
        spacing=None, smooth=12, warn=False).apply(one)

    v, f, curv = src._surface("lh")
    act = dense.lh_data[:, 0].astype(float)
    pos = act[act > 0]
    # a lower floor than the workspace uses: the app thresholds hard so you are
    # not fooled by noise, a mark wants the shape of the discharge
    lo, hi = np.percentile(pos, [66, 99.5] if simplify else [72, 99.5])
    lo = max(lo, 1e-12)

    hot = src._hot_cmap()
    if simplify:
        # Flat cortex, no gyral/sulcal banding. The curvature texture is the
        # first thing to turn to noise when the mark is scaled to 16px: it is
        # high-frequency detail with no meaning at that size, and it takes the
        # activation down with it. Same estimate, same colours, less carrier.
        rgb = np.tile(np.array([0.52, 0.52, 0.53]), (len(v), 1))
    else:
        rgb = np.repeat(np.where(curv > 0, 0.30, 0.62)[:, None], 3, axis=1).astype(float)
    m = act > lo
    rgb[m] = hot(np.clip((act[m] - lo) / (hi - lo), 0, 1))[:, :3]
    print(f"  activation covers {100 * m.mean():.0f}% of the left surface")

    pl = pv.Plotter(off_screen=True, window_size=(width, height), lighting="three lights")
    mesh = pv.PolyData(v, np.c_[np.full(len(f), 3), f].ravel())
    mesh["rgb"] = (rgb * 255).astype(np.uint8)
    pl.add_mesh(mesh, scalars="rgb", rgb=True, smooth_shading=True,
                ambient=0.46, diffuse=0.70, specular=0.08)
    b = pl.bounds
    cx = np.array([(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2])
    pl.camera.focal_point = cx
    pl.camera.position = cx + np.array([-2.7, 0.0, 0.1]) * max(b[1] - b[0], b[3] - b[2], b[5] - b[4])
    pl.camera.up = (0, 0, 1)
    pl.reset_camera(bounds=b)
    # 1.5 overflowed the frame and the tight crop then cut the vertex and the
    # occipital pole off. Fit first, crop after.
    pl.camera.zoom(1.12)
    img = pl.screenshot(return_img=True, transparent_background=True)
    pl.close()

    im = Image.fromarray(img).convert("RGBA")
    im = im.crop(im.getbbox())          # tight to the silhouette, no dead margin
    out = io.BytesIO()
    im.save(out, format="PNG")
    return out.getvalue()


def main() -> int:
    if not src.fsaverage_ready():
        print("fsaverage is not downloaded yet. Open the Source workspace once, "
              "or run mne.datasets.fetch_fsaverage().", file=sys.stderr)
        return 1

    p = src.fsaverage_paths()
    montage = mne.channels.make_standard_montage("standard_1020")
    # a routine clinical-ish 10-20 set, so the leadfield is one a real cap gives
    picks = ["Fp1", "Fp2", "F7", "F3", "Fz", "F4", "F8", "FT9", "FT10",
             "T7", "C3", "Cz", "C4", "T8", "TP9", "TP10",
             "P7", "P3", "Pz", "P4", "P8", "O1", "Oz", "O2"]
    info = mne.create_info(picks, SFREQ, "eeg")
    info.set_montage(montage)
    info["bads"] = []

    print("building the forward model on fsaverage...")
    fwd = mne.make_forward_solution(info, trans=p["trans"], src=p["src"], bem=p["bem"],
                                    eeg=True, meg=False, mindist=5.0, n_jobs=1)
    fwd = mne.convert_forward_solution(fwd, force_fixed=True, use_cps=True)
    leadfield = fwd["sol"]["data"]                     # n_channels x n_sources
    src_space = fwd["src"]
    lh_verts = src_space[0]["vertno"]

    # The focus: left superior temporal cortex, which is where a mesial/lateral
    # temporal seizure shows up on the surface and what the reference image
    # shows lighting up.
    rr = src_space[0]["rr"][lh_verts] * 1000.0        # mm, MNI-ish
    target = np.array([-58.0, -22.0, 2.0])
    focus = int(np.argmin(np.linalg.norm(rr - target, axis=1)))

    # Recruit the neighbourhood: a seizure is a spreading population, not a
    # single dipole, so weight nearby vertices by distance.
    # Wide on purpose. A focal onset that has already recruited its
    # neighbourhood is what a seizure looks like a second or two in, and a
    # single tight dipole inverts to a few thin strips along one sulcal bank,
    # which is accurate and unreadable at logo size.
    def blob(centre, sigma, gain, cutoff):
        dd = np.linalg.norm(rr - np.asarray(centre), axis=1)
        w = gain * np.exp(-0.5 * (dd / sigma) ** 2)
        w[dd > cutoff] = 0.0
        return w

    weights = blob(rr[focus], 34.0, 1.00, 92)                  # temporal onset
    weights += blob([-46.0, -58.0, 24.0], 26.0, 0.75, 74)      # to inferior parietal
    weights += blob([-52.0, 4.0, 16.0], 24.0, 0.62, 68)        # forward to frontal operculum
    weights += blob([-40.0, -30.0, 52.0], 22.0, 0.45, 60)      # up toward sensorimotor

    t = np.arange(0, DUR, 1.0 / SFREQ)
    course = spike_and_wave(t)
    amp = 55e-9                                        # Am, ictal scale
    lh_activity = np.outer(weights, course) * amp

    activity = np.zeros((leadfield.shape[1], t.size))
    activity[: len(lh_verts)] = lh_activity
    scalp = leadfield @ activity                       # volts at the electrodes

    rng = np.random.default_rng(11)
    # 1/f background so the inverse is solving a realistic, not a noiseless, problem
    noise = rng.standard_normal((len(picks), t.size))
    b, a = __import__("scipy.signal", fromlist=["butter"]).butter(2, 45 / (SFREQ / 2), "low")
    noise = __import__("scipy.signal", fromlist=["filtfilt"]).filtfilt(b, a, noise, axis=1)
    scalp += noise * 6e-6

    raw = mne.io.RawArray(scalp, info)
    peak_t = float(t[int(np.argmax(np.abs(course)))])
    print(f"simulated {len(picks)} ch x {DUR:g}s, seizure peak at {peak_t:.2f}s, "
          f"scalp p-p {np.ptp(scalp) * 1e6:.0f} uV")

    session = Session(id="logo", filename="simulated seizure", raw=raw)
    session.montage_name = "standard_1020"

    print("running the inverse (dSPM), the same call the app makes...")
    t0 = time.time()
    src.compute_source_estimate(session, method="dSPM", center_t=peak_t)
    print(f"  stc: {session.stc_meta['n_sources']} sources in {time.time() - t0:.1f}s")

    out_dir = ROOT / "docs" / "img"
    out_dir.mkdir(parents=True, exist_ok=True)
    png = render_logo(session, peak_t)
    (out_dir / "logo-brain.png").write_bytes(png)
    print(f"  wrote docs/img/logo-brain.png ({len(png) // 1024} KB)")

    small = render_logo(session, peak_t, simplify=True)
    (out_dir / "logo-mark.png").write_bytes(small)
    print(f"  wrote docs/img/logo-mark.png ({len(small) // 1024} KB)")

    # the icon the app and the browser tab use, from the same render
    from PIL import Image as _I
    import io as _io
    icon = _I.open(_io.BytesIO(small)).convert("RGBA")
    for px in (512, 180, 64, 32):
        r = icon.resize((px, round(px * icon.height / icon.width)), _I.LANCZOS)
        sq = _I.new("RGBA", (px, px), (0, 0, 0, 0))
        sq.alpha_composite(r, (0, (px - r.height) // 2))
        sq.save(ROOT / "frontend" / "public" / f"mark-{px}.png")
    print("  wrote frontend/public/mark-{512,180,64,32}.png")

    # the in-app figure too, chrome and all, for the README's Source section
    full = src.render_brain(session, t=peak_t, hemi="lh", view="lateral",
                            width=1400, height=1100, theme="dark")
    (out_dir / "source.png").write_bytes(full)
    print(f"  wrote docs/img/source.png ({len(full) // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
