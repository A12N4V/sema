"""``eegvis <file>`` — boot the workbench on a recording from the shell."""
from __future__ import annotations

import argparse
import sys

import mne

from app.core.loader import load_raw
from app.plugin import launch


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="eegvis", description="Open an EEG/MEG recording in the EEGvis workbench.")
    p.add_argument("file", help="path to a recording MNE can read")
    p.add_argument("--api-port", type=int, default=8123)
    p.add_argument("--web-port", type=int, default=5173)
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args(argv)

    try:
        raw = load_raw(args.file)
    except Exception as e:  # noqa: BLE001
        print(f"eegvis: could not read {args.file!r}: {e}", file=sys.stderr)
        return 1

    launch(
        raw,
        api_port=args.api_port,
        web_port=args.web_port,
        open_browser=not args.no_browser,
        block=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
