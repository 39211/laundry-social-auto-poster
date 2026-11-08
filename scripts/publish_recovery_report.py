"""Read only redacted per-pair recovery receipts for the operator reports."""
import json
import re


def recovery_summary(gates, days):
    manual, pending, unverified = [], 0, False
    for day in days:
        iso = day.isoformat()
        for path in sorted(gates.glob("publish-recovery-{0}-slot*-*.json".format(iso))):
            match = re.fullmatch(r"publish-recovery-(\d{4}-\d{2}-\d{2})-slot([1-3])-(facebook|instagram)\.json", path.name)
            try:
                if not match or path.stat().st_size > 16384:
                    raise ValueError("invalid receipt")
                obj = json.loads(path.read_text(encoding="utf-8-sig"))
                if (obj.get("date") != iso or obj.get("slot") != int(match[2]) or obj.get("platform") != match[3]
                        or obj.get("status") not in ("needs_manual", "retry_pending", "retry_claimed", "resolved")):
                    raise ValueError("invalid receipt")
                if obj["status"] != "resolved":
                    label = "{0} slot{1} {2}".format(iso[5:], obj["slot"], "FB" if obj["platform"] == "facebook" else "IG")
                    manual.append(label)
                    if obj.get("notification") not in ("delivered", "suppressed"):
                        pending += 1
            except (OSError, ValueError, TypeError, AttributeError):
                unverified = True
    parts = []
    if manual:
        parts.append("需要人處理 {0} 筆（{1}{2}）".format(len(manual), "、".join(manual[:6]), "等" if len(manual) > 6 else ""))
    if pending:
        parts.append("通知送達未驗 {0} 筆".format(pending))
    if unverified:
        parts.append("補發紀錄未驗")
    return {"manual": manual, "pending": pending, "unverified": unverified, "text": "；".join(parts)}
