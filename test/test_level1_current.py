"""L1GATE-r1: synthetic markers only, no network or production customer data."""
from datetime import date, datetime, timedelta
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import level1_shop as s
import level1_gates as lg
import level1_offline_checks as offline

DAY = date(2026, 11, 13)
NOW = datetime(2026, 11, 13, 23, tzinfo=s.TAIPEI)
PASS = dict(status='pass', tests=2, failures=0, errors=0, skipped=0, failed_tests=[])
UNIT = "import unittest\nclass Probe(unittest.TestCase):\n def test_probe(self): self.assertTrue(True)\nif __name__ == '__main__': unittest.main()\n"


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return path

    def json(self, name, value):
        return self.write(name, json.dumps(value))

    def cover(self, *rows):
        return self.write('day_cover.jsonl', ''.join(json.dumps(r) + '\n' for r in rows))

    def cover_row(self, action='shop_fixed_no_cover', time='10:00:00', day=DAY, **fields):
        return dict(ts=f'{day}T{time}+08:00', action=action, **fields)

    def logs(self, *lines, name='webhook_server.log', day=DAY):
        # Distinct real events need distinct (timestamp, line) identities. The
        # reader de-duplicates exact copies, including tee/copy duplicates.
        start = datetime.combine(day, datetime.min.time()).replace(hour=22, minute=1)
        return self.write('logs/' + name, ''.join(
            f'{start + timedelta(seconds=i):%Y-%m-%d %H:%M:%S} {line}\n'
            for i, line in enumerate(lines)))

    def night(self):
        return s.night_counts(DAY, self.root / 'logs')

    def post(self):
        # Exact shape the runtime's log_message writes (bare requestline, no quotes).
        return '[Webhook] POST /line/webhook HTTP/1.1 - 200'

    def incoming(self):
        return "[Webhook Text] User SYNTHETIC...: 'SYNTHETIC ONLY'"

    def success(self):
        return '[Webhook Reply Success] HTTP 200'

    def shop_receipt(self, **changes):
        row = dict(schema='shop-replies/v1', date=str(DAY), generated_at=NOW.isoformat(),
                   window='shop_day', complete=True, received=2, replied_ok=1,
                   reply_failed=0, to_staff=1, no_reply_needed=0)
        row.update(changes)
        return self.json('shop.json', row)

    def receipt(self, group='facts'):
        self.write('runtime/runtime/webhook_server.py', '# SYNTHETIC live\n')
        runtime = self.root / 'runtime'
        value = dict(schema='level1-shop-checks/v2', date=str(DAY), generated_at=NOW.isoformat(),
                     offline=True, mode='full', source_runtime=str(runtime.resolve()),
                     budget_seconds=300, elapsed_seconds=2, snapshot_error=None,
                     source_manifest={'runtime/webhook_server.py': s.digest(runtime / 'runtime/webhook_server.py')},
                     checks={group: {'suites': [{**PASS, 'suite': name}
                             for name in (*s.GROUPS[group], *s.BASE_RED)]}})
        return value, runtime

    def evaluate_receipt(self, value, runtime, group='facts'):
        path = self.json('checks.json', value)
        return s.test_evidence(DAY, path, group, NOW, runtime)


