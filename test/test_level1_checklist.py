"""OPS-L1-12: offline, count-only fixtures; no production data or network."""
import copy
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import unittest
from unittest import mock

import level1_gates as lg
from test_level1_gates import Base, POLICY, FRIDAY, SATURDAY, SUNDAY, at, all_success_rows, pull_row, times_with_gap


class ChecklistTests(Base):
    def test_new_day_exposes_twelve_checks(self):
        result = lg.evaluate_day(FRIDAY, lg.Paths(self.tmp, mdb_log=self.tmp / "missing.jsonl"), self.hours, self.config, at(SATURDAY, "08:00"))
        self.assertEqual(len(result.get("checklist", {})), 12)

    def test_output_root_keeps_inputs_read_only_and_summary_on_top(self):
        output = self.tmp / "artifacts"
        paths = lg.Paths(self.tmp, mdb_log=self.tmp / "missing.jsonl", out_root=output)
        receipt = lg.evaluate_day(FRIDAY, paths, self.hours, self.config, at(SATURDAY, "08:00"))
        report = lg.render_report({FRIDAY: receipt}, at(SATURDAY, "08:00"), FRIDAY)
        self.assertIn("12 項有 0 項算過", report.splitlines()[2])
        self.assertIn("連續全過 0 天", report.splitlines()[2])
        self.assertEqual(paths.ops_dir, output / "output/operations")
        with mock.patch.dict("os.environ", {"LOCALAPPDATA": str(self.tmp / "localappdata")}):
            defaults = lg.Paths(self.tmp)
            self.assertEqual(defaults.heartbeat_log_dir, self.tmp / "localappdata/sxj-heartbeat/log")
            self.assertEqual(defaults.service_logs, [self.tmp / "localappdata/line-bot/tunnel_events.jsonl"])
            injected = lg.Paths(self.tmp, mdb_log=self.tmp / "pulls.jsonl")
            self.assertTrue(injected.heartbeat_log_dir.is_relative_to(self.tmp))
        with mock.patch("sys.dont_write_bytecode", False):
            module = self.tmp / "hours.py"
            module.write_text("VALUE = 7\n", encoding="utf-8")
            self.assertEqual(lg.load_hours_module(module).VALUE, 7)
            self.assertFalse((self.tmp / "__pycache__").exists())

    def test_cached_restart_pass_cannot_override_not_ready(self):
        receipt = day_receipt(FRIDAY)
        receipt["conditions"] = {}
        self.write_json(f"output/operations/level1-gates-{FRIDAY}.json", receipt)
        evaluations = lg.load_evaluations(self.tmp / "output/operations")
        self.assertEqual(evaluations[FRIDAY]["checklist"]["11"]["status"], "not_ready")
        self.assertFalse(lg.checklist_summary(evaluations, FRIDAY)["met"])

    def receipt(self, name, day, payload):
        return self.write_json(f"data/gates/{name}-{day}.json", {"date": str(day), **payload})

    def check(self, number, day=FRIDAY):
        paths = lg.Paths(self.tmp, mdb_log=self.tmp / "pulls.jsonl",
                         heartbeat_log_dir=self.tmp / "heartbeat")
        return lg.evaluate_checklist(day, paths, self.hours, self.config,
                                     at(day + timedelta(days=1), "08:00"))[str(number)]

    def service(self, day=FRIDAY, takeover_delay=0, handover_delay=0, gap=False, sparse=False):
        start = at(day, "00:00" if day.weekday() == 6 else "18:05" if day.weekday() == 5 else "20:05")
        handover = at(day + timedelta(days=1), "09:50")
        rows = []
        if day.weekday() != 6:
            rows.append({"ts": (start + timedelta(seconds=takeover_delay)).isoformat(),
                         "event": "night_reclaim", "verify_status": "match"})
        if (day + timedelta(days=1)).weekday() != 6:
            rows.append({"ts": (handover + timedelta(seconds=handover_delay)).isoformat(),
                         "event": "day_handover", "registered_owner": "shop", "verify_status": "match"})
        self.events(rows)
        heartbeats, cursor = [], start
        while cursor <= handover:
            if not gap or not start + timedelta(minutes=10) <= cursor < start + timedelta(minutes=15):
                heartbeats.append({"time": cursor.astimezone(lg.timezone.utc).isoformat(),
                                   "mode": "LIVE", "code": "OK",
                                   "checks": {k: "OK" for k in ("bot", "local", "public", "line")}})
            cursor += timedelta(minutes=1)
        if sparse:
            heartbeats = heartbeats[:1]
        self.heartbeats(heartbeats)
        return rows

    def events(self, rows):
        (self.tmp / "tunnel_events.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")

    def heartbeats(self, rows):
        folder = self.tmp / "heartbeat"
        folder.mkdir(exist_ok=True)
        for path in folder.glob("*.jsonl"):
            path.unlink()
        by_day = {}
        for row in rows:
            day = datetime.fromisoformat(row["time"]).astimezone(lg.timezone.utc).date()
            by_day.setdefault(day, []).append(row)
        for day, values in by_day.items():
            (folder / f"{day}.jsonl").write_text("".join(json.dumps(row) + "\n" for row in values), encoding="utf-8")

    def heartbeat_rows(self):
        return [json.loads(line) for path in sorted((self.tmp / "heartbeat").glob("*.jsonl"))
                for line in path.read_text(encoding="utf-8").splitlines()]

    def accounting(self, **changes):
        payload = {"received": 10, "replied_ok": 7, "reply_failed": 0, "to_staff": 3, "no_reply_needed": 0}
        payload.update(changes)
        self.write_json(f"data/line-events/{FRIDAY}.json", payload)

    def checks(self, **changes):
        payload = {"schema": "level1-offline-checks/v1", "offline": True,
                   "generated_at": f"{FRIDAY}T23:00:00+08:00",
                   "checks": {key: {"status": "pass", "tests": 2, "failures": 0, "errors": 0,
                                      "skipped": 0} for key in ("copy_audit", "golden", "line_full", "handoff")}}
        payload.update(changes)
        return self.write_json(f"output/operations/level1-checks-{FRIDAY}.json", {"date": str(FRIDAY), **payload})

    def notify(self, day=FRIDAY, **changes):
        payload = {"sent": 8, "no_binding": 0, "abandoned": 0, "pending": 0,
                   "duplicates": 0, "wrong_sends": 0, "wrong_sends_basis": "reviewed_all_deliveries",
                   "reported_by": "shop-notify-report", "outbox": "ok", "corrupt_lines": 0}
        payload.update(changes)
        self.receipt("notify", day, payload)

    def test_all_missing_is_no_data_and_11_not_ready(self):
        results = lg.evaluate_checklist(FRIDAY, lg.Paths(self.tmp, mdb_log=self.tmp / "missing.jsonl"), self.hours, self.config, at(SATURDAY, "08:00"))
        self.assertEqual(set(results), {str(i) for i in range(1, 13)})
        self.assertEqual({k: v["status"] for k, v in results.items()},
                         {str(i): "not_ready" if i == 11 else "fail" if i == 12 else "no_data" for i in range(1, 13)})
        for result in results.values():
            self.assertTrue(result["reason"])
            self.assertTrue(result["evidence"])

    def test_01_records_pass_gap_fail_and_sparse_no_data(self):
        self.service()
        self.assertEqual(self.check(1)["status"], "pass")
        self.assertEqual(self.check(1)["subchecks"]["c"]["details"]["max_observed_gap_seconds"], 60)
        self.service(gap=True)
        self.assertEqual(self.check(1)["status"], "fail")
        self.assertEqual(self.check(1)["subchecks"]["c"]["details"]["max_observed_gap_seconds"], 360)
        self.service(sparse=True)
        self.assertEqual(self.check(1)["status"], "no_data")

    def test_01_saturday_1805_sunday_full_day(self):
        self.service(SATURDAY)
        self.assertEqual(self.check(1, SATURDAY)["status"], "pass")
        self.assertEqual(self.check(1, SATURDAY)["subchecks"]["b"]["status"], "not_applicable")
        self.service(SATURDAY, takeover_delay=2*3600)
        self.assertEqual(self.check(1, SATURDAY)["status"], "fail")
        self.service(SUNDAY)
        result = self.check(1, SUNDAY)
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["subchecks"]["a"]["status"], "not_applicable")
        self.assertEqual(result["subchecks"]["c"]["details"]["coverage_start"], at(SUNDAY, "00:00").isoformat())
        self.assertEqual(result["subchecks"]["c"]["details"]["coverage_end"], at(SUNDAY + timedelta(days=1), "09:50").isoformat())
        self.service(SUNDAY, sparse=True)
        self.assertEqual(self.check(1, SUNDAY)["status"], "no_data")

    def test_01_five_minute_grace_then_late_handover_and_takeover_fail(self):
        self.service(takeover_delay=300, handover_delay=300)
        self.assertEqual(self.check(1)["status"], "pass")
        for changes in ({"handover_delay": 301}, {"takeover_delay": 301}):
            self.service(**changes)
            self.assertEqual(self.check(1)["status"], "fail")

    def test_01_healthz_cannot_prove_ownership_and_metadata_stays_private(self):
        self.service()
        self.events([{"ts": at(FRIDAY, "20:05").isoformat(), "event": "healthz", "ok": True},
                     {"ts": at(FRIDAY, "20:05").isoformat(), "event": "webhook_update",
                      "verify_status": "mismatch", "new_url": "DO_NOT_ECHO_URL", "uid": "PRIVATE_UID"}])
        result = self.check(1)
        self.assertEqual(result["subchecks"]["a"]["status"], "fail")
        self.assertNotIn("DO_NOT_ECHO", json.dumps(result))
        self.assertNotIn("PRIVATE_UID", json.dumps(result))

    def test_01_transition_utc_and_corrupt_log(self):
        rows = self.service()
        for row in rows:
            row["ts"] = datetime.fromisoformat(row["ts"]).astimezone(lg.timezone.utc).isoformat()
        self.events(rows)
        self.assertEqual(self.check(1)["status"], "pass")
        with (self.tmp / "tunnel_events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write("broken\n")
        self.assertEqual(self.check(1)["status"], "no_data")
        (self.tmp / "tunnel_events.jsonl").write_bytes(b"\xff")
        self.assertEqual(self.check(1)["status"], "no_data")

    def test_01_known_gap_fails_even_with_missing_handover(self):
        rows = self.service(gap=True)
        self.events([row for row in rows if row["event"] != "day_handover"])
        result = self.check(1)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["subchecks"]["b"]["status"], "fail")
        self.assertEqual(result["subchecks"]["c"]["status"], "fail")

    def test_01_301_second_gap_fails_and_unobserved_edges_are_no_data(self):
        self.service()
        rows = self.heartbeat_rows()[::5]
        self.heartbeats(rows)
        self.assertEqual(self.check(1)["subchecks"]["c"]["status"], "pass")
        rows[2]["time"] = (datetime.fromisoformat(rows[2]["time"]) + timedelta(seconds=1)).isoformat()
        self.heartbeats(rows)
        result = self.check(1)["subchecks"]["c"]
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["details"]["max_observed_gap_seconds"], 301)
        self.service()
        rows = self.heartbeat_rows()[::5][2:]
        self.heartbeats(rows)
        result = self.check(1)["subchecks"]["c"]
        self.assertEqual(result["status"], "no_data")
        self.assertEqual(result["details"]["max_observed_gap_seconds"], 300)

    def test_01_a_b_pass_fail_no_data_and_next_day_only(self):
        for key, event in (("a", "night_reclaim"), ("b", "day_handover")):
            with self.subTest(key=key):
                rows = self.service()
                self.assertEqual(self.check(1)["subchecks"][key]["status"], "pass")
                self.events([r for r in rows if r["event"] != event])
                self.assertEqual(self.check(1)["subchecks"][key]["status"], "fail")
                self.events([{**r, "verify_status": "mismatch"} if r["event"] == event else r for r in rows])
                self.assertEqual(self.check(1)["subchecks"][key]["status"], "fail")
                (self.tmp / "tunnel_events.jsonl").unlink()
                self.assertEqual(self.check(1)["subchecks"][key]["status"], "no_data")
        rows = self.service()
        rows[1]["ts"] = at(FRIDAY, "09:50").isoformat()
        self.events(rows)
        self.assertEqual(self.check(1)["subchecks"]["b"]["status"], "fail")

    def test_01_a_only_reclaim_or_webhook_update_proves_takeover(self):
        for event, expected in (("night_reclaim", "pass"), ("webhook_update", "pass"),
                                ("handover_noop", "fail"), ("night_handover", "fail")):
            rows = self.service()
            rows[0]["event"] = event
            self.events(rows)
            self.assertEqual(self.check(1)["subchecks"]["a"]["status"], expected)

    def test_01_b_closed_next_day_is_not_applicable(self):
        self.service()
        config = copy.deepcopy(self.config)
        config["days"]["5"] = None
        paths = lg.Paths(self.tmp, mdb_log=self.tmp / "pulls.jsonl", heartbeat_log_dir=self.tmp / "heartbeat")
        result = lg.evaluate_checklist(FRIDAY, paths, self.hours, config, at(SATURDAY, "12:00"))["1"]
        self.assertEqual(result["subchecks"]["b"]["status"], "not_applicable")

    def test_01_c_sparse_tunnel_continuous_heartbeat_passes(self):
        rows = self.service()
        # Two state-change events are nearly fourteen hours apart; neither is a heartbeat.
        result = self.check(1)
        self.assertEqual(len(rows), 2)
        self.assertEqual(result["subchecks"]["c"]["status"], "pass")
        self.events([])
        self.assertEqual(self.check(1)["subchecks"]["c"]["status"], "pass")
        (self.tmp / "tunnel_events.jsonl").unlink()
        self.assertEqual(self.check(1)["subchecks"]["c"]["status"], "pass")

    def test_01_c_missing_heartbeat_is_no_data(self):
        self.service()
        # Neither a continuous healthz file nor frequent noops may substitute for the sampler.
        rows = self.heartbeat_rows()
        (self.tmp / "healthz.jsonl").write_text("".join(json.dumps(
            {"ts": row["time"], "event": "healthz", "ok": True}) + "\n" for row in rows), encoding="utf-8")
        with (self.tmp / "tunnel_events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write("".join(json.dumps({"ts": row["time"], "event": "handover_noop",
                                            "verify_status": "match"}) + "\n" for row in rows))
        self.heartbeats([])
        result = self.check(1)
        self.assertEqual(result["subchecks"]["a"]["status"], "pass")
        self.assertEqual(result["subchecks"]["b"]["status"], "pass")
        self.assertEqual(result["subchecks"]["c"]["status"], "no_data")
        self.assertEqual(result["status"], "no_data")
        (self.tmp / "heartbeat").rmdir()
        self.assertEqual(self.check(1)["subchecks"]["c"]["status"], "no_data")

    def test_01_c_channel_failure_over_five_minutes(self):
        for key in ("bot", "local", "public", "line"):
            for minutes, expected in ((5, "pass"), (6, "fail")):
                with self.subTest(channel=key, minutes=minutes):
                    self.service()
                    rows = self.heartbeat_rows()
                    for row in rows[10:10+minutes]:
                        row["checks"][key] = key.upper() + "_ERROR"
                    self.heartbeats(rows)
                    result = self.check(1)["subchecks"]["c"]
                    self.assertEqual(result["status"], expected)
                    self.assertEqual(result["details"]["max_channel_failure_seconds"], minutes * 60)
        self.service()
        rows = self.heartbeat_rows()
        for row in rows[-7:]:
            row["checks"]["line"] = "LINE_ERROR"
        self.heartbeats(rows)
        self.assertEqual(self.check(1)["subchecks"]["c"]["status"], "fail")

    def test_01_c_failure_is_not_ping_delivery_or_code(self):
        self.service()
        rows = self.heartbeat_rows()
        for row in rows:
            row.update(code="DELIVERY_ERROR", exit_code=1, delivery={"channel": "TIMEOUT"})
        self.heartbeats(rows)
        self.assertEqual(self.check(1)["subchecks"]["c"]["status"], "pass")

    def test_01_c_dry_run_corrupt_missing_and_out_of_period_logs_are_no_data(self):
        for change in ("dry", "checks", "time", "corrupt", "out_of_period", "partial"):
            with self.subTest(change=change):
                self.service()
                rows = self.heartbeat_rows()
                if change == "dry":
                    for row in rows:
                        row["mode"] = "DRY_RUN"
                elif change == "checks":
                    for row in rows:
                        row["checks"] = {}
                elif change == "time":
                    for row in rows:
                        row["time"] = datetime.fromisoformat(row["time"]).replace(tzinfo=None).isoformat()
                elif change == "out_of_period":
                    for row in rows:
                        row["time"] = (datetime.fromisoformat(row["time"]) - timedelta(days=2)).isoformat()
                elif change == "partial":
                    rows = rows[:10]
                self.heartbeats(rows)
                if change == "corrupt":
                    path = next((self.tmp / "heartbeat").glob("*.jsonl"))
                    with path.open("a", encoding="utf-8") as handle:
                        handle.write("broken\n")
                self.assertEqual(self.check(1)["subchecks"]["c"]["status"], "no_data")

    def test_01_report_has_separate_a_b_c_results(self):
        self.service()
        receipt = day_receipt(FRIDAY)
        receipt["checklist"]["1"] = self.check(1)
        report = lg.render_report({FRIDAY: receipt}, at(SATURDAY, "12:00"), FRIDAY)
        for label in ("1a. 接手", "1b. 交還", "1c. 中間沒停機"):
            self.assertIn("| " + label + " | pass |", report)

    def test_02_transfer_is_answered_and_gap_fails(self):
        self.accounting()
        self.assertEqual(self.check(2)["status"], "pass")
        self.accounting(replied_ok=6)
        self.assertEqual(self.check(2)["status"], "fail")
        self.assertEqual(self.check(2)["details"]["unanswered"], 1)

    def test_02_usage_classification_is_not_delivery_proof(self):
        self.write_json(f"data/line-usage/{FRIDAY}.json", {"schema": "line-usage/v1", "date": str(FRIDAY),
                         "messages": 10, "by_outcome": {"auto": 7, "to_staff": 3}})
        self.assertEqual(self.check(2)["status"], "no_data")

    def test_02_only_counts_and_no_private_payload_echo(self):
        self.accounting(uid="DO_NOT_ECHO", text="PRIVATE_CONTENT", phone="PRIVATE_PHONE")
        result = self.check(2)
        self.assertEqual(result["status"], "no_data")
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertNotIn("DO_NOT_ECHO", json.dumps(result))

    def test_02_invalid_counts_do_not_pass(self):
        for value in (None, True, -1, "10"):
            self.accounting(received=value)
            self.assertEqual(self.check(2)["status"], "no_data")
        self.accounting(replied_ok=11)
        self.assertEqual(self.check(2)["status"], "no_data")

    def test_02_new_producer_shape_no_reply_needed_and_failed_reply(self):
        self.accounting(replied_ok=6, no_reply_needed=1)
        self.assertEqual(self.check(2)["status"], "pass")
        self.accounting(reply_failed=1)
        self.assertEqual(self.check(2)["status"], "fail")
        self.write_json(f"data/line-events/{FRIDAY}.json", {"received": 0})
        self.assertEqual(self.check(2)["status"], "no_data")

    def test_03_04_05_pass_fail_missing_individually(self):
        for number, key in ((3, "golden"), (4, "line_full"), (5, "handoff")):
            with self.subTest(number=number):
                self.checks()
                self.assertEqual(self.check(number)["status"], "pass")
                raw = json.loads(self.checks().read_text(encoding="utf-8"))
                raw["checks"][key].update(status="fail", failures=1)
                self.checks(checks=raw["checks"])
                self.assertEqual(self.check(number)["status"], "fail")
                del raw["checks"][key]
                self.checks(checks=raw["checks"])
                self.assertEqual(self.check(number)["status"], "no_data")

    def test_03_copy_audit_must_also_pass(self):
        checks = json.loads(self.checks().read_text(encoding="utf-8"))["checks"]
        checks["copy_audit"].update(status="fail", failures=1)
        self.checks(checks=checks)
        self.assertEqual(self.check(3)["status"], "fail")

    def test_03_04_05_stale_skipped_empty_online_receipts_no_data(self):
        for changes in ({"generated_at": "2026-10-29T23:00:00+08:00"}, {"offline": False},
                        {"generated_at": "2026-10-30T23:00:00"}):
            self.checks(**changes)
            for number in (3, 4, 5):
                self.assertEqual(self.check(number)["status"], "no_data")
        checks = json.loads(self.checks().read_text(encoding="utf-8"))["checks"]
        for field, value in (("tests", 0), ("skipped", 1), ("errors", 1)):
            modified = copy.deepcopy(checks)
            modified["line_full"][field] = value
            self.checks(checks=modified)
            self.assertNotEqual(self.check(4)["status"], "pass")

    def test_06_delivery_and_declining_binding_rate(self):
        self.notify(FRIDAY - timedelta(days=1), no_binding=2)
        self.notify()
        self.assertEqual(self.check(6)["status"], "pass")
        self.notify(sent=0)
        self.assertEqual(self.check(6)["status"], "fail")
        self.notify(no_binding=4)
        self.assertEqual(self.check(6)["status"], "fail")

    def test_06_missing_baseline_is_no_data_and_sunday_no_notification_na(self):
        self.notify()
        self.assertEqual(self.check(6)["status"], "no_data")
        self.assertEqual(self.check(6, SUNDAY)["status"], "not_applicable")

    def test_07_duplicates_or_wrong_sends_fail_even_closed_day(self):
        self.notify()
        self.assertEqual(self.check(7)["status"], "pass")
        for changes in ({"duplicates": 1}, {"wrong_sends": 1}):
            self.notify(**changes)
            self.assertEqual(self.check(7)["status"], "fail")
        self.notify(SUNDAY, duplicates=1)
        self.assertEqual(self.check(7, SUNDAY)["status"], "fail")

    def test_07_duplicate_only_is_not_wrong_recipient_proof(self):
        self.notify(wrong_sends_basis="auto_duplicate_deliveries")
        self.assertEqual(self.check(7)["status"], "no_data")

    def test_08_59_minutes_pass_61_fail_and_sunday_na(self):
        for gap, want in ((59, "pass"), (61, "fail")):
            rows = [pull_row(t) for t in times_with_gap(FRIDAY, at(FRIDAY, "13:00"), gap)]
            self.write_pulls(rows, "pulls.jsonl")
            self.assertEqual(self.check(8)["status"], want)
        self.assertEqual(self.check(8, SUNDAY)["status"], "not_applicable")

    def test_09_pass_failed_slot_and_missing_log(self):
        self.write_json("data/publishing-policy.json", POLICY)
        self.write_json(f"data/posted-log/{FRIDAY}.json", all_success_rows(FRIDAY))
        self.assertEqual(self.check(9)["status"], "pass")
        rows = all_success_rows(FRIDAY)
        rows[-1]["status"] = "failed"
        self.write_json(f"data/posted-log/{FRIDAY}.json", rows)
        self.assertEqual(self.check(9)["status"], "fail")

    def test_09_preserves_existing_produced_slot_schedule(self):
        self.write_json("data/publishing-policy.json", POLICY)
        folder = self.tmp / "docs/assets" / str(FRIDAY)
        folder.mkdir(parents=True)
        (folder / "slot-01.png").write_bytes(b"synthetic")
        rows = [r for r in all_success_rows(FRIDAY) if r["slot"] == 1]
        self.write_json(f"data/posted-log/{FRIDAY}.json", rows)
        self.assertEqual(self.check(9)["status"], "pass")
        (folder / "slot-02.png").write_bytes(b"synthetic")
        self.assertEqual(self.check(9)["status"], "fail")

    def recovery(self, status="resolved", notification="pending", attempts=1):
        return self.write_json(f"data/gates/publish-recovery-{FRIDAY}-slot1-facebook.json",
                               {"date": str(FRIDAY), "slot": 1, "platform": "facebook", "status": status,
                                "notification": notification, "retry_attempts": attempts})

    def test_10_retry_or_delivered_notification_pass_pending_fails(self):
        self.write_json(f"data/posted-log/{FRIDAY}.json", [
            {"date": str(FRIDAY), "slot": 1, "platform": "facebook", "status": "failed", "dry_run": False}])
        self.recovery()
        self.assertEqual(self.check(10)["status"], "pass")
        self.recovery("needs_manual", "delivered", 0)
        self.assertEqual(self.check(10)["status"], "pass")
        self.recovery("needs_manual", "pending", 0)
        self.assertEqual(self.check(10)["status"], "fail")
        self.recovery("retry_pending", "pending", 0)
        self.assertEqual(self.check(10)["status"], "fail")

    def test_10_no_failures_is_not_applicable(self):
        self.write_json("data/publishing-policy.json", POLICY)
        self.write_json(f"data/posted-log/{FRIDAY}.json", all_success_rows(FRIDAY))
        self.assertEqual(self.check(10)["status"], "not_applicable")
        self.write_json(f"data/posted-log/{FRIDAY}.json", [])
        self.assertEqual(self.check(10)["status"], "not_applicable")

    def test_10_missing_invalid_or_dry_run_log_cannot_invent_failure(self):
        self.assertEqual(self.check(10)["status"], "no_data")
        self.write_json(f"data/posted-log/{FRIDAY}.json", {})
        self.assertEqual(self.check(10)["status"], "no_data")
        for rows in ([{}], [{"status": "failed", "dry_run": False}],
                     [{"slot": 1, "platform": "facebook", "status": "unknown", "dry_run": False}]):
            self.write_json(f"data/posted-log/{FRIDAY}.json", rows)
            self.assertEqual(self.check(10)["status"], "no_data")
        self.write_json(f"data/posted-log/{FRIDAY}.json", [
            {"date": str(FRIDAY), "slot": 1, "platform": "facebook", "status": "failed", "dry_run": True}])
        self.assertEqual(self.check(10)["status"], "not_applicable")

    def test_10_later_success_still_requires_recovery_evidence(self):
        self.write_json(f"data/posted-log/{FRIDAY}.json", [
            {"date": str(FRIDAY), "slot": 1, "platform": "facebook", "status": status, "dry_run": False}
            for status in ("failed", "success")])
        self.assertEqual(self.check(10)["status"], "fail")
        self.recovery()
        self.assertEqual(self.check(10)["status"], "pass")

    def test_10_failed_post_without_receipt_fails(self):
        self.write_json(f"data/posted-log/{FRIDAY}.json", [
            {"date": str(FRIDAY), "slot": 1, "platform": "facebook", "status": "failed", "dry_run": False}])
        self.assertEqual(self.check(10)["status"], "fail")

    def test_11_never_passes_with_any_receipt(self):
        for payload in ({"status": "pass", "ready": True, "tests": 99}, {}, {"status": "fail"}):
            self.receipt("restart", FRIDAY, payload)
            self.assertEqual(self.check(11)["status"], "not_ready")

    def test_12_nightly_window_and_missing_report(self):
        path = f"output/day-reports/{FRIDAY}.json"
        self.assertEqual(self.check(12)["status"], "fail")
        for stamp, want in ((f"{FRIDAY}T22:50:00", "pass"), (f"{FRIDAY}T23:59:59", "pass"),
                            (f"{SATURDAY}T00:59:59", "pass"), (f"{SATURDAY}T01:01:00", "fail"),
                            (f"{FRIDAY}T22:00:00", "pass"), (f"{SATURDAY}T01:00:00+08:00", "pass"),
                            (f"{FRIDAY}T21:59:59", "fail"), ("2026-10-29T23:40:00", "fail"),
                            (f"{FRIDAY}T14:50:00Z", "pass"), ("garbage", "no_data")):
            self.write_json(path, {"date": str(FRIDAY), "generated_at": stamp, "ok": True})
            with self.subTest(stamp=stamp):
                self.assertEqual(self.check(12)["status"], want)
        self.write_json(path, {"date": str(FRIDAY-timedelta(days=1)), "generated_at": f"{FRIDAY}T22:50:00"})
        self.assertEqual(self.check(12)["status"], "no_data")

    def test_report_has_only_twelve_items_and_three_day_goal(self):
        receipt = lg.evaluate_day(FRIDAY, lg.Paths(self.tmp, mdb_log=self.tmp / "pulls.jsonl"),
                                  self.hours, self.config, at(SATURDAY, "08:00"))
        report = lg.render_report({FRIDAY: receipt}, at(SATURDAY, "08:00"), FRIDAY)
        self.assertIn("目標 3 天", report)
        for obsolete in ("7 天", "三個條件", "舊版三項趨勢", "23:40"):
            self.assertNotIn(obsolete, report)
        self.assertEqual(len(receipt["conditions"]), 3)  # JSON compatibility only.

    def test_incidents_pass_fail_missing_are_explicit(self):
        path = self.tmp / f"data/gates/incidents-{FRIDAY}.json"
        self.assertEqual(lg.evaluate_incidents(FRIDAY, path)["status"], "no_data")
        for count, status in ((0, "pass"), (1, "fail")):
            self.receipt("incidents", FRIDAY, {"complete": True, "customer_affected": count})
            self.assertEqual(lg.evaluate_incidents(FRIDAY, path)["status"], status)


