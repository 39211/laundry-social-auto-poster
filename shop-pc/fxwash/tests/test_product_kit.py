from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
HAS_POWERSHELL = bool(shutil.which("powershell.exe") or shutil.which("pwsh"))

from connectors.base import connector_from_shop
from runtime.lookup_service import lookup_by_phone
from runtime import line_api, line_pay
from shop_config import ConfigError, ShopConfig, is_merchant_qr_url
import patch_shop_json
from pack_product_kit import forbidden_secret_members, forbidden_pycache_members, build_zip


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class EmptyResponse(FakeResponse):
    def read(self):
        return b""


class ProductKitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.work = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_shop(self, data: dict) -> Path:
        path = self.work / "shop.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def base_shop(self) -> dict:
        return json.loads((ROOT / "config" / "shop.template.json").read_text(encoding="utf-8"))

    def test_template_validates_without_external_access(self) -> None:
        shop = ShopConfig.load(ROOT / "config" / "shop.template.json")
        self.assertEqual([], shop.validate())

    def test_paths_cannot_escape_instance(self) -> None:
        data = self.base_shop()
        data["paths"]["prices"] = "../outside.json"
        errors = ShopConfig.load(self.write_shop(data)).validate()
        self.assertTrue(any("相對路徑" in error for error in errors))

    def test_fixture_connector_and_full_phone_lookup(self) -> None:
        data = self.base_shop()
        data["lookup"] = {
            "mode": "fixture",
            "connector": "fixture",
            "root_path": "",
            "root_env": "",
            "snapshot_path": "data/snapshot.json",
            "database_path": "",
            "max_age_seconds": 300,
        }
        (self.work / "data").mkdir()
        shutil.copy(ROOT / "config" / "snapshot.fixture.json", self.work / "data" / "snapshot.json")
        shop = ShopConfig.load(self.write_shop(data))
        self.assertEqual([], shop.validate())
        result = lookup_by_phone(connector_from_shop(shop), "0900-000-000")
        self.assertEqual("found_not_ready", result["status"])
        self.assertEqual(2, len(result["pieces"]))
        invalid = lookup_by_phone(connector_from_shop(shop), "090000")
        self.assertEqual("invalid_input", invalid["status"])

    def test_sqlite_connector_uses_read_only_connection(self) -> None:
        db = self.work / "shop.sqlite3"
        con = sqlite3.connect(db)
        con.executescript(
            "CREATE TABLE customers(customer_id TEXT, name TEXT, phone TEXT);"
            "CREATE TABLE pieces(piece_id TEXT, customer_id TEXT, order_no TEXT, item TEXT, "
            "status TEXT, price INTEGER, received_at TEXT, ready_at TEXT);"
        )
        con.execute("INSERT INTO customers VALUES ('c1','測試客','0912345678')")
        con.execute("INSERT INTO pieces VALUES ('p1','c1','A1','襯衫','ready',70,'2026-09-20','2026-09-21')")
        con.commit()
        con.close()
        data = self.base_shop()
        data["lookup"] = {
            "mode": "verified_sqlite",
            "connector": "sqlite",
            "root_path": "",
            "root_env": "",
            "snapshot_path": "",
            "database_path": str(db),
            "max_age_seconds": 300,
        }
        shop = ShopConfig.load(self.write_shop(data))
        self.assertEqual([], shop.validate())
        result = lookup_by_phone(connector_from_shop(shop), "0912345678")
        self.assertEqual("found_ready", result["status"])
        con = sqlite3.connect(db)
        self.assertEqual(1, con.execute("SELECT COUNT(*) FROM customers").fetchone()[0])
        con.close()

    def test_ehank_requires_machine_connector_location(self) -> None:
        data = self.base_shop()
        data["lookup"] = {
            "mode": "ehank_readonly",
            "connector": "ehank_mdb",
            "root_path": "",
            "root_env": "",
            "snapshot_path": "",
            "database_path": "",
            "max_age_seconds": 300,
        }
        errors = ShopConfig.load(self.write_shop(data)).validate()
        self.assertTrue(any("root_path 或 root_env" in error for error in errors))

    def test_handover_is_blocked_for_demo_instance(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "laundry.py"), "handover", "--shop", str(ROOT / "config" / "shop.template.json")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        self.assertEqual(2, result.returncode)
        self.assertIn('"status": "blocked"', result.stdout or "")

    def test_line_bot_info_uses_bearer_token_without_printing_it(self) -> None:
        data = self.base_shop()
        (self.work / "secrets").mkdir()
        (self.work / "secrets" / "line-channel.json").write_text(
            json.dumps({"channel_access_token": "token-for-test", "channel_secret": "secret-for-test"}),
            encoding="utf-8",
        )
        shop = ShopConfig.load(self.write_shop(data))
        seen = {}

        def opener(request, timeout=0):
            seen["method"] = request.method
            seen["url"] = request.full_url
            seen["authorization"] = request.get_header("Authorization")
            return FakeResponse({"displayName": "示範店", "basicId": "@demo"})

        result = line_api.bot_info(shop, opener=opener)
        self.assertEqual("示範店", result["displayName"])
        self.assertEqual("GET", seen["method"])
        self.assertEqual("https://api.line.me/v2/bot/info", seen["url"])
        self.assertEqual("Bearer token-for-test", seen["authorization"])

        def empty_opener(request, timeout=0):
            return EmptyResponse({})

        self.assertEqual({}, line_api.set_webhook(shop, "https://example.invalid/line/webhook", opener=empty_opener))
        self.assertEqual({}, line_api.test_webhook(shop, "https://example.invalid/line/webhook", opener=empty_opener))

    def test_line_pay_reserve_is_signed_and_confirm_rejects_bad_id(self) -> None:
        data = self.base_shop()
        data["payment"] = {
            "mode": "line_pay_online",
            "url": "",
            "environment": "sandbox",
            "currency": "TWD",
            "order_prefix": "DEMO",
        }
        (self.work / "secrets").mkdir()
        (self.work / "secrets" / "line-pay.json").write_text(
            json.dumps({"channel_id": "channel-test", "channel_secret": "secret-test"}),
            encoding="utf-8",
        )
        shop = ShopConfig.load(self.write_shop(data))
        seen = {}

        def opener(request, timeout=0):
            seen["url"] = request.full_url
            seen["headers"] = dict(request.header_items())
            seen["body"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse({
                "returnCode": "0000",
                "returnMessage": "success",
                "info": {"transactionId": "123456", "paymentUrl": {"web": "https://pay.example/123"}},
            })

        client = line_pay.LinePayClient(shop, opener=opener)
        result = client.reserve(140, "DEMO-001", "洗衣服務", "https://example.invalid/confirm", "https://example.invalid/cancel")
        self.assertTrue(result["ok"])
        self.assertEqual("https://sandbox-api-pay.line.me/v3/payments/request", seen["url"])
        self.assertEqual("channel-test", seen["headers"]["X-line-channelid"])
        self.assertEqual(140, seen["body"]["amount"])
        self.assertNotIn("secret-test", json.dumps(seen))
        with self.assertRaises(ConfigError):
            client.confirm("123/evil", 140)

    def test_connections_validate_reports_missing_secrets_without_network(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "connections.py"), "validate", "--shop", str(ROOT / "config" / "shop.template.json")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        self.assertEqual(2, result.returncode)
        self.assertIn('"status": "needs_input"', result.stdout)

    @unittest.skipUnless(HAS_POWERSHELL, "powershell.exe not available on this host")
    def test_configure_connections_can_set_qr_mode_without_secret_prompt(self) -> None:
        shop = self.write_shop(self.base_shop())
        command = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(ROOT / "Configure-Connections.ps1"),
            "-ShopPath", str(shop),
            "-Python", sys.executable,
            "-LinePayMode", "merchant_qr",
            "-LinePayQrUrl", "https://qrcodepay.line.me/demo",
        ]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
        self.assertEqual(2, result.returncode, result.stderr)
        updated = json.loads(shop.read_text(encoding="utf-8"))
        self.assertEqual("merchant_qr", updated["payment"]["mode"])
        self.assertEqual("https://qrcodepay.line.me/demo", updated["payment"]["url"])
        self.assertTrue(list((self.work / "backups").glob("shop-before-connections-*.json")))

    @unittest.skipUnless(HAS_POWERSHELL, "powershell.exe not available on this host")
    def test_install_creates_clean_instance_and_refuses_overwrite(self) -> None:
        target = self.work / "new-store"
        command = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(ROOT / "Install.ps1"),
            "-StorePath", str(target),
            "-Python", sys.executable,
        ]
        first = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
        self.assertEqual(0, first.returncode, first.stderr)
        self.assertTrue((target / "shop.json").exists())
        self.assertTrue((target / "secrets").is_dir())
        self.assertTrue((target / "secrets" / "line-channel.json.example").exists())
        self.assertTrue((target / "secrets" / "line-pay.json.example").exists())
        self.assertTrue((target / "connections.py").exists())
        self.assertTrue((target / "Configure-Connections.ps1").exists())
        self.assertFalse((target / "secrets" / "line-channel.json").exists())
        report_path = target / "INSTALL-REPORT.json"
        self.assertTrue(report_path.exists(), "INSTALL-REPORT.json must exist after install")
        report = json.loads(report_path.read_text(encoding="utf-8-sig"))
        self.assertEqual(target.resolve(), Path(report["store_path"]).resolve())
        self.assertIn("installed_at_utc", report)
        validate = report.get("validate") or {}
        self.assertTrue(validate.get("ok") is True, report)
        self.assertEqual(0, validate.get("exit_code"), report)
        second = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
        self.assertNotEqual(0, second.returncode)


    def test_line_pay_local_report_merchant_qr_is_configured(self) -> None:
        data = self.base_shop()
        data["payment"] = {
            "mode": "merchant_qr",
            "url": "https://qrcodepay.line.me/demo-shop",
            "environment": "sandbox",
            "currency": "TWD",
            "order_prefix": "DEMO",
        }
        shop = ShopConfig.load(self.write_shop(data))
        report = line_pay.local_report(shop)
        self.assertNotEqual("not_selected", report["status"])
        self.assertIn(report["status"], {"configured", "merchant_qr_ready"})
        self.assertEqual("merchant_qr", report.get("mode"))
        self.assertEqual("https://qrcodepay.line.me/demo-shop", report.get("url"))

    def test_line_pay_local_report_merchant_qr_missing_url(self) -> None:
        data = self.base_shop()
        data["payment"] = {
            "mode": "merchant_qr",
            "url": "https://example.invalid/not-qr",
            "environment": "sandbox",
            "currency": "TWD",
            "order_prefix": "DEMO",
        }
        shop = ShopConfig.load(self.write_shop(data))
        report = line_pay.local_report(shop)
        self.assertEqual("missing", report["status"])

    def test_line_pay_local_report_disabled_is_not_selected(self) -> None:
        shop = ShopConfig.load(self.write_shop(self.base_shop()))
        report = line_pay.local_report(shop)
        self.assertEqual("not_selected", report["status"])

    def test_pack_forbidden_secret_members_helper(self) -> None:
        namelist = [
            "README.md",
            "secrets/line-channel.json.example",
            "secrets/line-pay.json.example",
            "secrets/line-channel.json",
            "nested/secrets/line-pay.json",
            "runtime/line_pay.py",
        ]
        bad = forbidden_secret_members(namelist)
        self.assertEqual(
            ["secrets/line-channel.json", "nested/secrets/line-pay.json"],
            bad,
        )
        self.assertEqual([], forbidden_secret_members([
            "secrets/line-channel.json.example",
            "secrets/line-pay.json.example",
        ]))

    def test_pack_product_kit_zip_excludes_real_secrets(self) -> None:
        out = self.work / "kit.zip"
        # Ensure example secrets exist in kit; real secrets must not appear in zip
        members = build_zip(ROOT, out)
        self.assertTrue(out.exists())
        self.assertEqual([], forbidden_secret_members(members))
        self.assertTrue(any(m.endswith("secrets/line-channel.json.example") for m in members))
        self.assertFalse(any(m.replace("\\", "/").endswith("secrets/line-channel.json") for m in members))

    def test_connector_source_has_no_write_sql(self) -> None:
        source = (ROOT / "connectors" / "base.py").read_text(encoding="utf-8").lower()
        for word in ("insert into", "update ", "delete from", "drop table", "alter table"):
            self.assertNotIn(word, source)



    def test_shop_config_loads_utf8_bom(self) -> None:
        data = self.base_shop()
        path = self.work / "shop-bom.json"
        body = json.dumps(data, ensure_ascii=False, indent=2)
        path.write_bytes(b"\xef\xbb\xbf" + body.encode("utf-8"))
        shop = ShopConfig.load(path)
        self.assertEqual([], shop.validate())
        self.assertEqual(data["shop_id"], shop.shop_id)

    def test_merchant_qr_url_requires_path_segment(self) -> None:
        self.assertFalse(is_merchant_qr_url("https://qrcodepay.line.me/"))
        self.assertFalse(is_merchant_qr_url("https://qrcodepay.line.me"))
        self.assertFalse(is_merchant_qr_url("https://qrcodepay.line.me///"))
        self.assertTrue(is_merchant_qr_url("https://qrcodepay.line.me/demo"))
        self.assertTrue(is_merchant_qr_url("https://qrcodepay.line.me/demo/shop"))
        data = self.base_shop()
        data["payment"] = {
            "mode": "merchant_qr",
            "url": "https://qrcodepay.line.me/",
            "environment": "sandbox",
            "currency": "TWD",
            "order_prefix": "DEMO",
        }
        errors = ShopConfig.load(self.write_shop(data)).validate()
        self.assertTrue(any("路徑" in error or "QR" in error for error in errors))
        data["payment"]["url"] = "https://qrcodepay.line.me/demo"
        self.assertEqual([], ShopConfig.load(self.write_shop(data)).validate())
        bare = self.base_shop()
        bare["payment"] = {
            "mode": "merchant_qr",
            "url": "https://qrcodepay.line.me/",
            "environment": "sandbox",
            "currency": "TWD",
            "order_prefix": "DEMO",
        }
        report_bare = line_pay.local_report(ShopConfig.load(self.write_shop(bare)))
        self.assertEqual("missing", report_bare["status"])

    def test_patch_shop_json_preserves_hours_structure(self) -> None:
        src = ROOT / "config" / "shop.template.json"
        path = self.work / "shop.json"
        path.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        before = json.loads(path.read_text(encoding="utf-8-sig"))
        hours_before = before["hours"]
        patch_shop_json.patch_shop(
            path,
            payment={
                "mode": "merchant_qr",
                "url": "https://qrcodepay.line.me/demo-shop",
            },
            validate=True,
        )
        after = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual("merchant_qr", after["payment"]["mode"])
        self.assertEqual("https://qrcodepay.line.me/demo-shop", after["payment"]["url"])
        self.assertEqual(hours_before, after["hours"])
        for day, windows in after["hours"].items():
            self.assertIsInstance(windows, list, day)
            for window in windows:
                self.assertIsInstance(window, list, f"{day}:{window}")
                self.assertEqual(2, len(window))

    def test_pack_rejects_pycache_members(self) -> None:
        self.assertEqual(
            ["runtime/__pycache__/x.pyc"],
            forbidden_pycache_members(["runtime/__pycache__/x.pyc", "runtime/line_pay.py"]),
        )
        self.assertEqual([], forbidden_pycache_members(["runtime/line_pay.py"]))



    def test_patch_line_pay_qr_requires_url_and_sets_mode(self) -> None:
        src = ROOT / "config" / "shop.template.json"
        path = self.work / "shop.json"
        path.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        modules = [
            "brand_oa", "human_faq", "staff_handoff", "progress_lookup",
            "pickup_booking", "photo_quote", "line_pay_qr",
        ]
        with self.assertRaises(ConfigError):
            patch_shop_json.patch_shop(
                path,
                product={"plan": "growth", "style": "heritage_green_gold", "modules": modules},
                validate=False,
            )
        before = json.loads(path.read_text(encoding="utf-8"))
        self.assertNotEqual("merchant_qr", before["payment"]["mode"])
        patch_shop_json.patch_shop(
            path,
            payment={"url": "https://qrcodepay.line.me/demo-shop"},
            product={"plan": "growth", "style": "heritage_green_gold", "modules": modules},
            validate=True,
        )
        after = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual("merchant_qr", after["payment"]["mode"])
        self.assertEqual("https://qrcodepay.line.me/demo-shop", after["payment"]["url"])
        self.assertIn("line_pay_qr", after["product"]["modules"])

    def test_pack_utf8_arcname_recovers_surrogates(self) -> None:
        from pack_product_kit import utf8_arcname
        import os
        docs = self.work / "docs"
        docs.mkdir()
        good = "交機驗收.md"
        raw = good.encode("utf-8")
        # Create file via raw UTF-8 bytes path (Linux os.open)
        bdir = os.fsencode(str(docs))
        bpath = bdir + b"/" + raw
        fd = os.open(bpath, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
        try:
            os.write(fd, b"# handover\n")
        finally:
            os.close(fd)
        listed = list(docs.iterdir())
        self.assertEqual(1, len(listed))
        recovered = utf8_arcname(listed[0], self.work)
        self.assertEqual(f"docs/{good}", recovered)

        class FakeRel:
            def __init__(self, *parts: str):
                self.parts = parts
            def relative_to(self, root):
                return self

        # PEP 383 surrogateescape form of the same UTF-8 bytes
        pep383 = "".join(chr(b) if b < 128 else chr(0xDC00 + b) for b in raw)
        self.assertEqual(f"docs/{good}", utf8_arcname(FakeRel("docs", pep383), self.work))
        # latin-1 mojibake is still valid UTF-8 (wrong glyphs) — pack must not crash.
        latin1 = raw.decode("latin-1")
        self.assertEqual(f"docs/{latin1}", utf8_arcname(FakeRel("docs", latin1), self.work))

if __name__ == "__main__":
    unittest.main()