class OwnershipTests(Fixtures):
    def test_shop_self_registered_is_timely_without_ai_tunnel_event(self):
        p = self.cover(self.cover_row())
        self.assertEqual('pass', s.day_ownership(DAY, p)['status'])

    def test_verified_handback_and_local_date_are_required(self):
        p = self.cover(self.cover_row('handed_back_to_shop', verify='mismatch'))
        self.assertEqual('no_data', s.day_ownership(DAY, p)['status'])
        p = self.cover(dict(ts=f'{DAY}T02:00:00Z', action='handed_back_to_shop', verify='match'))
        self.assertEqual('pass', s.day_ownership(DAY, p)['status'])
        p = self.cover(self.cover_row(day=DAY - timedelta(days=1)))
        self.assertEqual('no_data', s.day_ownership(DAY, p)['status'])

    def test_ai_day_cover_overrides_shop_observation(self):
        for action in ('switched_to_ai', 'already_ai'):
            p = self.cover(self.cover_row(), self.cover_row(action, time='12:00:00'))
            row = s.day_ownership(DAY, p)
            self.assertEqual('fail', row['status'])
            self.assertEqual(1, row['details']['ai_cover_checks'])

    def test_check_error_is_not_shop_confirmation(self):
        p = self.cover(self.cover_row(check_error='SyntheticError'))
        self.assertEqual('no_data', s.day_ownership(DAY, p)['status'])

    def test_missing_corrupt_late_and_night_records_do_not_pass(self):
        self.assertEqual('no_data', s.day_ownership(DAY, self.root / 'missing')['status'])
        self.assertEqual('no_data', s.day_ownership(DAY, None)['status'])
        p = self.cover(self.cover_row(time='10:05:01'))
        self.assertEqual('fail', s.day_ownership(DAY, p)['status'])
        p = self.cover(self.cover_row(time='20:00:00'))
        self.assertEqual('no_data', s.day_ownership(DAY, p)['status'])
        p = self.write('day_cover.jsonl', '{broken\n')
        self.assertEqual('no_data', s.day_ownership(DAY, p)['status'])

    def test_current_service_uses_day_cover_and_rejects_retired_heartbeat(self):
        tomorrow = DAY + timedelta(days=1)
        self.cover(self.cover_row(day=tomorrow))
        paths = lg.Paths(self.root, mdb_log=self.root / 'pulls.jsonl', shop_root=self.root / 'shop')
        class Hours:
            def day_window_for(self, day, config):
                start = datetime.combine(day, datetime.min.time(), s.TAIPEI).replace(hour=10)
                return start, start.replace(hour=20)
        with mock.patch.object(lg, 'evaluate_heartbeat', return_value=lg._gate('pass', 'legacy', [])):
            row = lg.evaluate_service(DAY, paths, Hours(), {})
        self.assertEqual('pass', row['subchecks']['b']['status'])
        self.assertEqual('no_data', row['subchecks']['c']['status'])