def day_receipt(day, status="pass"):
    return {"date": str(day), "rules_version": lg.RULES_VERSION,
            "checklist": {str(n): {"status": status} for n in range(1, 13)},
            "incidents": {"status": "pass"}}


class ChecklistStreakTests(unittest.TestCase):
    def test_three_all_pass_days_and_na_count(self):
        days = {FRIDAY - timedelta(days=i): day_receipt(FRIDAY - timedelta(days=i)) for i in range(3)}
        days[FRIDAY]["checklist"]["6"]["status"] = "not_applicable"
        summary = lg.checklist_summary(days, FRIDAY)
        self.assertEqual(summary["consecutive_days"], 3)
        self.assertTrue(summary["met"])

    def test_no_data_breaks_streak(self):
        days = {FRIDAY - timedelta(days=i): day_receipt(FRIDAY - timedelta(days=i)) for i in range(4)}
        days[FRIDAY - timedelta(days=1)]["checklist"]["2"]["status"] = "no_data"
        self.assertEqual(lg.checklist_summary(days, FRIDAY)["consecutive_days"], 1)
        self.assertFalse(lg.checklist_summary(days, FRIDAY)["met"])

    def test_fail_not_ready_missing_day_missing_item_or_legacy_break(self):
        for status in ("fail", "not_ready", "not_required", "no_data", "unknown"):
            receipt = day_receipt(FRIDAY)
            receipt["checklist"]["11"]["status"] = status
            self.assertEqual(lg.checklist_summary({FRIDAY: receipt}, FRIDAY)["consecutive_days"], 0)
        receipt = day_receipt(FRIDAY)
        del receipt["checklist"]["3"]
        self.assertEqual(lg.checklist_summary({FRIDAY: receipt}, FRIDAY)["consecutive_days"], 0)
        self.assertEqual(lg.checklist_summary({FRIDAY: {"conditions": {}}}, FRIDAY)["consecutive_days"], 0)
        self.assertEqual(lg.checklist_summary({FRIDAY: day_receipt(FRIDAY), FRIDAY-timedelta(days=2): day_receipt(FRIDAY-timedelta(days=2))}, FRIDAY)["consecutive_days"], 1)

    def test_customer_incident_or_unknown_breaks_all_green_day(self):
        for status in ("fail", "no_data"):
            receipt = day_receipt(FRIDAY)
            receipt["incidents"]["status"] = status
            self.assertFalse(lg.checklist_summary({FRIDAY: receipt}, FRIDAY)["day_passed"])

    def test_anchor_ignores_future_history_and_empty_streak_zero(self):
        self.assertEqual(lg.checklist_summary({}, FRIDAY)["consecutive_days"], 0)
        receipt = day_receipt(FRIDAY)
        self.assertEqual(lg.checklist_summary({FRIDAY: receipt}, SATURDAY)["consecutive_days"], 0)

    def test_old_rule_versions_cannot_count_towards_r3_streak(self):
        for version in (2, 3):
            receipt = day_receipt(FRIDAY)
            receipt["rules_version"] = version
            self.assertFalse(lg.checklist_summary({FRIDAY: receipt}, FRIDAY)["day_passed"])
            self.assertEqual(lg.checklist_summary({FRIDAY: receipt}, FRIDAY)["consecutive_days"], 0)


if __name__ == "__main__":
    unittest.main()
