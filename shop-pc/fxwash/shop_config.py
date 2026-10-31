"""Portable, fail-closed configuration loader for a laundry LINE product.

This module deliberately contains no network calls and no credentials.  A
store instance supplies its own ``shop.json`` and keeps secrets outside the
package.  The same schema is used by the installer, health check, connector,
and handover command so a successful preparation cannot be mistaken for a
live deployment.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from product_catalog import validate_product


class ConfigError(ValueError):
    """Raised when a shop configuration is unsafe or incomplete."""


TOP_LEVEL = {
    "schema_version",
    "shop_id",
    "mode",
    "business",
    "hours",
    "pickup",
    "paths",
    "server",
    "lookup",
    "vision",
    "payment",
    "privacy",
    "acceptance",
    "product",
    # B2 attribution ledger (optional; validated by runtime/attribution_service.py,
    # which disables itself on any bad value instead of stopping the webhook).
    "attribution",
}
OPTIONAL_TOP_LEVEL = {"product", "attribution"}
REQUIRED_TOP_LEVEL = TOP_LEVEL - OPTIONAL_TOP_LEVEL
SHOP_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
PHONE_RE = re.compile(r"^[0-9+()\- ]{8,24}$")
MODES = {"demo", "live"}
LOOKUP_MODES = {"manual", "fixture", "verified_sqlite", "ehank_readonly"}
PAYMENT_MODES = {"disabled", "merchant_qr", "line_pay_online"}

MERCHANT_QR_PREFIX = "https://qrcodepay.line.me/"


def is_merchant_qr_url(url: Any) -> bool:
    """Return True if url is a LINE Pay merchant QR with a non-empty path segment.

    Bare ``https://qrcodepay.line.me/`` or trailing-slash-only paths fail.
    """
    if not isinstance(url, str):
        return False
    value = url.strip()
    if not value.startswith(MERCHANT_QR_PREFIX):
        return False
    remainder = value[len(MERCHANT_QR_PREFIX) :]
    path_part = remainder.split("?", 1)[0].split("#", 1)[0]
    segments = [part for part in path_part.split("/") if part]
    return bool(segments)

WEEKDAYS = {str(i) for i in range(7)}
PATH_KEYS = ("prices", "menu_image", "data_dir", "log_dir", "backup_dir")
ACCEPTANCE_KEYS = (
    "owner_confirmed",
    "real_phone_tested",
    "photo_tested",
    "location_tested",
    "staff_group_tested",
    "query_authorization_tested",
    "payment_tested",
    "backup_restore_tested",
    "outage_recovery_tested",
)


def _duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    duplicate: set[str] = set()
    for key, value in pairs:
        if key in out:
            duplicate.add(key)
        out[key] = value
    if duplicate:
        raise ConfigError("JSON 重複欄位：" + ", ".join(sorted(duplicate)))
    return out


def _read_json(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8-sig")
        value = json.loads(raw, object_pairs_hook=_duplicates)
    except FileNotFoundError as exc:
        raise ConfigError(f"找不到設定檔：{path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"設定檔不是有效 JSON：{path}（{exc.msg}）") from exc
    if not isinstance(value, dict):
        raise ConfigError("設定檔最外層必須是物件")
    return value


def _text(value: Any, label: str, *, required: bool = True) -> str:
    if not isinstance(value, str) or (required and not value.strip()):
        raise ConfigError(f"{label} 必須是非空文字")
    return value.strip()


def _bool(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise ConfigError(f"{label} 必須是 true 或 false")
    return value


def _port(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1024 <= value <= 65535:
        raise ConfigError(f"{label} 必須是 1024 到 65535 的整數")
    return value


def _relative_path(value: Any, label: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ConfigError(f"{label} 必須是文字路徑")
    value = value.strip()
    if not value and allow_empty:
        return ""
    if not value:
        raise ConfigError(f"{label} 不可留白")
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ConfigError(f"{label} 必須是門市資料夾內的相對路徑")
    return value


class ShopConfig:
    """A validated shop configuration bound to the directory containing it."""

    def __init__(self, path: Path, data: dict[str, Any]):
        self.path = path.resolve()
        self.root = self.path.parent
        self.data = data

    @classmethod
    def load(cls, path: str | Path) -> "ShopConfig":
        config_path = Path(path).expanduser().resolve()
        return cls(config_path, _read_json(config_path))

    @property
    def shop_id(self) -> str:
        return str(self.data.get("shop_id", ""))

    @property
    def mode(self) -> str:
        return str(self.data.get("mode", ""))

    @property
    def lookup(self) -> dict[str, Any]:
        value = self.data.get("lookup", {})
        return value if isinstance(value, dict) else {}

    @property
    def acceptance(self) -> dict[str, Any]:
        value = self.data.get("acceptance", {})
        return value if isinstance(value, dict) else {}

    @property
    def product(self) -> dict[str, Any] | None:
        value = self.data.get("product")
        return value if isinstance(value, dict) else None

    def local_path(self, relative: str, *, must_exist: bool = False) -> Path:
        """Resolve a package-relative path and prevent escaping the instance."""
        candidate = (self.root / relative).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ConfigError(f"路徑離開門市資料夾：{relative}") from exc
        if must_exist and not candidate.exists():
            raise ConfigError(f"找不到門市檔案：{relative}")
        return candidate

    def connector_root(self) -> Path | None:
        lookup = self.lookup
        raw_path = lookup.get("root_path", "")
        if raw_path:
            path = Path(str(raw_path)).expanduser()
            return path.resolve()
        env_name = str(lookup.get("root_env", "")).strip()
        if env_name:
            value = os.environ.get(env_name, "").strip()
            if value:
                return Path(value).expanduser().resolve()
        return None

    def validate(self) -> list[str]:
        """Return all validation errors; do not touch external systems."""
        errors: list[str] = []

        missing = REQUIRED_TOP_LEVEL - set(self.data)
        if missing:
            errors.append("缺少頂層欄位：" + ", ".join(sorted(missing)))
        unknown = set(self.data) - TOP_LEVEL
        if unknown:
            errors.append("不支援的頂層欄位：" + ", ".join(sorted(unknown)))

        def check(label: str, fn) -> None:
            try:
                fn()
            except (ConfigError, TypeError, KeyError) as exc:
                errors.append(str(exc))

        check("schema_version", lambda: self._validate_schema())
        check("shop_id", lambda: self._validate_identity())
        check("business", lambda: self._validate_business())
        check("hours", lambda: self._validate_hours())
        check("pickup", lambda: self._validate_pickup())
        check("paths", lambda: self._validate_paths())
        check("server", lambda: self._validate_server())
        check("lookup", lambda: self._validate_lookup())
        check("vision", lambda: self._validate_vision())
        check("payment", lambda: self._validate_payment())
        check("privacy", lambda: self._validate_privacy())
        check("acceptance", lambda: self._validate_acceptance())
        check("product", lambda: self._validate_product())
        return errors

    def require_valid(self) -> None:
        errors = self.validate()
        if errors:
            raise ConfigError("；".join(errors))

    def _validate_schema(self) -> None:
        if self.data.get("schema_version") != 1:
            raise ConfigError("schema_version 必須是 1")
        if self.data.get("mode") not in MODES:
            raise ConfigError("mode 必須是 demo 或 live")

    def _validate_identity(self) -> None:
        shop_id = _text(self.data.get("shop_id"), "shop_id")
        if not SHOP_ID_RE.fullmatch(shop_id):
            raise ConfigError("shop_id 必須是 3 到 64 字元的小寫英數與連字號")

    def _validate_business(self) -> None:
        business = self.data.get("business")
        if not isinstance(business, dict):
            raise ConfigError("business 必須是物件")
        for key in ("name", "address", "phone", "map_url", "tagline", "turnaround_note"):
            _text(business.get(key), f"business.{key}")
        if not PHONE_RE.fullmatch(business["phone"].strip()):
            raise ConfigError("business.phone 格式不正確")
        if not business["map_url"].startswith(("https://", "http://")):
            raise ConfigError("business.map_url 必須是 http(s) 網址")

    def _validate_hours(self) -> None:
        hours = self.data.get("hours")
        if not isinstance(hours, dict) or set(hours) != WEEKDAYS:
            raise ConfigError("hours 必須包含 0 到 6 的完整星期設定")
        for day, windows in hours.items():
            if not isinstance(windows, list):
                raise ConfigError(f"hours.{day} 必須是時段陣列")
            for window in windows:
                if not isinstance(window, list) or len(window) != 2:
                    raise ConfigError(f"hours.{day} 每個時段必須是 [開始, 結束]")
                for value in window:
                    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
                        raise ConfigError(f"hours.{day} 含有錯誤時間：{value}")

    def _validate_pickup(self) -> None:
        pickup = self.data.get("pickup")
        if not isinstance(pickup, dict):
            raise ConfigError("pickup 必須是物件")
        _text(pickup.get("description"), "pickup.description")
        slots = pickup.get("slots")
        if not isinstance(slots, dict):
            raise ConfigError("pickup.slots 必須是物件")
        for key, value in slots.items():
            _text(key, "pickup.slots 的日期")
            if not isinstance(value, list):
                raise ConfigError(f"pickup.slots.{key} 必須是陣列")

    def _validate_paths(self) -> None:
        paths = self.data.get("paths")
        if not isinstance(paths, dict):
            raise ConfigError("paths 必須是物件")
        for key in PATH_KEYS:
            _relative_path(paths.get(key), f"paths.{key}")

    def _validate_server(self) -> None:
        server = self.data.get("server")
        if not isinstance(server, dict):
            raise ConfigError("server 必須是物件")
        webhook = _port(server.get("webhook_port"), "server.webhook_port")
        staff = _port(server.get("staff_port"), "server.staff_port")
        if webhook == staff:
            raise ConfigError("server.webhook_port 與 staff_port 不可相同")
        base = server.get("public_base", "")
        if not isinstance(base, str):
            raise ConfigError("server.public_base 必須是文字")
        if self.mode == "live" and not base.startswith("https://"):
            raise ConfigError("live 模式的 server.public_base 必須是 HTTPS")
        webhook_path = server.get("webhook_path", "/line/webhook")
        if not isinstance(webhook_path, str) or not webhook_path.startswith("/"):
            raise ConfigError("server.webhook_path 必須是 / 開頭的路徑")
        webhook_url = server.get("webhook_url", "")
        if not isinstance(webhook_url, str):
            raise ConfigError("server.webhook_url 必須是文字")
        if webhook_url and not webhook_url.startswith("https://"):
            raise ConfigError("server.webhook_url 必須是 HTTPS")

    def _validate_lookup(self) -> None:
        lookup = self.data.get("lookup")
        if not isinstance(lookup, dict):
            raise ConfigError("lookup 必須是物件")
        mode = lookup.get("mode")
        if mode not in LOOKUP_MODES:
            raise ConfigError("lookup.mode 必須是 manual、fixture、verified_sqlite 或 ehank_readonly")
        if not isinstance(lookup.get("max_age_seconds"), int) or lookup["max_age_seconds"] <= 0:
            raise ConfigError("lookup.max_age_seconds 必須是正整數")
        if mode == "ehank_readonly":
            if lookup.get("connector") != "ehank_mdb":
                raise ConfigError("ehank_readonly 必須使用 ehank_mdb connector")
            root_path = str(lookup.get("root_path", "")).strip()
            root_env = str(lookup.get("root_env", "")).strip()
            if not root_path and not root_env:
                raise ConfigError("ehank_readonly 必須指定 root_path 或 root_env")
            if root_path and not Path(root_path).is_absolute():
                raise ConfigError("lookup.root_path 必須是本機絕對路徑")
        if mode == "verified_sqlite":
            database = lookup.get("database_path")
            if not isinstance(database, str) or not database.strip():
                raise ConfigError("verified_sqlite 必須指定 database_path")
            if not Path(database).is_absolute():
                _relative_path(database, "lookup.database_path")
        if mode == "fixture":
            snapshot = lookup.get("snapshot_path", "data/snapshot.json")
            _relative_path(snapshot, "lookup.snapshot_path")

    def _validate_vision(self) -> None:
        vision = self.data.get("vision")
        if not isinstance(vision, dict):
            raise ConfigError("vision 必須是物件")
        enabled = _bool(vision.get("enabled"), "vision.enabled")
        if enabled:
            _text(vision.get("provider"), "vision.provider")
            _text(vision.get("terms_version"), "vision.terms_version")
            if vision.get("consent_required") is not True:
                raise ConfigError("啟用 vision 時 vision.consent_required 必須是 true")

    def _validate_payment(self) -> None:
        payment = self.data.get("payment")
        if not isinstance(payment, dict):
            raise ConfigError("payment 必須是物件")
        mode = payment.get("mode")
        if mode not in PAYMENT_MODES:
            raise ConfigError("payment.mode 不受支援")
        if mode == "merchant_qr":
            url = _text(payment.get("url"), "payment.url")
            if not is_merchant_qr_url(url):
                raise ConfigError(
                    "merchant_qr 的 payment.url 必須是 LINE Pay QR 網址，"
                    "且 https://qrcodepay.line.me/ 之後至少要有一段路徑"
                )
        if mode == "line_pay_online":
            environment = payment.get("environment", "sandbox")
            if environment not in {"sandbox", "production"}:
                raise ConfigError("line_pay_online 的 payment.environment 必須是 sandbox 或 production")
            currency = payment.get("currency", "TWD")
            if currency != "TWD":
                raise ConfigError("目前商品包的 LINE Pay 付款幣別固定為 TWD")
            prefix = payment.get("order_prefix", "")
            if not isinstance(prefix, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,20}", prefix):
                raise ConfigError("line_pay_online 的 payment.order_prefix 必須是 1 到 20 字元英數、底線或連字號")

    def _validate_privacy(self) -> None:
        privacy = self.data.get("privacy")
        if not isinstance(privacy, dict):
            raise ConfigError("privacy 必須是物件")
        _text(privacy.get("notice_version"), "privacy.notice_version")
        days = privacy.get("photo_retention_days")
        if not isinstance(days, int) or not 0 <= days <= 365:
            raise ConfigError("privacy.photo_retention_days 必須是 0 到 365 的整數")

    def _validate_acceptance(self) -> None:
        acceptance = self.data.get("acceptance")
        if not isinstance(acceptance, dict):
            raise ConfigError("acceptance 必須是物件")
        for key in ACCEPTANCE_KEYS:
            _bool(acceptance.get(key), f"acceptance.{key}")

    def _validate_product(self) -> None:
        if "product" not in self.data:
            return
        errors = validate_product(
            self.data.get("product"),
            payment_mode=self.data.get("payment", {}).get("mode")
            if isinstance(self.data.get("payment"), dict)
            else None,
        )
        if errors:
            raise ConfigError("；".join(errors))


def load_shop(path: str | Path) -> ShopConfig:
    shop = ShopConfig.load(path)
    shop.require_valid()
    return shop
