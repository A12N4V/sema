"""The capabilities added to close the gap against EEGLAB.

Three chains, each of which was simply absent before:

* **channels**: a table you can sort, rename, retype and drop from, plus
  automatic bad-channel detection (the channel half of clean_rawdata).
* **annotations**: read them, replace them, and generate them from muscle
  artifact.
* **epochs to evoked to time-frequency**: the node that gates most of what a
  professional does after cleaning.

Plus ICLabel, which is the single feature EEGLAB users reach for by reflex.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def sid(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


def run(client: TestClient, sid: str, op_id: str, **params) -> dict:
    r = client.post(f"/api/sessions/{sid}/ops", json={"op_id": op_id, "params": params})
    assert r.status_code in (200, 202), f"{op_id} -> {r.status_code}: {r.text[:300]}"
    if r.status_code == 202:
        import time
        jid = r.json()["job_id"]
        for _ in range(900):
            state = client.get(f"/api/jobs/{jid}").json()
            if state["state"] in ("done", "error"):
                break
            time.sleep(0.1)
        assert state["state"] == "done", state["error"]
    return r.json()


def caps(client: TestClient, sid: str) -> set[str]:
    return set(client.get(f"/api/sessions/{sid}/graph").json()["capabilities"])


def kinds(client: TestClient, sid: str) -> set[str]:
    return {n["kind"] for n in client.get(f"/api/sessions/{sid}/graph").json()["graph"]}


# ------------------------------------------------------------------ channels

def test_channel_table_has_a_row_per_channel_with_sortable_numbers(client, sid):
    info = client.get(f"/api/sessions/{sid}").json()
    rows = client.get(f"/api/sessions/{sid}/channels").json()["channels"]
    assert len(rows) == info["n_channels"]
    first = rows[0]
    assert set(first) >= {"name", "type", "bad", "has_position", "mean", "std",
                          "peak_to_peak", "flat", "unit"}
    assert first["unit"] == "µV", "EEG must be reported in the unit people read"
    assert all(r["peak_to_peak"] >= 0 for r in rows)


def test_marking_a_channel_bad_shows_up_in_the_table(client, sid):
    run(client, sid, "set_bads", bads=["Fp1"])
    rows = client.get(f"/api/sessions/{sid}/channels").json()["channels"]
    assert [r["name"] for r in rows if r["bad"]] == ["Fp1"]


def test_rename_retype_and_drop_all_land_in_the_ledger(client, sid):
    run(client, sid, "rename_channels", mapping={"Fp1": "LEFT_FRONTAL"})
    assert "LEFT_FRONTAL" in client.get(f"/api/sessions/{sid}").json()["channel_names"]

    run(client, sid, "set_channel_types", mapping={"LEFT_FRONTAL": "eog"})
    rows = {r["name"]: r for r in client.get(f"/api/sessions/{sid}/channels").json()["channels"]}
    assert rows["LEFT_FRONTAL"]["type"] == "eog"

    before = len(client.get(f"/api/sessions/{sid}").json()["channel_names"])
    run(client, sid, "drop_channels", channels=["LEFT_FRONTAL"])
    assert len(client.get(f"/api/sessions/{sid}").json()["channel_names"]) == before - 1

    ops = [e["op"] for e in client.get(f"/api/sessions/{sid}/history").json()["entries"]]
    assert ops == ["rename_channels", "set_channel_types", "drop_channels"]


def test_dropping_every_channel_is_refused(client, sid):
    names = client.get(f"/api/sessions/{sid}").json()["channel_names"]
    r = client.post(f"/api/sessions/{sid}/ops",
                    json={"op_id": "drop_channels", "params": {"channels": names}})
    assert r.status_code == 422


def test_automatic_bad_channel_detection_runs_and_is_replayable(client, sid):
    run(client, sid, "detect_bad_channels", threshold=1.5, n_neighbors=20)
    entry = client.get(f"/api/sessions/{sid}/history").json()["entries"][-1]
    assert entry["op"] == "detect_bad_channels"
    assert entry["replayable"] is True, "a detection must replay as its result, not re-run"
    py = client.get(f"/api/sessions/{sid}/export/pipeline.py").text
    assert "find_bad_channels_lof" in py


# --------------------------------------------------------------- annotations

def test_annotations_round_trip(client, sid):
    # the demo ships with simulated blinks, so this replaces rather than adds
    assert client.get(f"/api/sessions/{sid}/annotations").json()["annotations"]
    run(client, sid, "set_annotations", annotations=[
        {"onset": 1.0, "duration": 0.5, "description": "stim"},
        {"onset": 4.0, "duration": 2.0, "description": "BAD_blink"},
    ])
    body = client.get(f"/api/sessions/{sid}/annotations").json()
    assert [a["description"] for a in body["annotations"]] == ["stim", "BAD_blink"]
    assert [a["bad"] for a in body["annotations"]] == [False, True], \
        "BAD_* is what MNE excludes from later maths, so the UI must show it differently"
    assert body["labels"] == ["BAD_blink", "stim"]
    assert "annotations" in caps(client, sid)


def test_muscle_annotation_appends_rather_than_replacing(client, sid):
    run(client, sid, "set_annotations",
        annotations=[{"onset": 1.0, "duration": 0.5, "description": "stim"}])
    run(client, sid, "annotate_muscle", threshold=5.0, min_length_good=0.2)
    kept = [a["description"] for a in
            client.get(f"/api/sessions/{sid}/annotations").json()["annotations"]]
    assert "stim" in kept, "a detection must not delete the user's own marks"


# ------------------------------------------------- epochs, evoked, and TFR

def test_the_whole_epoched_chain(client, sid):
    run(client, sid, "filter", l_freq=1.0, h_freq=40.0)
    run(client, sid, "set_annotations", annotations=[
        {"onset": t, "duration": 0.0, "description": "stim"} for t in range(5, 120, 5)
    ])

    run(client, sid, "make_epochs", tmin=-0.2, tmax=0.8, description="stim",
        baseline=True, reject_uv=None)
    summary = client.get(f"/api/sessions/{sid}/epochs/summary").json()
    assert summary["n_epochs"] > 5
    assert summary["conditions"]["stim"] == summary["n_epochs"]
    assert summary["tmin"] == pytest.approx(-0.2, abs=0.01)
    assert "epochs" in caps(client, sid) and "epochs" in kinds(client, sid)

    image = client.get(f"/api/sessions/{sid}/epochs/image",
                       params={"channel": summary["channels"][0]}).json()
    assert len(image["matrix"]) == image["n_epochs"]
    assert len(image["matrix"][0]) == len(image["times"])

    run(client, sid, "average_epochs")
    ev = client.get(f"/api/sessions/{sid}/evoked").json()
    assert ev["nave"] == summary["n_epochs"]
    assert len(ev["gfp"]) == len(ev["times"])
    assert ev["peak_channel"] in ev["channels"]
    assert "evoked" in kinds(client, sid)

    run(client, sid, "compute_tfr", fmin=4.0, fmax=30.0, n_freqs=8, decim=6)
    power = client.get(f"/api/sessions/{sid}/tfr").json()
    assert len(power["freqs"]) == 8
    assert len(power["matrix"]) == 8
    assert len(power["matrix"][0]) == len(power["times"])
    assert "dB" in power["unit"]
    assert "tfr" in kinds(client, sid)

    # the container graph is a real lineage, not a flat list
    graph = {n["id"]: n["parent_id"] for n in
             client.get(f"/api/sessions/{sid}/graph").json()["graph"]}
    assert graph["epochs"] == "raw"
    assert graph["evoked"] == "epochs"
    assert graph["tfr"] == "epochs"


def test_epochs_fall_back_to_a_fixed_grid_without_events(client, sid):
    """A resting recording has no triggers, and should still reach Epochs."""
    run(client, sid, "make_epochs", tmin=0.0, tmax=2.0, baseline=False, reject_uv=None)
    assert client.get(f"/api/sessions/{sid}/epochs/summary").json()["n_epochs"] > 10


def test_a_rejection_that_drops_everything_is_an_error_not_an_empty_pane(client, sid):
    r = client.post(f"/api/sessions/{sid}/ops", json={
        "op_id": "make_epochs",
        "params": {"tmin": 0.0, "tmax": 2.0, "baseline": False, "reject_uv": 0.001}})
    assert r.status_code == 422
    assert "reject" in r.json()["detail"].lower()


def test_analysis_reads_are_400_before_their_container_exists(client, sid):
    for path in ["epochs/summary", "evoked", "tfr"]:
        assert client.get(f"/api/sessions/{sid}/{path}").status_code == 400


# ------------------------------------------------------------------ ICLabel

def test_iclabel_classifies_and_auto_marks(client, sid):
    run(client, sid, "filter", l_freq=1.0, h_freq=40.0)
    run(client, sid, "fit_ica", n_components=8, method="fastica")
    run(client, sid, "label_ica")

    comps = client.get(f"/api/sessions/{sid}/ica/components").json()["components"]
    assert len(comps) == 8
    assert all(c["label"] for c in comps), "every component must get a class"
    assert all(0.0 <= c["label_prob"] <= 1.0 for c in comps)
    assert "ica_labels" in caps(client, sid)

    # auto-marking only ever selects components of the classes asked for
    run(client, sid, "exclude_ica_by_label", labels=["eye blink"], min_prob=0.5)
    marked = [c for c in client.get(f"/api/sessions/{sid}/ica/components").json()["components"]
              if c["excluded"]]
    assert all(c["label"] == "eye blink" and c["label_prob"] >= 0.5 for c in marked)

    # a probability outside [0, 1] is a schema error, not a silent no-op
    r = client.post(f"/api/sessions/{sid}/ops", json={
        "op_id": "exclude_ica_by_label",
        "params": {"labels": ["eye blink"], "min_prob": 1.01}})
    assert r.status_code == 422


def test_classification_is_refused_before_a_fit(client, sid):
    r = client.post(f"/api/sessions/{sid}/ops", json={"op_id": "label_ica", "params": {}})
    # gated by the `ica` capability, so it never reaches the model
    assert r.status_code in (400, 409, 422)
