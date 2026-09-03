"""EEGvis — a browser workbench over MNE-Python.

    import eegvis
    eegvis.launch(raw)
"""
from app.plugin import launch

__all__ = ["launch"]
__version__ = "0.2.0"