class LogTests(Fixtures):
    def test_post_200_and_guard_are_not_delivery(self):
        self.logs(self.post(), self.incoming(), '[Chat Guard] synthetic action')
        row = self.night()
        self.assertEqual('fail', row['status'])
        self.assertEqual(1, row['details']['inbound_posts'])
        self.assertEqual(0, row['details']['replied_ok'])
        self.assertEqual(1, row['details']['chat_guard'])

    def test_batch_events_and_handoff_ack_are_counted_once(self):
        self.logs(self.post(), self.incoming(), self.success(), self.incoming(),
                  '[Handoff] push owner=SYNTHETIC success=True', self.success())
        row = self.night()
        self.assertEqual('pass', row['status'])
        self.assertEqual(2, row['details']['received'])
        self.assertEqual(2, row['details']['replied_ok'])
        self.assertEqual(0, row['details']['to_staff'])
        self.assertEqual(1, row['details']['handoff_push_ok'])

    def test_staff_push_without_reply_can_answer_but_failure_cannot(self):
        self.logs(self.post(), self.incoming(), '[Handoff] push owner=SYNTHETIC success=True')
        self.assertEqual(1, self.night()['details']['to_staff'])
        self.assertEqual('pass', self.night()['status'])
        self.logs(self.post(), self.incoming(), '[Handoff] push owner=SYNTHETIC success=False', self.success())
        self.assertEqual('fail', self.night()['status'])

    def test_reply_failures_stay_red_even_with_a_success(self):
        self.logs(self.post(), self.incoming(), '[ERROR] Failed to send LINE reply: SYNTHETIC', self.success())
        self.assertEqual('fail', self.night()['status'])
        self.assertEqual(1, self.night()['details']['reply_failed'])

    def test_stderr_mirror_never_double_counts_identical_events(self):
        self.logs(self.post(), self.incoming(), self.success())
        self.logs(self.post(), self.incoming(), self.success(), name='webhook_server.err.log')
        self.assertEqual('pass', self.night()['status'])
        self.assertEqual(1, self.night()['details']['received'])
        self.assertEqual(1, self.night()['details']['replied_ok'])
        (self.root / 'logs/webhook_server.log').unlink()
        self.assertEqual('no_data', self.night()['status'])

    def test_text_cannot_inject_a_marker_and_no_payload_is_emitted(self):
        self.logs(self.post(), self.incoming() + self.success() + '[Handoff] push owner=PRIVATE success=True')
        row = self.night()
        self.assertEqual('fail', row['status'])
        self.assertNotIn('SYNTHETIC', json.dumps(row))
        self.assertNotIn('PRIVATE', json.dumps(row))

    def test_paused_turn_is_unmeasured_without_owner_delivery(self):
        self.logs(self.post(), self.incoming(), '[Handoff] paused user=SYNTHETIC until=23:00')
        self.assertEqual('no_data', self.night()['status'])
        self.assertEqual(1, self.night()['details']['received'])
        self.logs(self.post(), '[Handoff] paused user=SYNTHETIC until=23:00')
        self.assertEqual('no_data', self.night()['status'])
        self.assertEqual(1, self.night()['details']['received'])

    def test_ping_duplicate_get_rejected_post_and_wrong_day_never_inflate_replies(self):
        self.logs('[Webhook] "GET / HTTP/1.1" - 200',
                  '[Webhook] "POST /line/webhook HTTP/1.1" - 400', self.post(),
                  '[Webhook] Received LINE test webhook verification ping. Skipping dummy token.',
                  '[Webhook] Duplicate replyToken received: SYNTHETIC..., ignoring.')
        row = self.night()
        self.assertEqual('no_data', row['status'])
        self.assertIsNone(row['details']['received'])
        self.logs(self.post(), self.incoming(), self.success(), day=DAY - timedelta(days=1))
        self.assertEqual('no_data', self.night()['status'])
        self.assertEqual('no_data', s.night_counts(DAY, self.root / 'missing')['status'])

    def test_missing_shop_half_stays_null_and_failure_dominates_missing(self):
        self.logs(self.post(), self.incoming(), self.success())
        row = s.accounting(DAY, self.root / 'logs', self.root / 'missing', NOW)
        self.assertEqual('no_data', row['status'])
        self.assertIsNone(row['details']['received'])
        self.assertEqual('pass', row['subchecks']['night']['status'])
        self.logs(self.post(), self.incoming(), '[ERROR] Failed to send LINE reply: SYNTHETIC')
        self.assertEqual('fail', s.accounting(DAY, self.root / 'logs', self.root / 'missing', NOW)['status'])

    def test_shop_schema_complete_disjoint_nonnegative_counts_and_time(self):
        self.assertEqual('pass', s.shop_counts(DAY, self.shop_receipt(), NOW)['status'])
        for change in (dict(complete=False), dict(received=True), dict(reply_failed=False),
                       dict(schema='wrong'), dict(replied_ok=3), dict(reply_failed=-1),
                       dict(date='2026-11-12'), dict(generated_at='2026-11-14T00:00:00+08:00'),
                       dict(customer_text='SYNTHETIC'), dict(window='unknown')):
            with self.subTest(change=change):
                row = s.shop_counts(DAY, self.shop_receipt(**change), NOW)
                self.assertEqual('no_data', row['status'])
                self.assertNotIn('SYNTHETIC', json.dumps(row))
        self.assertEqual('fail', s.shop_counts(DAY, self.shop_receipt(replied_ok=0), NOW)['status'])


