"""Current night readiness for day-audit; no credentials, values or URLs in output."""
from __future__ import annotations

import http.client
import importlib.util
import json
from pathlib import Path


def read_readyz():
    # http.client does not follow redirects or consult proxy environment variables.
    connection = http.client.HTTPConnection("127.0.0.1", 8791, timeout=3)
    try:
        connection.request("GET", "/readyz")
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("status")
        payload = response.read(8193)
        if len(payload) > 8192:
            raise ValueError("size")
        return json.loads(payload)
    finally:
        connection.close()


def audit_readiness(hours, *, now=None, fetch=None):
    try:
        night = hours.is_night_window(now)
    except Exception:
        return {"status": "fail", "reason": "night_window_unavailable"}
    if not night:
        return {"status": "not_applicable", "reason": "shop_day_window"}
    try:
        row = (fetch or read_readyz)()
        if (not isinstance(row, dict) or type(row.get("pid")) is not int or row["pid"] <= 0
                or type(row.get("vision_configured")) is not bool
                or type(row.get("ai_chat")) is not bool
                or not isinstance(row.get("missing"), list)):
            raise ValueError("schema")
        reasons = []
        if not row["vision_configured"]:
            reasons.append("vision_configured=False: GEMINI_API_KEY LAUNDRY_PHOTO_ESTIMATE")
        if not row["ai_chat"]:
            reasons.append("ai_chat=False: LAUNDRY_AI_CHAT GEMINI_API_KEY")
        if row["missing"]:
            reasons.append("missing_configuration")
        return {"status": "fail" if reasons else "pass",
                "reason": "; ".join(reasons) if reasons else "ready"}
    except Exception:
        # Never persist a response body or exception text from the listener.
        return {"status": "fail", "reason": "readyz_unavailable_or_invalid"}


def main():
    try:
        path = Path(__file__).resolve().parents[1] / "line-bot" / "tunnel_manager.py"
        spec = importlib.util.spec_from_file_location("readiness_hours", path)
        hours = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hours)
        result = audit_readiness(hours)
    except Exception:
        result = {"status": "fail", "reason": "night_window_unavailable"}
    print(json.dumps(result, ensure_ascii=True))
    return 1 if result["status"] == "fail" else 0


if __name__ == "__main__":
    raise SystemExit(main())
