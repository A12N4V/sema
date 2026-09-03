"""Reader registry, modality detection, dataset catalog (docs P0.10).
The actual dataset downloads aren't exercised here (network + size)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.datasets import DATASETS, catalog
from app.core.loader import SUPPORTED_EXTENSIONS
from app.core.modality import detect_modalities
from app.core.demo import make_demo_raw
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_reader_registry_covers_the_common_formats():
    for ext in (".edf", ".bdf", ".fif", ".vhdr", ".set", ".cnt", ".snirf", ".ds"):
        assert ext in SUPPORTED_EXTENSIONS


def test_modality_detection_on_demo():
    m = detect_modalities(make_demo_raw())
    assert m["primary"] == ["eeg"]
    assert "eeg" in m["channel_types"]
    assert m["type_counts"]["eeg"] == 32


def test_session_info_carries_modalities(client: TestClient):
    info = client.post("/api/sessions/demo").json()
    assert info["modalities"]["primary"] == ["eeg"]


def test_dataset_catalog_endpoint(client: TestClient):
    r = client.get("/api/datasets")
    assert r.status_code == 200
    names = {d["name"] for d in r.json()["datasets"]}
    assert {"eegbci", "sample", "fnirs_motor"} <= names
    assert set(names) == set(DATASETS)


def test_open_unknown_dataset_404(client: TestClient):
    assert client.post("/api/datasets/nope/open").status_code == 404