class EvidenceTests(Fixtures):
    def test_required_shop_groups_reject_legacy_wrong_runtime_skips_and_missing_suite(self):
        value, runtime = self.receipt()
        self.assertEqual('pass', self.evaluate_receipt(value, runtime)['status'])
        for key, change in [('schema', 'level1-offline-checks/v1'), ('mode', 'smoke'), ('offline', False),
                            ('source_runtime', 'SYNTHETIC OTHER'), ('elapsed_seconds', 301),
                            ('generated_at', '2026-11-12T23:00:00+08:00')]:
            bad = {**value, key: change}
            self.assertEqual('no_data', self.evaluate_receipt(bad, runtime)['status'])
        bad = copy.deepcopy(value)
        bad['checks']['facts']['suites'].pop()
        self.assertEqual('no_data', self.evaluate_receipt(bad, runtime)['status'])
        bad = copy.deepcopy(value)
        bad['checks']['facts']['suites'][0]['skipped'] = 1
        self.assertEqual('no_data', self.evaluate_receipt(bad, runtime)['status'])
        bad['checks']['facts']['suites'][0].update(status='fail', failures=1)
        self.assertEqual('fail', self.evaluate_receipt(bad, runtime)['status'])

    def test_changed_live_code_invalidates_same_day_receipt(self):
        value, runtime = self.receipt()
        (runtime / 'runtime/webhook_server.py').write_text('# CHANGED', encoding='utf-8')
        self.assertEqual('no_data', self.evaluate_receipt(value, runtime)['status'])

    def test_base_red_is_visible_not_pass_and_changed_shape_or_bytes_fail(self):
        value, runtime = self.receipt()
        suites = value['checks']['facts']['suites']
        for name, spec in s.BASE_RED.items():
            index = next(i for i, row in enumerate(suites) if row['suite'] == name)
            suites[index] = dict(suite=name, status='pre_existing', test_sha256=spec[0],
                                 tests=spec[1], failures=spec[2], errors=spec[3], skipped=0,
                                 failed_tests=list(spec[4]), diagnostic=spec[5], exit_code=1)
        row = self.evaluate_receipt(value, runtime)
        self.assertEqual('pass', row['status'])
        self.assertEqual(2 * len(s.GROUPS['facts']), row['details']['tests'])
        self.assertIn('既有缺檔/舊斷言', row['reason'])
        for key, change in [('test_sha256', 'changed'), ('errors', 99), ('failed_tests', ['test_new']), ('diagnostic', 'changed')]:
            bad = copy.deepcopy(value)
            item = next(r for r in bad['checks']['facts']['suites'] if r['suite'] in s.BASE_RED)
            item[key] = change
            self.assertEqual('fail', self.evaluate_receipt(bad, runtime)['status'])

    def test_current_checklist_uses_shop_readers_but_6_to_12_stay_identical(self):
        paths = lg.Paths(self.root, mdb_log=self.root / 'missing')
        with mock.patch.object(s, 'accounting', return_value={'status': 'no_data'}) as accounting, \
             mock.patch.object(s, 'test_evidence', return_value={'status': 'pass'}) as tests:
            current = lg.evaluate_checklist(DAY, paths, None, None, NOW)
        accounting.assert_called_once()
        self.assertEqual(['facts', 'flows', 'handoff'], [c.args[2] for c in tests.call_args_list])
        self.assertEqual('not_ready', current['11']['status'])
        # Same day and inputs; switch source cutover only to compare untouched items.
        with mock.patch.object(s, 'CUTOVER', DAY + timedelta(days=1)):
            legacy = lg.evaluate_checklist(DAY, paths, None, None, NOW)
        self.assertEqual({k: current[k] for k in map(str, range(6, 13))},
                         {k: legacy[k] for k in map(str, range(6, 13))})

    def test_partial_day_cannot_count_as_a_complete_day(self):
        row = dict(rules_version=lg.RULES_VERSION, partial_day=True,
                   checklist={k: {'status': 'pass'} for k in lg.CHECKLIST_TITLES}, incidents={'status': 'pass'})
        self.assertFalse(lg._day_passed(row))


