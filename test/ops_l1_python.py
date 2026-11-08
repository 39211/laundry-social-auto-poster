"""Offline unittest entry point; keeps synthetic Windows temp ACLs inherited."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "output" / "operations" / "ops-l1-fixtures"
FIXTURES.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(FIXTURES)
# Python 3.14's private 0700 Windows temp ACL excludes this sandbox's token.
# Only test-owned descendants receive the parent ACL; production is untouched.
_mkdir = os.mkdir
def mkdir(path, mode=0o777, *, dir_fd=None):
    if mode == 0o700 and Path(path).absolute().is_relative_to(FIXTURES):
        mode = 0o777
    return _mkdir(path, mode, dir_fd=dir_fd)
os.mkdir = mkdir
sys.path.insert(0, str(ROOT / "test"))
sys.path.insert(0, str(ROOT / "scripts"))
suite = unittest.TestSuite(unittest.defaultTestLoader.discover(str(ROOT / "test"), pattern=p)
                           for p in sys.argv[1:])
result = unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(not result.wasSuccessful())
