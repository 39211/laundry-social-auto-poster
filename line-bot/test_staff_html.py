# -*- coding: utf-8 -*-
"""F3/G8: staff.html must not interpolate guest-controlled fields into HTML sinks."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

HTML = Path(__file__).resolve().parent / "staff.html"

FORBIDDEN_SINKS = (
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
    "document.write",
    "srcdoc",
    "setHTML",
    "eval(",
    "new Function(",
)
SAFE_SINK = r"(?:textContent|createTextNode|addEventListener)"
FIELDS = (
    "x.name",
    "x.item",
    "x.text",
    "x.address",
    "x.id",
    "x.customer_no",
    "x.need",
)


def _src() -> str:
    return HTML.read_text(encoding="utf-8")


def test_no_innerhtml_x_interpolation():
    src = _src()
    assert "${x." not in src
    for m in re.finditer(r"innerHTML\s*=", src):
        window = src[m.start() : m.start() + 500]
        assert "${x." not in window, window
        assert "x.name" not in window
        assert "x.item" not in window
        assert "x.text" not in window
        assert "x.address" not in window
        assert "x.id" not in window
        assert "x.photo" not in window


def test_fields_use_textcontent():
    src = _src()
    assert "createElement" in src
    assert "idEl.textContent" in src
    assert "metaEl.textContent" in src
    assert "x.name" in src
    assert "x.item" in src
    assert "x.text" in src
    assert "x.address" in src
    assert "x.id" in src
    assert "x.need" in src
    # F3: guest-controlled values must not be spliced into onclick strings
    assert "${" not in src
    assert "addEventListener" in src


def test_payload_goes_through_textcontent():
    # F3: feeding <img ... onerror> as name is textContent, not HTML
    src = _src()
    payload = "<img src=x onerror=alert(1)>"
    assert "metaEl.textContent" in src
    assert re.search(r"metaEl\.textContent\s*=\s*\(x\.name", src)
    assert payload not in src
    load_fn = src[src.index("async function load") : src.index("async function done")]
    assert "innerHTML" not in load_fn
    assert "x.name" in load_fn
    assert "textContent" in load_fn


def test_no_html_sink_family():
    # G8: ban the whole sink family, not one author-chosen innerHTML assignment
    src = _src()
    for sink in FORBIDDEN_SINKS:
        assert sink not in src, sink


def _assert_field_bound_to_safe_sink(field: str) -> None:
    # H2: at least one line binds the field to a safe sink; no line may
    # pair the field with a forbidden HTML sink. Guard lines such as
    # `if (x.customer_no)` are allowed.
    src = _src()
    pat = re.compile(SAFE_SINK + r".*" + re.escape(field) + r"|" + re.escape(field) + r".*" + SAFE_SINK)
    hits = [line for line in src.splitlines() if field in line]
    assert hits, field
    assert any(pat.search(line) for line in hits), (field, hits)
    for line in hits:
        for sink in FORBIDDEN_SINKS:
            assert sink not in line, (field, sink, line)


def test_field_x_name_bound():
    _assert_field_bound_to_safe_sink("x.name")


def test_field_x_item_bound():
    _assert_field_bound_to_safe_sink("x.item")


def test_field_x_text_bound():
    _assert_field_bound_to_safe_sink("x.text")


def test_field_x_address_bound():
    _assert_field_bound_to_safe_sink("x.address")


def test_field_x_id_bound():
    _assert_field_bound_to_safe_sink("x.id")


def test_field_customer_no_bound():
    _assert_field_bound_to_safe_sink("x.customer_no")


def test_field_x_need_bound():
    _assert_field_bound_to_safe_sink("x.need")


def test_field_x_photo_bound():
    # N4: x.photo never on an HTML sink; bound via createElement + src
    src = _src()
    hits = [line for line in src.splitlines() if "x.photo" in line]
    assert hits, "x.photo"
    for line in hits:
        for sink in FORBIDDEN_SINKS:
            assert sink not in line, (sink, line)
    assert "const photos =" in src and "x.photos" in src and "[x.photo]" in src
    assert "photos.forEach(photo =>" in src
    assert re.search(r"img\.src\s*=.*photo", src), src
    assert "createElement('img')" in src or 'createElement("img")' in src
    assert "客人傳的照片" in src
    assert "/photo/" in src


def _lookup_fn(src: str) -> str:
    return src[src.index("async function lookup") : src.index("async function ping")]


def _ping_fn(src: str) -> str:
    start = src.index("async function ping")
    end = src.index("</script>", start)
    return src[start:end]


def _load_fn(src: str) -> str:
    return src[src.index("async function load") : src.index("async function done")]


def test_ping_prefers_input_over_lastcust():
    # H1: without cust, typed input beats lastCust
    ping = _ping_fn(_src())
    m = re.search(r"customer_no\s*=\s*([^;]+)", ping)
    assert m, ping
    expr = m.group(1)
    assert "lastCust" in expr
    assert not re.search(r"cust\s*\|\|\s*lastCust", expr), expr
    q_m = re.search(r"getElementById\(\s*['\"]q['\"]\s*\)", expr)
    if q_m:
        assert q_m.start() < expr.index("lastCust"), expr
    else:
        m2 = re.search(r"cust\s*\|\|\s*([^\s|;]+)\s*\|\|\s*lastCust", expr)
        assert m2, expr
        var = m2.group(1)
        assert re.search(
            rf"{re.escape(var)}\s*=\s*.*getElementById\(\s*['\"]q['\"]\s*\)",
            ping,
        ), ping


def test_notify_buttons_guarded_by_customer_no():
    # H2: card notify buttons exist only inside if (x.customer_no)
    load_fn = _load_fn(_src())
    m = re.search(r"if\s*\(\s*x\.customer_no\s*\)\s*\{", load_fn)
    assert m, load_fn
    depth = 1
    i = m.end()
    while i < len(load_fn) and depth:
        if load_fn[i] == "{":
            depth += 1
        elif load_fn[i] == "}":
            depth -= 1
        i += 1
    block = load_fn[m.start() : i]
    assert "ping('ready'" in block or 'ping("ready"' in block, block
    assert "ping('not_ready'" in block or 'ping("not_ready"' in block, block
    assert "readyBtn" in block, block
    assert "waitBtn" in block, block
    outside = load_fn[: m.start()] + load_fn[i:]
    assert "ping('ready'" not in outside and 'ping("ready"' not in outside, outside
    assert "ping('not_ready'" not in outside and 'ping("not_ready"' not in outside, outside


def test_ping_confirms_before_send():
    # H3: confirm customer_no + mode before /staff/notify
    ping = _ping_fn(_src())
    assert re.search(r"if\s*\(\s*!confirm\(", ping), ping
    assert ping.index("confirm(") < ping.index("/staff/notify"), ping
    assert ping.index("confirm(") < ping.index("fetch("), ping
    assert "客號" in ping
    assert "可以取了" in ping
    assert "還沒好" in ping
    assert re.search(r"if\s*\(\s*!confirm\([^)]*\)\s*\)\s*return", ping), ping


def test_lookup_writes_customer_no_back_to_q():
    # J1: after lookup, rewrite q so ping() sends the resolved customer_no
    lookup = _lookup_fn(_src())
    assert re.search(
        r"getElementById\(\s*['\"]q['\"]\s*\)\.value\s*=\s*j\.customer_no",
        lookup,
    ), lookup


if __name__ == "__main__":
    test_no_innerhtml_x_interpolation()
    test_fields_use_textcontent()
    test_payload_goes_through_textcontent()
    test_no_html_sink_family()
    test_field_x_name_bound()
    test_field_x_item_bound()
    test_field_x_text_bound()
    test_field_x_address_bound()
    test_field_x_id_bound()
    test_field_customer_no_bound()
    test_field_x_need_bound()
    test_field_x_photo_bound()
    test_ping_prefers_input_over_lastcust()
    test_notify_buttons_guarded_by_customer_no()
    test_ping_confirms_before_send()
    test_lookup_writes_customer_no_back_to_q()
    print("PASS", 16)
