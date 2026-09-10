"""The auto-derive pass, and the two promises it makes.

The pass fills ICA / Epochs / Evoked / TFR / Source on load so those workspaces
open with a figure instead of a form. That is only defensible because of two
invariants, and both are easy to break by accident:

1. **It does not touch the recording.** Everything is computed on a filtered
   copy, and it writes no ledger entries, so the exported ``pipeline.py`` still
   reproduces what the *user* did and nothing else.
2. **It disowns itself the moment the user takes over.** A pane that still says
   "automatic, not part of your pipeline" over a brain the user computed
   themselves is lying in the direction that costs them credit for their work.
"""
from __future__ import annotations

import pytest

from app.core import autoderive
from app.core.containers import ContainerKind, auto_derived, clear_derived
from app.core.demo import make_demo_raw
from app.services.session_manager import sessions


@pytest.fixture
def session():
    return sessions.create("autoderive-demo.fif", make_demo_raw())


def test_the_pass_leaves_the_recording_and_the_ledger_alone(session):
    import numpy as np

    before_steps = len(session.ledger.to_list())
    before_ch = list(session.raw.ch_names)
    before_data = session.raw.get_data().copy()

    autoderive.derive(session)

    # If the pass ever filters, re-references or picks on `session.raw` itself,
    # the user's signal silently becomes something they did not ask for. The
    # samples, not the state hash: the hash moves legitimately here, because it
    # tracks whether an ICA exists and now one does.
    assert list(session.raw.ch_names) == before_ch
    assert np.array_equal(session.raw.get_data(), before_data)
    # And a ledger entry here would put a step the user never chose into their
    # exported script, which is the one promise the whole app rests on.
    assert len(session.ledger.to_list()) == before_steps


def test_every_derived_container_declares_its_assumptions(session):
    for d in autoderive.derive(session):
        assert d.call.strip(), f"{d.container} shows no MNE call"
        assert d.assumptions, f"{d.container} claims to assume nothing, which is never true"


def test_running_the_real_operation_expires_the_badge(session):
    autoderive.derive(session)
    assert "ica" in auto_derived(session)

    clear_derived(session, ContainerKind.ICA)
    assert "ica" not in auto_derived(session), "the user fitted this one; it is theirs now"


def test_rebuilding_a_parent_expires_its_children(session):
    autoderive.derive(session)
    assert {"epochs", "evoked", "tfr"} <= set(auto_derived(session))

    # Recutting epochs invalidates the average and the TFR hanging off them, so
    # their derivation records would describe objects that no longer exist.
    clear_derived(session, ContainerKind.EPOCHS)
    assert not ({"epochs", "evoked", "tfr"} & set(auto_derived(session)))
    assert "ica" in auto_derived(session), "ICA branches off raw, not off epochs"


def test_the_figures_are_rendered_for_the_state_the_derivation_leaves_behind():
    """The prepare job must derive before it renders, not after.

    `state_hash` folds in whether an ICA exists, and every cached PNG is named
    with it. When the pass fitted its ICA *after* precomputing, all 186 frames
    landed under a hash the session no longer had, so the client missed on every
    one and re-rendered them one at a time while the user dragged the cursor.
    Nothing failed; it just quietly got slow.
    """
    import time

    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    sid = client.post("/api/sessions/demo").json()["session_id"]
    r = client.post(f"/api/sessions/{sid}/precompute",
                    json={"theme": "dark", "width": 120, "height": 120})
    assert r.status_code == 202, r.text
    jid = r.json()["job_id"]
    for _ in range(1200):
        job = client.get(f"/api/jobs/{jid}").json()
        if job["state"] in ("done", "error"):
            break
        time.sleep(0.2)
    assert job["state"] == "done", job

    session = sessions.get(sid)
    assert job["result"]["state_hash"] == session.state_hash, (
        "the frames were rendered for a state the session had already left"
    )


def test_the_pass_never_overwrites_work_the_user_did(session):
    """A second pass on a worked-in session must leave the user's objects alone.

    The pass runs again on every reload, because the render cache is keyed by
    state and the state moved. Before this guard, reopening a tab after an hour
    of real analysis replaced the user's epochs with the automatic ones and
    re-badged them "automatic", which inverts the promise the disclaimer makes.
    """
    import mne

    autoderive.derive(session)

    # stand in for the user running make_epochs themselves
    events = mne.make_fixed_length_events(session.raw, duration=2.0)
    mine = mne.Epochs(session.raw, events, tmin=0, tmax=2.0, baseline=None,
                      preload=True, verbose="ERROR")
    session.epochs = mine
    clear_derived(session, ContainerKind.EPOCHS)

    autoderive.derive(session)

    assert session.epochs is mine, "the pass overwrote the user's epochs"
    assert "epochs" not in auto_derived(session)
    # and it did not quietly average the user's trials into an "automatic" evoked
    assert "evoked" not in auto_derived(session)
    assert "tfr" not in auto_derived(session)


def test_a_cache_load_loses_a_race_it_starts_rather_than_winning_it(session, monkeypatch):
    """Claiming a container mid-load must beat the cache, not lose to it.

    `load_cached` reads four MNE files off disk. That is slow enough for the
    user to run `make_epochs` in the middle of it, and checking ownership only
    once at the top meant the assignment afterwards landed on top of the epochs
    they had just cut, and badged them automatic again. Under the browser suite
    this happened reliably.
    """
    import mne

    autoderive.save_cached(session, autoderive.derive(session))

    fresh = sessions.create("autoderive-race.fif", make_demo_raw())
    mine = mne.Epochs(fresh.raw,
                      mne.make_fixed_length_events(fresh.raw, duration=2.0),
                      tmin=0, tmax=2.0, baseline=None, preload=True, verbose="ERROR")

    # Stand in for the user's operation landing while the read is still going:
    # evoked is read after epochs, so this fires between the two.
    real = mne.read_evokeds

    def claim(*a, **k):
        fresh.epochs = mine
        return real(*a, **k)

    monkeypatch.setattr(mne, "read_evokeds", claim)
    autoderive.load_cached(fresh)

    assert fresh.epochs is mine, "the cache load overwrote epochs the user cut mid-read"
    assert "epochs" not in auto_derived(fresh)
