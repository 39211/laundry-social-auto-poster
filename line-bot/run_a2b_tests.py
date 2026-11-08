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
import stat
import subprocess
import sys
import tempfile
import unittest
import uuid


_LOOPBACK_HOSTS = ("127.0.0.1", "::1", "localhost")
# 這些測試是「腳本式」：自己的 __main__ 會在每個案例之間重置狀態、並用 sys.exit 回報結果，
# 逐一包成 FunctionTestCase 會讓案例互相污染（例如 _staff.inbox 沒清空），所以整支照原樣跑。
_SCRIPT_STYLE_MODULES = ("test_conversation", "test_guided_flows")


def _is_loopback(address) -> bool:
    host = address[0] if isinstance(address, tuple) and address else address
    return host in _LOOPBACK_HOSTS


def _remove_tree(path: Path, token: str) -> None:
    """只清掉本次建立且未經連結轉向的樹；清理失敗也不能回報全綠。"""
    import gc
    import time

    path = Path(path).absolute()
    if (path.name != ".a2b-test-tmp-" + token or path.is_symlink() or path.is_junction()
            or path.resolve() != path):
        raise ValueError("A2b: refusing cleanup of an unowned or redirected directory")
    if (path / ".a2b-owner").read_text(encoding="ascii") != token:
        raise ValueError("A2b: cleanup owner marker mismatch")
    pending = [path]
    while pending:
        for child in pending.pop().iterdir():
            info = child.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                raise ValueError("A2b: cleanup refuses reparse points")
            if stat.S_ISDIR(info.st_mode):
                pending.append(child)
    for _ in range(5):
        gc.collect()
        try:
            shutil.rmtree(path)
            return
        except OSError as exc:
            last_error = exc
            time.sleep(0.4)
    raise RuntimeError(f"A2b: could not remove owned directory {path.name}") from last_error


def _run_module(tmp_root: Path, module_name: str) -> int:
    bot = Path(__file__).resolve().parent
    sys.path.insert(0, str(bot / "test-assets"))
    from offline_temp import install_temp_root
    install_temp_root(tmp_root)
    sandbox = Path(tempfile.mkdtemp(prefix="repo-"))
    data = sandbox / "data"
    data.mkdir()
    for name in ("prices.json", "business-profile.json"):
        shutil.copyfile(bot.parent / "data" / name, data / name)
    # 追蹤中的 prices.json 缺幾個品項（西裝上衣、西褲、枕頭、娃娃）：它們的價來自店內 eHank 對齊，
    # 沙盒沒有。只在沙盒副本補「合成價」讓報價類測試能跑；這些數字不是店裡的真實價。
    prices_path = data / "prices.json"
    prices_doc = json.loads(prices_path.read_text(encoding="utf-8"))
    synthetic_prices = {
        "衣物": {"西裝": 250, "西褲": 100},
        "寢具": {"枕頭": 150},
        "其他": {"娃娃": 300},
    }
    for category_name, extra in synthetic_prices.items():
        category = prices_doc.get(category_name)
        assert isinstance(category, dict), f"A2b: prices.json has no category {category_name!r}"
        for item_name, price in extra.items():
            category.setdefault(item_name, price)
    prices_path.write_text(json.dumps(prices_doc, ensure_ascii=False, indent=2), encoding="utf-8")
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
        if event == "socket.connect" and len(args) > 1 and _is_loopback(args[1]):
            return
        if event == "socket.getaddrinfo" and args and args[0] in _LOOPBACK_HOSTS:
            return
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
    if module_name in _SCRIPT_STYLE_MODULES:
        runpy.run_module(module_name, run_name="__main__")
        return 0
    module = importlib.import_module(module_name)
    suite = unittest.defaultTestLoader.loadTestsFromModule(module)
    for name, fn in vars(module).items():
        if name.startswith("test_") and inspect.isfunction(fn):
            suite.addTest(unittest.FunctionTestCase(fn))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


def main() -> int:
    if len(sys.argv) == 4 and sys.argv[1] == "--worker":
        return _run_module(Path(sys.argv[3]), sys.argv[2])
    if len(sys.argv) != 2:
        raise SystemExit("usage: run_a2b_tests.py MODULE")
    bot = Path(__file__).resolve().parent
    parent = Path(os.environ.get("A2B_TEST_TMP_PARENT", str(bot))).resolve(strict=True)
    if not parent.is_relative_to(bot):
        raise ValueError("A2b: temp parent must stay inside line-bot")
    token = uuid.uuid4().hex
    tmp_root = parent / (".a2b-test-tmp-" + token)
    tmp_root.mkdir()
    (tmp_root / ".a2b-owner").write_text(token, encoding="ascii")
    try:
        # Audit hooks cannot be uninstalled. Keep each suite's strict hook in a
        # worker; the owning parent removes its tree after that process exits.
        return subprocess.run([sys.executable, "-B", "-X", "utf8", str(Path(__file__).resolve()),
                               "--worker", sys.argv[1], str(tmp_root)], check=False).returncode
    finally:
        _remove_tree(tmp_root, token)


if __name__ == "__main__":
    raise SystemExit(main())
