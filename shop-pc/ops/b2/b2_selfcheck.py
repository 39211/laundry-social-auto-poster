"""Positive ON evidence without recording anything, run from the shop root.
1) shop_config.load_shop(shop.json) must pass: webhook, tunnel_supervisor and inbound_monitor all
   call it at startup (10/31 14:04 lesson: an unknown top-level key stopped the webhook).
2) init_attribution with shop.json["attribution"] must build an enabled ledger, exactly as the
   webhook does at startup. Prints no key, uid or text."""
import json, sys
from pathlib import Path
root = Path('.').resolve()
sys.path.insert(0, str(root / 'runtime'))
sys.path.insert(0, str(root))
try:
    import shop_config
    shop_config.load_shop(root / 'shop.json')
    print('load_shop=ok')
except Exception as exc:  # ConfigError text is Chinese; print it escaped for any console
    print('load_shop=FAIL %s %s' % (type(exc).__name__, str(exc).encode('unicode_escape').decode('ascii')))
    sys.exit(1)
import attribution_service as a
cfg = json.loads((root / 'shop.json').read_bytes().decode('utf-8-sig')).get('attribution')
ledger, registry = a.init_attribution(root, cfg)
enabled = bool(ledger is not None and getattr(ledger, 'enabled', False))
print('ledger_enabled=%s registry_status=%s registry_version=%s entries=%d' % (
    enabled, getattr(registry, 'load_status', '?'), getattr(registry, 'registry_version', '?'),
    len(getattr(registry, 'entries', {}) or {})))
sys.exit(0 if enabled else 1)
