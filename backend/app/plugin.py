"""``eegvis.launch(raw)`` — open the current in-memory recording in the
EEGvis workbench from a notebook or script.

    import eegvis
    eegvis.launch(raw)

Starts the API + web server if one isn't already up, serialises ``raw`` to a
temp FIF, attaches it as a session, and opens the browser at ``/s/<id>``.
See docs/BUILD_PLAN_V2.md P0.11.
"""
from __future__ import annotations

import atexit
import subprocess
import sys
import tempfile
import time
import webbrowser
from pathlib import Path

import httpx
import mne

DEFAULT_HOST = "127.0.0.1"
DEFAULT_API_PORT = 8123
DEFAULT_WEB_PORT = 5173

_spawned: list[subprocess.Popen] = []


def _api_up(host: str, port: int) -> bool:
    try:
        return httpx.get(f"http://{host}:{port}/api/health", timeout=1.0).status_code == 200
    except Exception:
        return False


def _spawn_server(host: str, port: int) -> None:
    repo = Path(__file__).resolve().parents[1]          # backend/
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", host, "--port", str(port)],
        cwd=repo,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _spawned.append(proc)
    for _ in range(60):
        if _api_up(host, port):
            return
        time.sleep(0.5)
    raise RuntimeError("EEGvis API did not come up within 30 s")


@atexit.register
def _cleanup() -> None:
    for p in _spawned:
        p.terminate()


def launch(
    raw: mne.io.BaseRaw,
    *,
    host: str = DEFAULT_HOST,
    api_port: int = DEFAULT_API_PORT,
    web_port: int = DEFAULT_WEB_PORT,
    open_browser: bool = True,
    block: bool = False,
) -> str:
    """Attach ``raw`` to a new EEGvis session and open it. Returns the URL."""
    if not _api_up(host, api_port):
        _spawn_server(host, api_port)

    tmp = Path(tempfile.mkdtemp()) / "eegvis_launch_raw.fif"
    raw.save(tmp, overwrite=True, verbose="ERROR")

    with tmp.open("rb") as f:
        r = httpx.post(
            f"http://{host}:{api_port}/api/sessions/attach",
            files={"file": ("eegvis_launch_raw.fif", f, "application/octet-stream")},
            timeout=120.0,
        )
    r.raise_for_status()
    sid = r.json()["session_id"]

    url = f"http://{host}:{web_port}/s/{sid}"
    if open_browser:
        webbrowser.open(url)
    print(f"EEGvis: {url}")
    if block:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    return url