class IsolatedRunnerTests(Fixtures):
    def make_sources(self):
        live, accepted = self.root / 'live', self.root / 'accepted'
        self.write('live/runtime/webhook_server.py', '# CURRENT CODE\n')
        self.write('live/runtime/fact_answers.py', '# LIVE\n')
        self.write('accepted/runtime/fact_answers.py', '# OLD\n')
        self.write('live/shop.json', '{}')
        for name in ('data/customer.py', 'logs/customer.py', 'secrets/key.py', '.env'):
            self.write('live/' + name, 'SYNTHETIC PRIVATE')
        self.write('live/config/data/private.py', 'SYNTHETIC PRIVATE')
        for name in set(n for names in s.GROUPS.values() for n in names) | set(s.BASE_RED):
            self.write(('live/' if name.startswith('runtime/') else 'accepted/') + name, UNIT)
        return live, accepted

    def test_snapshot_copies_current_code_not_private_data_or_old_runtime(self):
        live, accepted = self.make_sources()
        target = self.root / 'snapshot'
        manifest, tests = s.snapshot_shop(live, accepted, target, s.time.monotonic() + 10)
        self.assertEqual('# LIVE\n', (target / 'runtime/fact_answers.py').read_text())
        self.assertIn('runtime/webhook_server.py', manifest)
        for name in ('data', 'logs', 'secrets', '.env'):
            self.assertFalse((target / name).exists())
        self.assertFalse((target / 'config/data/private.py').exists())
        self.assertTrue(set(s.GROUPS['facts']) <= tests.keys())
        with self.assertRaises(TimeoutError):
            s.snapshot_shop(live, accepted, self.root / 'late', 0)

    def test_real_per_file_runner_blocks_network_and_live_reads_writes(self):
        tree = self.root / 'tree'
        body = '''import sys, unittest
class Isolation(unittest.TestCase):
 def test_guards(self):
  for event, args in [('socket.connect', (None, ('203.0.113.1', 443))),
                      ('open', ('C:/LaundryStores/fxwash/SYNTHETIC', 'r', 0)),
                      ('open', ('C:/SYNTHETIC_L1_OUTSIDE', 'w', 0)),
                      ('os.remove', ('C:/SYNTHETIC_L1_OUTSIDE', -1))]:
   with self.assertRaises(PermissionError): sys.audit(event, *args)
if __name__ == '__main__': unittest.main()
'''
        self.write('tree/tests/test_isolation.py', body)
        row = s.run_suite(tree, 'tests/test_isolation.py', 10)
        self.assertEqual('pass', row['status'], row)
        self.assertEqual(1, row['tests'])

    def test_zero_cases_and_skips_are_not_a_green_suite(self):
        tree = self.root / 'tree'
        partial_skip = UNIT.replace("if __name__ == '__main__':", " def test_second(self): self.skipTest('SYNTHETIC')\nif __name__ == '__main__':")
        for body in ('print("OK")', UNIT.replace('self.assertTrue(True)', 'self.skipTest("SYNTHETIC")'), partial_skip):
            self.write('tree/tests/test_probe.py', body)
            self.assertEqual('no_data', s.run_suite(tree, 'tests/test_probe.py', 10)['status'])

    def test_real_timeout_stops_single_guarded_worker(self):
        tree = self.root / 'tree'
        self.write('tree/tests/test_slow.py', 'import time\ntime.sleep(20)\n')
        started = s.time.monotonic()
        row = s.run_suite(tree, 'tests/test_slow.py', 0.3)
        self.assertEqual('no_data', row['status'])
        self.assertEqual('TimeoutExpired', row['runner_error'])
        self.assertLess(s.time.monotonic() - started, 8)

    def test_manifest_cannot_redirect_reader_to_customer_or_secret_files(self):
        value, runtime = self.receipt()
        self.write('runtime/secrets/key.json', 'SYNTHETIC PRIVATE')
        secret = runtime / 'secrets/key.json'
        value['source_manifest']['secrets/key.json'] = s.digest(secret)
        with mock.patch.object(s, 'digest', wraps=s.digest) as digest:
            self.assertEqual('no_data', self.evaluate_receipt(value, runtime)['status'])
        self.assertNotIn(secret, [c.args[0] for c in digest.call_args_list])

    def test_snapshot_rejects_a_link_before_reading_source_bytes(self):
        src = self.write('live/runtime/probe.py', '# SYNTHETIC\n')
        with mock.patch.object(Path, 'is_junction', return_value=True), mock.patch.object(s, 'digest') as digest:
            with self.assertRaises(ValueError):
                s.copy_file(src, self.root / 'copy', s.time.monotonic() + 10)
        digest.assert_not_called()

    def test_producer_uses_shop_snapshot_and_has_300_second_budget(self):
        live, accepted = self.make_sources()
        calls = []
        def run(tree, name, timeout):
            self.assertTrue(tree.is_relative_to(self.root / 'work'))
            self.assertLessEqual(timeout, 30)
            self.assertEqual('# LIVE\n', (tree / 'runtime/fact_answers.py').read_text())
            calls.append(name)
            return {**PASS, 'suite': name}
        before = s.digest(live / 'runtime/fact_answers.py')
        with mock.patch.object(s, 'run_suite', side_effect=run), mock.patch.object(offline, 'create_snapshot', side_effect=AssertionError('git archive forbidden')):
            path = offline.produce(self.root / 'repo', self.root / 'out', now=NOW,
                                   work_root=self.root / 'work', live=live, accepted=accepted)
        row = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(300, row['budget_seconds'])
        self.assertEqual('level1-shop-checks/v2', row['schema'])
        self.assertEqual(set(n for names in s.GROUPS.values() for n in names) | set(s.BASE_RED), set(calls))
        self.assertEqual(before, s.digest(live / 'runtime/fact_answers.py'))
        self.assertEqual('pass', s.test_evidence(DAY, path, 'facts', NOW, live)['status'])


