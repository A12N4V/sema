"""Single place that makes the `plethos` package importable.

The package lives next to the numbered scripts in `workflows/bulk-py/`
(the authors' directory layout, and what the export bundle ships). Adding the
directory to sys.path here – and only here – lets `backend/app/live.py`,
tests and the engine do `import plethos` or `from plethos import de`.
"""
from __future__ import annotations

from pathlib import Path

_BULK_PY = Path(__file__).resolve().parents[3] / "workflows" / "bulk-py"

if str(_BULK_PY) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(_BULK_PY))

try:  # fail loudly at import time if the package is missing or broken
    import plethos  # noqa: F401
except ImportError as e:  # pragma: no cover
    raise ImportError(f"plethos package not importable from {_BULK_PY}: {e}") from e
