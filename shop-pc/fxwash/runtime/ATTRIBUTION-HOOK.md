# Attribution hook for webhook_server.py (minimal patch)

Scope: record privacy-safe `message_observed` / `binding_observed` rows to
`<shop.root>/data/inquiries.jsonl`. Replies and routing are unchanged, except that a
registered source code is removed from the text handed to the existing router.

## 0. Config (shop.json)

```json
"attribution": {"enabled": true, "secret_path": "secrets/attribution_hmac.key", "registry_path": "data/attribution/source-codes.json"}
```

Relative paths are resolved against `shop.root`. Optional keys (defaults in brackets):
`shop_id` [fxwash], `oa_scope` [fxwash-line-oa], `runtime_id` [shop-pc], `pos_source_id` [null],
`lock_timeout_seconds` [2.0, capped at 2.0]. Day and night runtimes serving the same OA must use
the same `shop_id`/`oa_scope`/key and a different `runtime_id`.

Disabling is safe at every level, and in all of these cases routing is byte-for-byte as today:
- no `attribution` key, or `"enabled"` is not `true` -> one `[ATTRIBUTION_DISABLED] not configured` line;
- secret file missing/too short -> one `[ATTRIBUTION_DISABLED] no hmac secret` (or `invalid hmac secret`) line;
- `attribution_service.py` missing or failing to import -> the import guard below sets everything to None.

Create the key once: `python tools\make_attribution_secret.py secrets\attribution_hmac.key`
(from the shop root). Add `secrets/` and `data/inquiries.jsonl*` to .gitignore.

## 1. Import (top of webhook_server.py, next to the other runtime imports)

```python
try:
    from attribution_service import extract_source, init_attribution
except Exception:  # attribution is optional; never block the webhook
    extract_source = None
    init_attribution = None
```

## 2. Construct once in make_request_handler (right after `data_dir = shop.root / "data"`)

```python
    attr_ledger, attr_registry = None, None
    if init_attribution is not None:
        try:
            _shop_cfg = json.loads((ROOT / "shop.json").read_text(encoding="utf-8"))
        except Exception:
            _shop_cfg = {}
        _attr_cfg = _shop_cfg.get("attribution") if isinstance(_shop_cfg, dict) else None
        attr_ledger, attr_registry = init_attribution(shop.root, _attr_cfg)  # never raises
```

`attr_ledger` is None unless attribution is fully enabled. One ledger is shared by all handler
threads (it is thread-safe and holds its own file lock).

## 3. do_POST: parse + record BEFORE the 200 (replace the block from "# Respond 200 OK immediately" through the json.loads try/except)

Before:

```python
            # Respond 200 OK immediately and flush buffer so LINE never times out
            self.send_response(200)
            ...
            self.wfile.flush()

            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                return
```

After:

```python
            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                data = None

            # Attribution: small local fsync'd append, bounded (<= 2 s lock wait), no network.
            attr_text = {}
            if attr_ledger is not None and isinstance(data, dict):
                for ev in data.get("events") or []:
                    try:
                        src_res = None
                        m = ev.get("message") if isinstance(ev, dict) else None
                        if isinstance(m, dict) and m.get("type") == "text" and isinstance(m.get("text"), str):
                            src_res = extract_source(m["text"], attr_registry)
                            if src_res.source_status == "ok" and src_res.stripped_text:
                                attr_text[id(ev)] = src_res.stripped_text
                        attr_ledger.record_message(ev, src_res, attr_registry.registry_version)
                    except Exception as exc:
                        print("[ATTRIBUTION_ERROR] " + type(exc).__name__, file=sys.stderr)

            # Respond 200 OK immediately and flush buffer so LINE never times out
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"OK")
            self.wfile.flush()

            if data is None:
                return
```

The ledger itself skips group/room, follow/unfollow, postback, sticker, missing userId and the
LINE verification dummy tokens; no filtering is needed here. A 200 still does not mean the event
was saved: failures are only in `attr_ledger.coverage_gaps` and stderr.

## 4. Pass the stripped text to the existing router (text branch)

Directly after the existing line `user_text = msg.get("text", "").strip()` add:

```python
                if id(event) in attr_text:
                    user_text = attr_text[id(event)]
```

Only `source_status == "ok"` with non-empty remaining text is substituted. A message that is only
the code (e.g. `SXJ-261030-S1`) keeps its raw text so the router sees exactly what it sees today.

## 5. Next to both save_binding(...) calls

Phone lookup branch:

```python
                    if cid_found and user_id:
                        save_binding(data_dir, user_id, cid_found, phone_found, cname_found)
                        if attr_ledger is not None:
                            attr_ledger.record_binding_observed(user_id, cid_found, "phone_lookup")
```

Customer-ID lookup branch:

```python
                    if cid_found and user_id:
                        save_binding(data_dir, user_id, cid_found, phone_found, cname_found)
                        if attr_ledger is not None:
                            attr_ledger.record_binding_observed(user_id, cid_found, "cid_lookup")
```

Composite ids such as `12/34` are logged as `identity_status = identity_ambiguous` with
`cid_key = null`; `save_binding` behaviour is unchanged. `record_*` never raises.

## Not changed

replyToken dedupe, postback/image/text routing, replies, bindings file, logging. Note: the
existing `[Webhook Text]` print still logs raw text to the console; that is outside this patch.
