"""Scheduled night takeover. Stdlib only; --dry-run is entirely offline."""
from __future__ import annotations

import argparse
import json
import time

import tunnel_manager as tm


def main(argv=None, *, sleep=time.sleep) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--dry-run", action="store_true", help="print intent without credentials or HTTP")
    modes.add_argument("--status", action="store_true", help="GET the registered endpoint; never PUT")
    args = parser.parse_args(argv)
    result = {}
    try:
        base = tm.validate_tunnel_base(tm.PUBLIC_BASE.read_text(encoding="utf-8-sig"))
        endpoint = base + "/line/webhook"
        result["ai_endpoint"] = endpoint
        if args.dry_run:
            tm.load_handover_config()
            result.update(status="dry_run", window=tm.registration_window(), line_endpoint=None,
                          action="GET current endpoint, then PUT and verify only in the night window")
            print(json.dumps(result))
            return 0
        if not args.status and not tm._registration_allowed(base):
            window = tm.registration_window()
            result["status"] = "day_window" if window == "day" else "configuration_error"
            print(json.dumps(result))
            return 0 if window == "day" else 1

        token = tm._load_token()
        if not token:
            raise ValueError("LINE channel token is missing")
        info = tm.get_webhook_info(token)
        current = info["endpoint"]
        result.update(
            line_endpoint=current,
            active=info["active"],
            registered_owner=(
                "ai" if current == endpoint else "shop_or_other" if current else "unknown"
            ),
        )
        if args.status:
            result.update(status="status", reachability="unmeasured")
            print(json.dumps(result))
            return 0
        if current == endpoint:
            tm._event("handover_noop", current, endpoint, verify_status="match")
            result["status"] = "already_ai"
            print(json.dumps(result))
            return 0

        attempt = {}
        updated = tm._set_webhook_with_retries(
            base, token, sleep=sleep, old_url=current, result=attempt,
        )
        window = tm.registration_window()
        if updated:
            result.update(attempt, registered_owner="ai")
        elif window == "day":
            result["status"] = "day_window"
        elif window == "configuration_error":
            result["status"] = "configuration_error"
        else:
            result.update(attempt)
            result["registered_owner"] = (
                "shop_or_other" if result.get("line_endpoint") else "unknown"
            )
        print(json.dumps(result))
        return 0 if updated or result["status"] == "day_window" else 1
    except (OSError, ValueError, RuntimeError) as exc:
        # Exception text may contain request details. Expose its type only.
        result.update(status="error", error=type(exc).__name__)
        if not args.status and not args.dry_run:
            tm._event("handover_error", new_url=result.get("ai_endpoint", ""),
                      verify_status=type(exc).__name__)
        print(json.dumps(result))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
