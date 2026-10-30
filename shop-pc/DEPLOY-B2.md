# DEPLOY B2 - attribution ledger in the LINE webhook (default OFF)

1. Back up `fxwash\runtime\webhook_server.py` (prod SHA 161A4DD3...) as `webhook_server.py.bak-A4-2`.
2. Copy into `fxwash\runtime\`: `webhook_server.py`, `attribution_service.py`, `test_webhook_attribution.py` (plus `attribution_export.py`, and `fxwash\tools\make_attribution_secret.py`, if missing).
3. Test offline from `fxwash\`: `python -I -S -B -m unittest discover -s runtime -p "test_webhook*.py"` -> all OK.
4. Restart the webhook (stop the python process; the watchdog starts it again). The log shows exactly one `[ATTRIBUTION_DISABLED] not configured` line; replies are unchanged. Still OFF.
5. Create the key once, from `fxwash\`: `python tools\make_attribution_secret.py secrets\attribution_hmac.key`. Never email, copy or commit it; keep an offline backup (a lost key = new user_keys).
6. Add `secrets/` and `data/inquiries.jsonl*` to `.gitignore`. Check that `data\attribution\source-codes.json` exists (else every code is `unknown_unregistered_code` and nothing is stripped).
7. Turn ON: add this top-level key to `fxwash\shop.json` (keep the JSON valid; a missing comma breaks the whole file):
   `"attribution": {"enabled": true, "secret_path": "secrets/attribution_hmac.key", "registry_path": "data/attribution/source-codes.json"}`
   A second (night) runtime on the same OA must use the same key and a different `"runtime_id"`.
8. shop.json is read only once, at startup (`make_request_handler`): restart via the watchdog. No `[ATTRIBUTION_DISABLED]` line = ON.
9. Verify: from the owner's own phone, send a registered code plus words, e.g. `SXJ-261030-S1 test`. The reply is as usual for `test`.
10. `data\inquiries.jsonl` gains exactly one new `message_observed` row with `"source_status":"ok"`; no name, phone, userId or text in it.
11. Dry run of the weekly export: `python runtime\attribution_export.py --root . --week <W> --dry-run` (W = ISO week, e.g. 2026-W44).
12. Watch the log for `[ATTRIBUTION_ERROR] <Type>` lines; they never change replies, but mean rows were missed.
13. Turn OFF: remove the `attribution` key (or set `"enabled": false`), then restart via the watchdog - a restart IS needed.
14. Deleting only the key file also needs a restart; the running process keeps the key in memory.
15. Rollback: restore `webhook_server.py.bak-A4-2` as `webhook_server.py` and restart; `inquiries.jsonl` can stay.
16. Never edit `inquiries.jsonl` by hand while the webhook runs (single-writer file with `.lock`).