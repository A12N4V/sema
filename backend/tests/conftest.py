"""Point Sema's working data at a throwaway dir for the test run so the
suite never writes into the developer's ~/.sema, and delete it afterwards:
each run persists ~1 GB of session copies and render caches."""
import atexit
import os
import shutil
import tempfile

if "SEMA_DATA_DIR" not in os.environ:
    _tmp = tempfile.mkdtemp(prefix="sema-test-")
    os.environ["SEMA_DATA_DIR"] = _tmp
    atexit.register(shutil.rmtree, _tmp, ignore_errors=True)
