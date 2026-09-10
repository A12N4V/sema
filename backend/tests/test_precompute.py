"""The precompute pass and the theme-aware figure styling.

Two properties matter more than the rest and are easy to break silently:

* the frame times the server renders must be **exactly** the ones the client
  asks for later: they are matched by a hashed cache key, so an off-by-a-
  rounding-step means every scrub misses the cache and the feature is gone
  while still appearing to work;
* figures must come back with an alpha channel, or they arrive as white cards
  on a black UI.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core import precompute as pre
from app.core.figtheme import palette
from app.core.render import RenderSpec, cache_dir, render
from app.main import app
from app.services.session_manager import sessions


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def sid(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


# ------------------------------------------------------------- frame planning

def test_frame_times_span_the_whole_recording():
    times = pre.frame_times(180.0)
    assert times[0] == 0.0
    assert times[-1] == pytest.approx(180.0, abs=0.05)
    assert times == sorted(times)
    assert len(times) <= pre.FRAME_BUDGET


def test_frame_times_are_quantised_to_the_cache_bucket():
    """RenderSpec.cache_key rounds t to 0.1 s. If the plan isn't on that grid
    the client's request hashes to a different key and never hits the cache."""
    for t in pre.frame_times(97.3):
        assert round(t, 1) == t


def test_frame_times_dedupe_on_a_short_recording():
    times = pre.frame_times(0.5)
    assert len(times) == len(set(times))
    assert all(0.0 <= t <= 0.5 for t in times)


def test_frame_times_handles_a_zero_length_recording():
    assert pre.frame_times(0.0) == [0.0]


# --------------------------------------------------------------- the pass

def test_precompute_fills_the_cache_and_the_manifest_agrees(client: TestClient, sid: str):
    session = sessions.get(sid)
    assert pre.filmstrip_manifest(session)["ready"] is False

    result = pre.precompute(session)
    assert result["failed"] == 0
    assert result["rendered"] >= len(result["times"])
    assert result["stale"] is False

    manifest = pre.filmstrip_manifest(session)
    assert manifest["ready"] is True
    assert manifest["frames_ready"] == len(manifest["times"])
    assert manifest["state_hash"] == result["state_hash"]


def test_every_planned_frame_is_the_key_the_client_will_ask_for(client: TestClient, sid: str):
    """The whole point: after the pass, the interactive request is a file read."""
    session = sessions.get(sid)
    pre.precompute(session)
    cache = cache_dir(session)
    for t in pre.filmstrip_manifest(session)["times"]:
        spec = RenderSpec(view="topomap", source="cursor", t=t,
                          width=pre.FRAME_SIZE[0], height=pre.FRAME_SIZE[1], theme="dark")
        assert (cache / f"{spec.cache_key(session.state_hash)}.png").exists(), f"t={t} not cached"


def test_a_second_pass_is_cheap(client: TestClient, sid: str):
    session = sessions.get(sid)
    first = pre.precompute(session)
    second = pre.precompute(session)
    assert second["rendered"] == first["rendered"]
    assert second["seconds"] < max(0.5, first["seconds"] / 3), "the second pass re-rendered"


def test_a_signal_change_invalidates_the_filmstrip(client: TestClient, sid: str):
    session = sessions.get(sid)
    pre.precompute(session)
    assert pre.filmstrip_manifest(session)["ready"] is True

    client.post(f"/api/sessions/{sid}/ops",
                json={"op_id": "filter", "params": {"l_freq": 1.0, "h_freq": 40.0}})
    assert pre.filmstrip_manifest(session)["ready"] is False, \
        "frames from before a filter must not be served as the new signal"


# ------------------------------------------------------------------- routes

def test_precompute_route_returns_a_job(client: TestClient, sid: str):
    r = client.post(f"/api/sessions/{sid}/precompute", json={"theme": "dark"})
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    assert client.get(f"/api/jobs/{job_id}").status_code == 200


def test_filmstrip_route_shape(client: TestClient, sid: str):
    w, h = pre.FRAME_SIZE
    m = client.get(f"/api/sessions/{sid}/filmstrip?theme=dark&width={w}&height={h}").json()
    assert set(m) >= {"state_hash", "times", "bands", "frames_ready", "ready", "theme"}
    assert m["theme"] == "dark"
    assert len(m["bands"]) == 5


def test_routes_404_on_a_missing_session(client: TestClient):
    assert client.get("/api/sessions/nope/filmstrip").status_code == 404
    assert client.post("/api/sessions/nope/precompute", json={}).status_code == 404


# ------------------------------------------------------------------- theming

def _render(sid: str, **kw) -> Image.Image:
    spec = RenderSpec(view="topomap", source="cursor", t=1.0, width=200, height=200, **kw)
    return Image.open(io.BytesIO(render(sessions.get(sid), spec)))


