"""Point EEGvis's working data at a throwaway dir for the test run so the
suite never writes into the developer's ~/.eegvis."""
import os
import tempfile

os.environ.setdefault("EEGVIS_DATA_DIR", tempfile.mkdtemp(prefix="eegvis-test-"))
