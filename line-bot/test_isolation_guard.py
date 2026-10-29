# -*- coding: utf-8 -*-
"""M1：不呼叫 install_isolation 的 import 也不得寫正式檔、不得打 LINE API。"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = Path(r"C:/Users/cyc39/laundry-repo/data")
WATCHED = [
    DATA / "line-bookings.jsonl",
    DATA / "staff-inbox.jsonl",
    DATA / "line-sessions.json",
    DATA / "line-customer-bind.json",
]


def _sha(path: Path):
    if not path.exists():
        return None
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def test_conftest_wires_isolation():
    p = HERE / "conftest.py"
    assert p.is_file(), "conftest.py missing"
    text = p.read_text(encoding="utf-8")
    assert "install_isolation" in text
    assert "fixture=True" in text or "fixture = True" in text


def test_import_without_explicit_install_isolation():
    before = {str(p): _sha(p) for p in WATCHED}
    child = """# -*- coding: utf-8 -*-
import hashlib
import os
import sys
import urllib.request
from pathlib import Path

here = Path(__file__).resolve().parent
# child.py is in a temp dir; line-bot is passed as argv[1]
root = Path(sys.argv[1])
os.chdir(str(root))
sys.path.insert(0, str(root))
os.environ["LAUNDRY_LOOKUP_FIXTURE"] = "1"

DATA = Path(r"C:/Users/cyc39/laundry-repo/data")
files = [
    DATA / "line-bookings.jsonl",
    DATA / "staff-inbox.jsonl",
    DATA / "line-sessions.json",
    DATA / "line-customer-bind.json",
]

def sha(p):
    if not p.exists():
        return None
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()

before = {str(p): sha(p) for p in files}
# 故意不呼叫 install_isolation
import test_line_flows as flows
data = DATA.resolve()
book = Path(flows.conv.BOOK).resolve()
assert data not in book.parents and book != data, str(book)
flows.test_query_unknown()
after = {str(p): sha(p) for p in files}
assert after == before, (before, after)
assert urllib.request.urlopen is flows.fake_urlopen
print("CHILD_OK")
"""
    tmp = Path(tempfile.mkdtemp(prefix="iso-guard-")) / "child.py"
    tmp.write_text(child, encoding="utf-8")
    env = os.environ.copy()
    env["LAUNDRY_LOOKUP_FIXTURE"] = "1"
    r = subprocess.run(
        [sys.executable, str(tmp), str(HERE)],
        cwd=str(HERE),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    after = {str(p): _sha(p) for p in WATCHED}
    assert r.returncode == 0, (r.stdout or "") + "\n" + (r.stderr or "")
    assert "CHILD_OK" in (r.stdout or ""), r.stdout
    assert after == before, (before, after)


if __name__ == "__main__":
    test_conftest_wires_isolation()
    test_import_without_explicit_install_isolation()
    print("PASS", 2)
    sys.exit(0)
