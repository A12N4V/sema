"""Golden-session test: a fixed pipeline, and the guarantee that the ledger
can deterministically reproduce it via replay()."""
from __future__ import annotations

import numpy as np
import pytest

from app.core.demo import make_demo_raw
from app.services.session_manager import Session


@pytest.fixture
def session() -> Session:
    return Session(id="test", filename="demo", raw=make_demo_raw())


def test_pipeline_records_a_ledger(session: Session):
    session.set_montage("standard_1020")
    session.filter(1.0, 40.0)
    session.notch([60.0])
    session.set_bads(["T7"])

    ops = [e.op for e in session.ledger.entries]
    assert ops == ["set_montage", "filter", "notch", "set_bads"]
    assert session.ledger.entries[1].label == "Band-pass 1–40 Hz"
    assert session.raw.info["highpass"] == 1.0
    assert session.raw.info["bads"] == ["T7"]


def test_replay_from_origin_is_deterministic(session: Session):
    session.set_montage("standard_1020")
    session.filter(1.0, 40.0)
    session.notch([60.0])

    live = session.raw.get_data()
    replayed = session.replay(len(session.ledger)).get_data()
    assert np.allclose(live, replayed, atol=1e-12)


def test_revert_rolls_back_state(session: Session):
    session.filter(1.0, 40.0)
    session.notch([60.0])
    session.set_bads(["T7"])
    assert len(session.ledger) == 3

    session.revert(1)  # keep only the band-pass
    assert len(session.ledger) == 1
    assert session.raw.info["bads"] == []
    assert session.raw.info["highpass"] == 1.0

    session.revert(0)  # pristine
    assert len(session.ledger) == 0
    assert session.raw.info["highpass"] == make_demo_raw().info["highpass"]


def test_revert_past_montage_clears_montage_name(session: Session):
    # demo raw ships with a montage but no name recorded through the service
    session.set_montage("standard_1005")
    session.filter(1.0, 40.0)
    assert session.montage_name == "standard_1005"

    session.revert(1)  # keep the montage step, drop the filter
    assert session.montage_name == "standard_1005"

    session.revert(0)  # drop the montage step too
    assert session.montage_name is None


def test_concurrent_reads_during_a_filter_do_not_crash(session: Session):
    """Route handlers are threadpooled now; a read landing mid-mutation must
    block on the session lock, not tear a half-filtered Raw."""
    import threading

    errors: list[Exception] = []

    def hammer_reads() -> None:
        try:
            for _ in range(20):
                with session.lock:
                    session.raw.get_data(picks=session.raw.ch_names[:4], start=0, stop=256)
        except Exception as e:  # pragma: no cover - the point is this stays empty
            errors.append(e)

    readers = [threading.Thread(target=hammer_reads) for _ in range(4)]
    for r in readers:
        r.start()
    session.filter(1.0, 40.0)
    session.resample(128.0)
    for r in readers:
        r.join()

    assert not errors
    assert len(session.ledger) == 2


def test_to_python_is_runnable_source(session: Session):
    session.set_montage("standard_1020")
    session.filter(1.0, 40.0)
    script = session.to_python()
    assert "import mne" in script
    assert "raw.filter(l_freq=1.0, h_freq=40.0)" in script
    assert "make_standard_montage('standard_1020')" in script
    compile(script.replace('"""Generated', '"""'), "<pipeline>", "exec")  # parses
