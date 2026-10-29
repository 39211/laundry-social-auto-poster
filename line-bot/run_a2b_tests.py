"""A2b offline runner: synthetic data and temp files stay inside line-bot/."""
from __future__ import annotations

import importlib
import ast
import inspect
import json
import os
from pathlib import Path
import runpy
import shutil
import sys
import tempfile
import unittest
import uuid


def main() -> int:
    bot = Path(__file__).resolve().parent
    tmp_root = bot / (".a2b-test-tmp-" + uuid.uuid4().hex)
    tmp_root.mkdir(exist_ok=True)
    tempfile.tempdir = str(tmp_root)
    os.environ.update(TMP=str(tmp_root), TEMP=str(tmp_root), PYTHONDONTWRITEBYTECODE="1")
    # Python 3.14's Windows mode=0o700 temp ACL excludes the sandbox identity.
    # Normal mkdir inherits this already restricted worktree's usable ACL.
    def inherited_tempdir(suffix=None, prefix=None, dir=None):
        path = Path(dir or tempfile.gettempdir()) / ((prefix or "tmp") + uuid.uuid4().hex + (suffix or ""))
        path.mkdir(mode=0o755)
        return str(path)

    tempfile.mkdtemp = inherited_tempdir
    sandbox = Path(tempfile.mkdtemp(prefix="repo-"))
    data = sandbox / "data"
    data.mkdir()
    for name in ("prices.json", "business-profile.json"):
        shutil.copyfile(bot.parent / "data" / name, data / name)
    fixture = {
        "customers": [
            {"no": "0028", "name": "Synthetic A", "phone": "0912345678"},
            {"no": "1947", "name": "Synthetic B", "phone": "0900000002"},
        ],
        "garments": [
            {"id": "1", "customer_no": "0028", "wash_no": "W1001", "name": "shirt", "status": "stock"},
            {"id": "2", "customer_no": "0028", "wash_no": "W1002", "name": "coat", "status": "wash"},
            {"id": "3", "customer_no": "1947", "wash_no": "W2001", "name": "coat", "status": "wash"},
        ],
    }
    (data / "laundry-fixture.json").write_text(json.dumps(fixture), encoding="utf-8")
    (sandbox / "secrets").mkdir()
    (sandbox / "secrets/line-channel.json").write_text(json.dumps({
        "channel_secret": "synthetic-offline", "channel_access_token": "synthetic-offline",
        "channelSecret": "synthetic-offline", "channelAccessToken": "synthetic-offline",
    }), encoding="utf-8")
    os.environ.update(LAUNDRY_REPO_ROOT=str(sandbox), LAUNDRY_EHANK_ROOT=str(sandbox / "no-pos"),
                      LAUNDRY_LOOKUP_FIXTURE="1")
    forbidden = ("c:/fxwash", "c:/users/cyc39/laundry-repo")

    def blocked(path):
        value = str(path).replace("\\", "/").lower()
        return any(value == root or value.startswith(root + "/") for root in forbidden)

    # Legacy test_conversation probes hard-coded production paths with exists().
    # Return absence before any OS stat, without accessing those paths.
    real_stat = os.stat

    def safe_stat(path, *args, **kwargs):
        if blocked(path):
            raise FileNotFoundError("A2b: production paths are isolated")
        return real_stat(path, *args, **kwargs)

    os.stat = safe_stat
    for name in ("exists", "is_file", "is_dir"):
        original = getattr(Path, name)
        def probe(path, *args, _original=original, **kwargs):
            return False if blocked(path) else _original(path, *args, **kwargs)
        setattr(Path, name, probe)

    def audit(event, args):
        if event in ("open", "os.listdir", "os.scandir") and args and blocked(args[0]):
            raise PermissionError("A2b: production filesystem access forbidden")
        if event in ("socket.connect", "socket.getaddrinfo"):
            raise PermissionError("A2b: network forbidden")

    sys.addaudithook(audit)
    sys.path.insert(0, str(bot))
    # Reuse only the existing offline Flask shim function, not that test's
    # module-level imports or fixed sandbox convention.
    shim_file = bot / "test_linebot_fix_20260926.py"
    tree = ast.parse(shim_file.read_text(encoding="utf-8-sig"))
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_install_flask_shim")
    namespace = {"sys": sys, "json": json}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(shim_file), "exec"), namespace)
    namespace["_install_flask_shim"]()
    import flask
    if not hasattr(flask.Flask, "run"):
        def no_server(*args, **kwargs):
            raise AssertionError("A2b: starting a server is forbidden")
        flask.Flask.run = no_server
    module_name = sys.argv[1]
    try:
        if module_name == "test_conversation":
            runpy.run_module(module_name, run_name="__main__")
            return 0
        module = importlib.import_module(module_name)
        suite = unittest.defaultTestLoader.loadTestsFromModule(module)
        for name, fn in vars(module).items():
            if name.startswith("test_") and inspect.isfunction(fn):
                suite.addTest(unittest.FunctionTestCase(fn))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        return 0 if result.wasSuccessful() else 1
    finally:
        # Only this task's resolved sandbox directory; never a production path.
        shutil.rmtree(tmp_root)


if __name__ == "__main__":
    raise SystemExit(main())
