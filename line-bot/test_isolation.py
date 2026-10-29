# -*- coding: utf-8 -*-
"""R5/F8/F9/F14: official data files and LINE network must be untouched."""
import hashlib
import os
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

DATA = Path(r"C:/Users/cyc39/laundry-repo/data")
WATCHED = [
    DATA / "line-bookings.jsonl",
    DATA / "staff-inbox.jsonl",
    DATA / "line-sessions.json",
    DATA / "line-customer-bind.json",
    DATA / "line-unanswered.jsonl",  # F9
]


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

    flows.install_isolation(fixture=True)

    flows.test_lookup_ready_and_not_ready()
    flows.test_missing_customer()
    flows.test_menu_pickup_then_address()
    flows.test_menu_store_booking()
    flows.test_query_ready_and_not()
    flows.test_query_unknown()

    os.environ.pop("LAUNDRY_LOOKUP_FIXTURE", None)
    ehank.test_ehank_snapshot_ready_and_wait()
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
    after = snapshot()
    assert after == before, (before, after)
    print("PASS", 3)


if __name__ == "__main__":
    main()