def test_figures_are_transparent_so_they_take_the_pane_ground(client: TestClient, sid: str):
    im = _render(sid, theme="dark")
    assert im.mode == "RGBA", "an opaque figure shows up as a white card on a dark UI"
    corner = im.convert("RGBA").getpixel((0, 0))
    assert corner[3] == 0, "the figure corner must be see-through, not filled"


def test_theme_changes_the_ink_not_just_the_bytes(client: TestClient, sid: str):
    """Dark and light must differ, and the difference must be the foreground -
    a shared cache key would silently serve one for the other."""
    dark = RenderSpec(view="topomap", source="cursor", t=1.0, theme="dark")
    light = RenderSpec(view="topomap", source="cursor", t=1.0, theme="light")
    session = sessions.get(sid)
    assert dark.cache_key(session.state_hash) != light.cache_key(session.state_hash)
    assert render(session, dark) != render(session, light)


def test_dark_figures_draw_their_labels_in_a_light_ink(client: TestClient, sid: str):
    """The title text is the part MNE would otherwise leave black-on-black."""
    im = _render(sid, theme="dark").convert("RGBA")
    px = im.load()
    fg = palette("dark")["fg"]
    assert fg.startswith("#")
    # any opaque pixel brighter than mid-grey in the title strip
    top = [px[x, y] for y in range(0, 14) for x in range(0, im.width, 3)]
    assert any(p[3] > 0 and min(p[:3]) > 128 for p in top), "no light ink in the title row"


def test_an_unknown_theme_falls_back_rather_than_failing(client: TestClient, sid: str):
    assert render(sessions.get(sid), RenderSpec(view="topomap", source="cursor",
                                                t=1.0, theme="chartreuse"))


def test_the_frame_size_matches_the_client():
    """The one constant that lives in two languages.

    `precompute` renders the grid at FRAME_SIZE and the client asks for figures
    at its own FRAME_SIZE. The size is part of the cache key, so if these two
    numbers drift apart nothing errors: every scrub just quietly misses the
    cache and re-runs matplotlib, and the only symptom is that the app got slow.
    Read the TypeScript constant and compare, because there is nowhere else the
    two halves can be checked against each other.
    """
    ts = (Path(__file__).resolve().parents[2] / "frontend/src/lib/figures.ts").read_text()
    m = re.search(r"FRAME_SIZE\s*=\s*(\d+)", ts)
    assert m, "FRAME_SIZE not found in frontend/src/lib/figures.ts"
    assert int(m.group(1)) == pre.FRAME_SIZE[0] == pre.FRAME_SIZE[1], (
        f"client asks for {m.group(1)}px frames, the server precomputes "
        f"{pre.FRAME_SIZE[0]}px: every cursor figure will miss the cache"
    )


def test_the_filmstrip_manifest_reads_the_raw_under_the_session_lock(client: TestClient, sid: str):
    """A guard for a real 500, not a hypothetical.

    The client polls ``/filmstrip`` on a timer while the user keeps working, and
    the manifest reads ``session.raw.get_montage()``. That looks like a read and
    is not: MNE's ``_check_consistency`` *writes* ``info["ch_names"]`` while
    normalising them, so a rename landing in the middle raised ``ch_names
    cannot be set directly`` out of MNE's own guard and the poll 500'd. It
    turned up in a browser run, where the poll and the channel tests interleave
    on their own.

    This asserts the **invariant**, not the crash. Racing two threads for real
    never reproduced it here: the vulnerable window is inside MNE's rename, a
    few microseconds wide, and ``TestClient`` serialises requests through one
    portal so it cannot interleave them at all. A racing test that passes either
    way would be decoration. Checking that the lock is genuinely held while the
    Raw is touched is the property the fix establishes, and it fails the moment
    somebody takes the lock back out.
    """
    from app.services.session_manager import sessions

    session = sessions.get(sid)
    held: list[bool] = []

    real_frame_times = pre.frame_times

    def recording_frame_times(duration, **kw):
        # RLock._is_owned() answers "does *this* thread hold it", which is
        # exactly the question: the manifest must not touch session.raw outside
        # the lock, and frame_times is the first thing it calls.
        held.append(session.lock._is_owned())
        return real_frame_times(duration, **kw)

    pre.frame_times = recording_frame_times
    try:
        pre.filmstrip_manifest(session)
    finally:
        pre.frame_times = real_frame_times

    assert held == [True], (
        "filmstrip_manifest read the live Raw without the session lock; "
        "MNE's get_montage() writes info['ch_names'] and will collide with a "
        "concurrent rename"
    )
