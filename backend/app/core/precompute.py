"""Render every figure a session will need, once, right after it loads.

The interactive path was "move the cursor → POST /render → matplotlib draws a
topomap → PNG comes back". That is ~50 ms of server work per frame, which is
fine for one click and awful for a scrub: the panes visibly chase the cursor.

So: as soon as a recording is open, walk the whole recording at a fixed cadence
and render the filmstrip into the same on-disk cache the interactive endpoint
reads from, alongside the views that don't move at all (sensor map, the five
band topomaps). Afterwards every one of those requests is a file read, and the
frontend can snap the cursor to the nearest precomputed frame and get an
instant, exact cache hit: the timeline and the figures are the same clock.

Costs about 10 s of one background thread for a 3-minute recording. It runs as
a normal job (``services/jobs.py``) so the UI can show progress and the user
can work through it: nothing here blocks.
"""
from __future__ import annotations

import time
from typing import Any

from app.core.render import RenderSpec, band_power_cached, cache_dir, render
from app.core.spectral_ops import BANDS

# Frames across the whole recording. 180 keeps a long recording under ~10 s of
# render time and ~9 MB of cache, at a cadence fine enough that a scrub reads as
# continuous rather than stepped.
FRAME_BUDGET = 180
MIN_SPACING = 0.2       # s, no point rendering finer than the cache's bucket
FRAME_SIZE = (400, 400)


def frame_times(duration: float, budget: int = FRAME_BUDGET) -> list[float]:
    """Evenly spaced cursor times, quantised to the render cache's 0.1 s bucket.

    Quantising here is what makes the link exact: the frontend rounds the cursor
    the same way, so the request it sends is byte-identical to one already on
    disk.
    """
    if duration <= 0:
        return [0.0]
    n = min(budget, max(2, int(duration / MIN_SPACING) + 1))
    seen: dict[float, None] = {}
    for i in range(n):
        seen[round(i * duration / (n - 1), 1)] = None
    return list(seen)


def filmstrip_manifest(session, *, theme: str = "dark",
                       width: int = FRAME_SIZE[0], height: int = FRAME_SIZE[1]) -> dict[str, Any]:
    """What the precompute pass covers, and how much of it is already on disk.

    Cheap enough to poll: it stats the cache, it never renders.

    **Takes the session lock for the three reads off the live Raw.** The client
    polls this while the user keeps working, and `get_montage()` runs MNE's
    `_check_consistency`, which *writes* `info["ch_names"]` as it normalises
    them. Land that between the two halves of a rename and MNE raises
    ``ch_names cannot be set directly`` out of its own guard, and the poll 500s.
    Reading a live MNE object is not a read as far as MNE is concerned. The
    cache stat below is pure filesystem, so it stays outside the lock.
    """
    with session.lock:
        times = frame_times(float(session.raw.times[-1]))
        has_montage = session.raw.get_montage() is not None
        state = session.state_hash
    cache = cache_dir(session)

    ready = 0
    if has_montage:
        for t in times:
            spec = RenderSpec(view="topomap", source="cursor", t=t, width=width,
                              height=height, theme=theme)
            if (cache / f"{spec.cache_key(state)}.png").exists():
                ready += 1

    return {
        "state_hash": state,
        "theme": theme,
        "width": width,
        "height": height,
        "times": times if has_montage else [],
        "bands": list(BANDS) if has_montage else [],
        "frames_ready": ready,
        "ready": has_montage and ready == len(times),
        "blocked": None if has_montage else "no montage, set one to precompute topographies",
    }


def precompute(session, *, theme: str = "dark", width: int = FRAME_SIZE[0],
               height: int = FRAME_SIZE[1], job: Any = None) -> dict[str, Any]:
    """Render the whole set. Safe to re-run: everything already cached is a
    file-exists check, so a second pass after a filter costs only what changed.
    """
    started = time.time()
    has_montage = session.raw.get_montage() is not None
    times = frame_times(float(session.raw.times[-1]))

    specs: list[tuple[str, RenderSpec]] = []
    if has_montage:
        specs.append(("sensor map", RenderSpec(view="sensors", width=width, height=height, theme=theme)))
        for band in BANDS:
            specs.append((f"{band} band", RenderSpec(view="topomap", source="band", band=band,
                                                     width=width, height=height, theme=theme)))
        for t in times:
            specs.append((f"t={t:.1f}s", RenderSpec(view="topomap", source="cursor", t=t,
                                                    width=width, height=height, theme=theme)))
    if session.ica is not None:
        for i in range(session.ica.n_components_):
            specs.append((f"ICA {i}", RenderSpec(view="ica_component", component=i,
                                                 width=width, height=height, theme=theme)))

    # One Welch PSD up front: every band map reads it, and so does the spectrum
    # pane the moment the user opens it.
    start_state = session.state_hash
    if has_montage:
        with session.lock:
            band_power_cached(session.raw, start_state)

    done = failed = 0
    stale = False
    total = max(1, len(specs))
    for i, (label, spec) in enumerate(specs):
        if session.state_hash != start_state:
            # A filter (or any op) landed mid-pass: the rest of this filmstrip
            # would be for a signal that no longer exists. Stop; the client sees
            # `ready: false` on the new state and asks for a fresh pass.
            stale = True
            break
        try:
            # Per frame, not around the loop: the session lock is what every
            # request contends on, and holding it for the whole pass would
            # freeze the UI for the ten seconds this is meant to save.
            with session.lock:
                render(session, spec)
            done += 1
        except Exception:  # noqa: BLE001 - one dead frame must not kill the pass
            failed += 1
        if job is not None:
            job.progress = (i + 1) / total
            job.detail = f"{label} · {i + 1}/{total}"

    result = {
        "state_hash": start_state,
        "stale": stale,
        "theme": theme,
        "width": width,
        "height": height,
        "times": times if has_montage else [],
        "bands": list(BANDS) if has_montage else [],
        "rendered": done,
        "failed": failed,
        "seconds": round(time.time() - started, 2),
        "blocked": None if has_montage else "no montage, set one to precompute topographies",
    }
    if job is not None:
        job.result = result
        job.detail = f"{done} figures in {result['seconds']}s"
    return result
