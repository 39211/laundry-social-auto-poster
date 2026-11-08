"""Shared test-only temp allocation, including Python subprocesses on Windows 3.14."""
import os
from pathlib import Path
import tempfile
import uuid


def inherited_tempdir(suffix=None, prefix=None, dir=None):
    # mode=0o700 on Python 3.14 Windows excludes the restricted child identity.
    # Inherit the ACL of the task's already restricted scratch directory instead.
    parent = Path(dir or tempfile.gettempdir())
    for _ in range(100):
        path = parent / ((prefix or "tmp") + uuid.uuid4().hex + (suffix or ""))
        try:
            path.mkdir(mode=0o755)
        except FileExistsError:
            continue
        return str(path.resolve())
    raise FileExistsError("could not allocate a unique offline test directory")


def install_temp_root(root):
    root = Path(root).resolve(strict=True)
    tempfile.tempdir = str(root)
    tempfile.mkdtemp = inherited_tempdir
    os.environ.update(TMP=str(root), TEMP=str(root), PYTHONDONTWRITEBYTECODE="1")
    return root
