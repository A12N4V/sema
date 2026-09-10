"""Sema: a browser workbench over MNE-Python.

    import sema
    sema.launch(raw)          # open the recording you already have in memory

    @sema.operation(label="Detrend", stage="Filter & repair")
    def detrend(raw, order: int = 1):
        ...                     # and it appears in the palette, with a form

See docs/EEGLAB_PARITY.md for what this does and does not cover.
"""
from app.core.extend import operation
from app.plugin import launch

__all__ = ["launch", "operation"]
__version__ = "0.3.0"
