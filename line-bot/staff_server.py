# -*- coding: utf-8 -*-
"""櫃台獨立伺服器：只綁 127.0.0.1:8792，不經隧道對外。"""
import os
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file

import staff_notify

# R2
ALLOWED_HOSTS = {"127.0.0.1:8792", "localhost:8792"}
STAFF_HTML = Path(__file__).resolve().parent / "staff.html"
PHOTOS_ROOT = (
    Path(os.environ["LAUNDRY_REPO_ROOT"]) / "data" / "photos"
    if os.environ.get("LAUNDRY_REPO_ROOT")
    else Path(r"C:/Users/cyc39/laundry-repo/data/photos")
)
_PHOTO_EXT = {".jpg", ".jpeg", ".png"}

app = Flask(__name__, static_folder=None)


@app.before_request
def _host_guard():
    # R2: tunnel traffic carries the public hostname in Host
    if request.host not in ALLOWED_HOSTS:
        abort(403)


@app.get("/")
@app.get("/staff")
def staff_page():
    return send_file(STAFF_HTML)


@app.get("/staff/api")
def staff_api():
    return jsonify(staff_notify.list_inbox())


@app.post("/staff/done")
def staff_done():
    bid = (request.get_json(silent=True) or {}).get("id") or ""
    staff_notify.set_status(bid, "done")
    return jsonify({"ok": True})


@app.post("/staff/claim")
def staff_claim():
    body = request.get_json(silent=True) or {}
    identifier = body.get("id") or body.get("case_id") or ""
    actor = body.get("actor") or "staff"
    return jsonify({"ok": staff_notify.claim_handoff(identifier, actor=actor)})


@app.post("/staff/release")
def staff_release():
    body = request.get_json(silent=True) or {}
    identifier = body.get("id") or body.get("case_id") or ""
    actor = body.get("actor") or "staff"
    return jsonify({"ok": staff_notify.release_handoff(identifier, actor=actor)})


@app.post("/staff/lookup")
def staff_lookup():
    import laundry_lookup

    q = (request.get_json(silent=True) or {}).get("q") or ""
    row = laundry_lookup.lookup(q)
    return jsonify(
        {
            "found": row.found,
            "ambiguous": row.ambiguous,
            "customer_no": row.customer_no,
            "name": row.name,
            "flag": laundry_lookup.guest_ready_flag(row),
            "text": laundry_lookup.guest_copy(row),
            "uid": laundry_lookup.uid_for_customer(row.customer_no) if row.found else "",
            "source": row.source,
        }
    )


@app.get("/photo/<path:rel>")
def staff_photo(rel: str):
    # N4: only files inside PHOTOS_ROOT; jpg/jpeg/png; Host guard is before_request
    cleaned = (rel or "").replace("\\", "/").lstrip("/")
    if cleaned.startswith("photos/"):
        cleaned = cleaned[len("photos/") :]
    root = PHOTOS_ROOT.resolve()
    try:
        candidate = (PHOTOS_ROOT / cleaned).resolve()
    except (OSError, RuntimeError, ValueError):
        abort(404)
    try:
        candidate.relative_to(root)
    except ValueError:
        abort(404)
    if not candidate.is_file():
        abort(404)
    ext = candidate.suffix.lower()
    if ext not in _PHOTO_EXT:
        abort(404)
    mime = "image/png" if ext == ".png" else "image/jpeg"
    return send_file(candidate, mimetype=mime)


@app.post("/staff/notify")
def staff_notify_guest():
    body = request.get_json(silent=True) or {}
    result = staff_notify.notify_guest(
        uid=body.get("uid") or "",
        customer_no=body.get("customer_no") or body.get("q") or "",
        mode=body.get("mode") or "auto",
    )
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8792)
