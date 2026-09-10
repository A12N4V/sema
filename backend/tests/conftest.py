"""Point Sema's working data at a throwaway dir for the test run so the
suite never writes into the developer's ~/.sema."""
import os
import tempfile

os.environ.setdefault("SEMA_DATA_DIR", tempfile.mkdtemp(prefix="sema-test-"))
