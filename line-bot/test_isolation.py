# -*- coding: utf-8 -*-
"""R5/F8/F9/F14: official data files and LINE network must be untouched."""
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
if str(HERE / "test-assets") not in sys.path:
    sys.path.append(str(HERE / "test-assets"))
import sandbox_repo  # noqa: E402

# T-3: fake repo root generated in a temp dir (replaces the lost line-bot/_sandbox_repo/). It must be in the
# environment before test_line_flows imports the bot modules.
SANDBOX = sandbox_repo.shared_sandbox(prefix="t3-isolation-")
os.environ["LAUNDRY_REPO_ROOT"] = str(SANDBOX)
sandbox_repo.install_write_guard()

_NAMES = (
    "line-bookings.jsonl",
    "staff-inbox.jsonl",
    "line-sessions.json",
    "line-customer-bind.json",
    "line-unanswered.jsonl",  # F9
)
DATA = Path(r"C:/Users/cyc39/laundry-repo/data")
CHECKOUT_DATA = HERE.parent / "data"
WATCHED = [DATA / name for name in _NAMES]
if CHECKOUT_DATA.resolve() != DATA.resolve():
    WATCHED += [CHECKOUT_DATA / name for name in _NAMES]


def _assert_sandbox_bound():
    """Every imported bot module must point at the generated sandbox, never at a real repo."""
    sandbox = SANDBOX.resolve()
    for name in ("conversation", "line_pay", "line_webhook", "laundry_lookup", "staff_notify"):
        module = sys.modules.get(name)
        repo = getattr(module, "REPO", None) if module is not None else None
        if repo is not None:
            assert Path(repo).resolve() == sandbox, (name, str(repo))


def _sha(path: Path):
    if not path.exists():
        return None
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def snapshot():
    return {str(p): _sha(p) for p in WATCHED}


def main():
    before = snapshot()
    import line_pay
    import test_line_flows as flows
    import test_ehank_snapshot as ehank

    _assert_sandbox_bound()
    flows.install_isolation(fixture=True)
    # T-3 round 2: the lookup flows need the synthetic fixture customers; fail loudly here, not deep inside a flow.
    fixture_path = SANDBOX / "data" / "laundry-fixture.json"
    assert Path(flows.L.FIXTURE).resolve() == fixture_path.resolve(), str(flows.L.FIXTURE)
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    nos = {str(row.get("no")) for row in fixture.get("customers") or []}
    assert {"0028", "1947"} <= nos, ("sandbox lookup fixture lacks 0028/1947", sorted(nos))

    flows.test_lookup_ready_and_not_ready()
    flows.test_missing_customer()
    flows.test_menu_pickup_then_address()
    flows.test_menu_store_booking()
    flows.test_query_ready_and_not()
    flows.test_query_unknown()

    os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
    # T-3 round 2: test_ehank_snapshot_ready_and_wait no longer exists; run the snapshot tests that
    # test_ehank_snapshot's own __main__ runs (all patch _from_ehank/db_path, so no real database is read).
    ehank.test_unconnected_snapshot_fails_closed()
    ehank.test_ehank_adapter_wires_full_phone_and_wash_no()
    ehank.test_unconnected_copy()

    # F8: interceptor must have been reached, and only api.line.me
    n = len(flows.URLOPEN_CALLS)
    assert n >= 1, n
    for call in flows.URLOPEN_CALLS:
        host = urlparse(call["url"]).hostname
        assert host == "api.line.me", call
    assert urllib.request.urlopen is flows.fake_urlopen
    assert flows.sn.urllib.request.urlopen is flows.fake_urlopen
    # F14: line_pay.urlopen must be the same interceptor
    assert line_pay.urlopen is flows.fake_urlopen
    _assert_sandbox_bound()
    violations = sandbox_repo.write_violations()
    assert not violations, violations
    after = snapshot()
    assert after == before, (before, after)
    print("PASS", 3)


if __name__ == "__main__":
    main()