class RealRuntimeShapeTests(Fixtures):
    """Commander 11/13: fixtures must use the line shapes the live runtime really writes."""

    def runtime_source(self):
        for root in (s.LIVE, s.ACCEPTED):
            path = Path(root) / 'runtime/webhook_server.py'
            if path.is_file():
                return path.read_text(encoding='utf-8', errors='replace')
        self.fail('no runtime webhook_server.py to read the real log shapes from')

    def test_post_line_matches_runtime_log_message(self):
        src = self.runtime_source()
        self.assertIn('print(f"[Webhook] {args[0]} - {args[1]}"', src)
        # BaseHTTPRequestHandler passes the bare requestline as args[0] and the code as args[1].
        line = '[Webhook] {} - {}'.format('POST /line/webhook HTTP/1.1', '200')
        self.assertRegex(line, s.POST)
        self.assertRegex('[Webhook] "POST /line/webhook HTTP/1.1" - 200', s.POST)

    def test_text_and_reply_markers_match_runtime_prints(self):
        src = self.runtime_source()
        self.assertIn('print(f"[Webhook Text] User {user_id[:8]}...: ', src)
        self.assertIn('print(f"[Webhook Reply Success] HTTP {resp.status}")', src)

    def test_unquoted_real_shape_is_counted(self):
        self.logs('[Webhook] POST /line/webhook HTTP/1.1 - 200', self.incoming(), self.success())
        row = self.night()
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['inbound_posts'])
        self.assertEqual(1, row['details']['replied_ok'])


if __name__ == '__main__':
    unittest.main()
