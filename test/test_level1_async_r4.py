"""L1GATE-r4: synthetic events using exact current/proposed runtime print shapes."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import level1_shop as s
import level1_gates as lg

DAY = date(2026, 11, 12)
POST = '[Webhook] POST /line/webhook HTTP/1.1 - 200'
TEXT = "[Webhook Text] User U2468ace...: 'SYNTHETIC ONLY'"
TEXT2 = "[Webhook Text] User U1357bdf...: 'SYNTHETIC ONLY'"
IMAGE = '[Webhook Image] Received image 100 from U1357bdf...'
PROBE = "[Webhook Text] User UL1TEST_...: 'SYNTHETIC ONLY'"
OK = '[Webhook Reply Success] HTTP 200'
FAIL = '[ERROR] Failed to send LINE reply: HTTP Error 400: Bad Request'
GUARD = '[Chat Guard] AI reply rejected (synthetic); using non-AI reply'
OWNER_OK = '[OwnerNotify] Pushed staff card to owner U7654321... success=True'
OWNER_FAIL = '[OwnerNotify] Pushed staff card to owner U7654321... success=False'
ONBOARDING = '[Onboarding] lookup_by_phone note: SYNTHETIC'
BINDING = '[Binding Saved] User: U2468ace... -> CID: SYNTHETIC, Phone: SYNTHETIC, Name: SYNTHETIC'
ONBOARD_OK = '[Onboarding Reply Success] HTTP 200'
ONBOARD_FAIL = '[ERROR] Failed to send onboarding reply: HTTP Error 400: Bad Request'
FIVE_COUNTS = ('received', 'replied_ok', 'reply_failed', 'to_staff', 'no_reply_needed')


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def source(self, rows):
        path = self.root / 'synced/logs/webhook_server.log'
        path.parent.mkdir(parents=True, exist_ok=True)
        origin = datetime(2026, 11, 12, 11)
        path.write_text(''.join(f'{origin + timedelta(seconds=offset):%Y-%m-%d %H:%M:%S} {body}\n'
                                for offset, body in rows), encoding='utf-8')
        return path

    def counts(self, rows, day=DAY):
        return s.reply_log_counts(day, [self.source(rows)])


class AsyncMatching(Fixtures):
    def test_three_async_replies_consume_three_events_despite_post_end_lines(self):
        row = self.counts([(0, TEXT), (1, TEXT2), (2, IMAGE), (3, POST), (4, POST),
                           (5, POST), (60, OK), (61, OK), (62, OK)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((3, 3, 0, 0), tuple(row['details'][k] for k in
                         ('received', 'replied_ok', 'unanswered', 'unattributed_replied_ok')))

    def test_fifo_reply_answers_oldest_guard_event(self):
        row = self.counts([(0, TEXT), (1, GUARD), (2, TEXT2), (3, POST), (60, OK)])
        self.assertEqual(1, row['details']['guard_replied_ok'])
        self.assertEqual(1, row['details']['unanswered_silent'])
        self.assertEqual(0, row['details']['unanswered_guard'])

    def test_fifo_keeps_probe_reply_out_of_customer_denominator(self):
        row = self.counts([(0, PROBE), (1, TEXT), (2, POST), (60, OK)])
        self.assertEqual((1, 0, 1), tuple(row['details'][k] for k in
                         ('received', 'replied_ok', 'excluded_synthetic_events')))

    def test_failure_is_terminal_and_next_success_answers_next_event(self):
        row = self.counts([(0, TEXT), (1, TEXT2), (2, POST), (60, FAIL), (61, OK)])
        self.assertEqual('fail', row['status'])
        self.assertEqual((2, 1, 1, 1), tuple(row['details'][k] for k in
                         ('received', 'replied_ok', 'reply_failed', 'unanswered_reply_failed')))

    def test_reply_window_is_inclusive_at_180_seconds_and_expires_at_181(self):
        for delay, want_ok, want_unanswered in ((180, 1, 0), (181, 0, 1)):
            with self.subTest(delay=delay):
                row = self.counts([(0, TEXT), (1, POST), (delay, OK)])
                self.assertEqual(want_ok, row['details']['replied_ok'])
                self.assertEqual(want_unanswered, row['details']['unanswered_silent'])

    def test_expired_head_does_not_take_new_event_reply(self):
        row = self.counts([(0, TEXT), (1, GUARD), (2, POST), (181, TEXT2), (182, OK)])
        self.assertEqual((1, 1, 0), tuple(row['details'][k] for k in
                         ('replied_ok', 'unanswered_guard', 'unanswered_silent')))

    def test_never_matches_across_midnight_even_within_180_seconds(self):
        # Origin is 11:00; these are 23:59:59 D and 00:00:01 D+1.
        rows = [(46799, TEXT), (46799, POST), (46801, OK)]
        row = self.counts(rows)
        self.assertEqual((1, 0, 1), tuple(row['details'][k] for k in
                         ('received', 'replied_ok', 'unanswered_silent')))
        next_day = self.counts(rows, DAY + timedelta(days=1))
        self.assertIsNone(next_day['details']['received'])
        self.assertEqual(1, next_day['details']['unattributed_replied_ok'])

    def test_duplicate_mirror_copies_do_not_duplicate_async_events(self):
        source = self.source([(0, TEXT), (1, TEXT2), (2, POST), (60, OK), (61, OK)])
        mirror = self.root / 'mirror.log'
        mirror.write_bytes(source.read_bytes())
        row = s.reply_log_counts(DAY, [source, mirror])
        self.assertEqual((2, 2, 5), tuple(row['details'][k] for k in
                         ('received', 'replied_ok', 'duplicate_lines')))


class OwnerNotifications(Fixtures):
    def test_successful_explicit_staff_push_is_fifo_to_staff_evidence(self):
        row = self.counts([(0, TEXT), (1, GUARD), (2, TEXT2), (3, POST),
                           (60, OWNER_OK), (61, OK)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((1, 1, 1), tuple(row['details'][k] for k in
                         ('to_staff', 'replied_ok', 'guard_to_staff')))

    def test_failed_explicit_staff_push_never_answers_the_event(self):
        row = self.counts([(0, TEXT), (1, POST), (60, OWNER_FAIL)])
        self.assertEqual('fail', row['status'])
        self.assertEqual((0, 0, 1, 1), tuple(row['details'][k] for k in
                         ('to_staff', 'handoff_push_ok', 'handoff_push_failed', 'unanswered')))

    def test_late_explicit_staff_push_is_unattributed_and_cannot_answer(self):
        row = self.counts([(0, TEXT), (1, POST), (181, OWNER_OK)])
        self.assertEqual((0, 1, 1), tuple(row['details'][k] for k in
                         ('to_staff', 'unanswered_silent', 'unattributed_to_staff')))

    def test_marker_in_message_or_nonexact_push_shape_cannot_forge_delivery(self):
        for body in (TEXT + OWNER_OK, OWNER_OK + ' trailing',
                     '[OwnerNotify] Pushed instore card to owner U7654321 success=True'):
            with self.subTest(body=body):
                row = self.counts([(0, TEXT), (1, POST), (60, body)])
                self.assertEqual(0, row['details']['to_staff'])
                self.assertNotEqual('pass', row['status'])


class OnboardingEvidence(Fixtures):
    def test_unlogged_onboarding_reply_is_no_data_never_pass_or_fail(self):
        for activity in (ONBOARDING, BINDING):
            with self.subTest(activity=activity):
                row = self.counts([(0, TEXT), (1, POST), (2, activity)])
                self.assertEqual('no_data', row['status'])
                self.assertEqual((1, 0, 0, 1, 0), tuple(row['details'].get(k) for k in
                                 ('received', 'replied_ok', 'reply_failed',
                                  'unverified_onboarding', 'unanswered_silent')))

    def test_onboarding_success_marker_is_delivery(self):
        row = self.counts([(0, TEXT), (1, POST), (2, BINDING), (60, ONBOARD_OK)])
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['replied_ok'])
        self.assertEqual(0, row['details'].get('unverified_onboarding'))

    def test_binding_activity_after_confirmed_reply_does_not_remove_delivery_evidence(self):
        row = self.counts([(0, TEXT), (1, POST), (2, ONBOARDING), (60, ONBOARD_OK), (61, BINDING)])
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['replied_ok'])
        self.assertEqual(0, row['details']['unverified_onboarding'])

    def test_onboarding_failure_marker_is_failure(self):
        row = self.counts([(0, TEXT), (1, POST), (2, ONBOARDING), (60, ONBOARD_FAIL)])
        self.assertEqual('fail', row['status'])
        self.assertEqual((1, 0), tuple(row['details'][k] for k in ('reply_failed', 'replied_ok')))
        self.assertEqual(0, row['details'].get('unverified_onboarding'))

    def test_unverified_onboarding_cannot_hide_a_separate_silent_event(self):
        row = self.counts([(0, TEXT), (1, BINDING), (2, TEXT2), (3, POST)])
        self.assertEqual('fail', row['status'])
        self.assertEqual(1, row['details'].get('unverified_onboarding'))
        self.assertEqual(1, row['details']['unanswered_silent'])

    def test_activity_after_window_cannot_turn_a_silent_event_into_no_data(self):
        row = self.counts([(0, TEXT), (1, POST), (181, BINDING)])
        self.assertEqual('fail', row['status'])
        self.assertEqual(1, row['details']['unanswered_silent'])

    def test_onboarding_marker_in_customer_text_is_not_delivery(self):
        row = self.counts([(0, TEXT + ONBOARD_OK), (1, POST)])
        self.assertEqual('fail', row['status'])
        self.assertEqual(0, row['details']['replied_ok'])


class ShopReceiptContract(Fixtures):
    def test_last_shop_event_can_receive_its_async_reply_after_closing(self):
        source = self.source([(32399, TEXT), (32400, POST), (32459, OK)])
        path = s.produce_shop_replies(DAY, source, self.root / 'out/receipt.json',
                    now=datetime(2026, 11, 13, 10, 5, tzinfo=s.TAIPEI), coverage_complete=True)
        data = json.loads(path.read_text())
        self.assertEqual((1, 1), (data['received'], data['replied_ok']))
        self.assertEqual('pass', s.shop_counts(DAY, path,
                         datetime(2026, 11, 13, 23, 40, tzinfo=s.TAIPEI))['status'])

    def test_event_at_closing_is_excluded_even_if_reply_is_in_the_tail(self):
        source = self.source([(32300, TEXT), (32301, POST), (32302, OK),
                              (32400, TEXT2), (32401, POST), (32460, OK)])
        path = s.produce_shop_replies(DAY, source, self.root / 'out/receipt.json',
                    now=datetime(2026, 11, 13, 10, 5, tzinfo=s.TAIPEI), coverage_complete=True)
        data = json.loads(path.read_text())
        self.assertEqual((1, 1), (data['received'], data['replied_ok']))
        self.assertTrue(data['complete'])

    def test_missing_any_one_count_is_no_data_instead_of_defaulting_zero(self):
        for missing in FIVE_COUNTS:
            with self.subTest(missing=missing):
                receipt = dict(schema='shop-replies/v1', date=str(DAY),
                               generated_at='2026-11-13T10:05:00+08:00',
                               window='shop_day', complete=True, received=0, replied_ok=0,
                               reply_failed=0, to_staff=0, no_reply_needed=0)
                del receipt[missing]
                path = self.root / 'receipt.json'
                path.write_text(json.dumps(receipt), encoding='utf-8')
                self.assertEqual('no_data', s.shop_counts(DAY, path,
                                 datetime(2026, 11, 13, 23, 40, tzinfo=s.TAIPEI))['status'])

    def test_producer_writes_all_five_counts_even_for_attested_empty_day(self):
        for rows in ([], [(0, TEXT), (1, POST), (60, OK)]):
            with self.subTest(rows=rows):
                path = s.produce_shop_replies(DAY, self.source(rows), self.root / 'out/receipt.json',
                    now=datetime(2026, 11, 13, 10, 5, tzinfo=s.TAIPEI), coverage_complete=True)
                data = json.loads(path.read_text(encoding='utf-8'))
                self.assertTrue(set(FIVE_COUNTS) <= data.keys())
                self.assertTrue(all(type(data[k]) is int for k in FIVE_COUNTS))

    def test_producer_rejects_missing_parser_count_without_writing_receipt(self):
        source = self.source([(0, TEXT), (1, POST), (60, OK)])
        parsed = s.reply_log_counts(DAY, [source])
        for missing in FIVE_COUNTS:
            with self.subTest(missing=missing):
                damaged = dict(parsed, details=dict(parsed['details']))
                del damaged['details'][missing]
                target = self.root / f'out/{missing}.json'
                with mock.patch.object(s, 'reply_log_counts', return_value=damaged):
                    with self.assertRaises(ValueError):
                        s.produce_shop_replies(DAY, source, target,
                            now=datetime(2026, 11, 13, 10, 5, tzinfo=s.TAIPEI), coverage_complete=True)
                self.assertFalse(target.exists())

    def test_unverified_onboarding_cannot_be_certified_complete_by_v1_producer(self):
        path = s.produce_shop_replies(DAY, self.source([(0, TEXT), (1, POST), (2, BINDING)]),
                    self.root / 'out/receipt.json',
                    now=datetime(2026, 11, 13, 10, 5, tzinfo=s.TAIPEI), coverage_complete=True)
        self.assertFalse(json.loads(path.read_text())['complete'])
        self.assertEqual('no_data', s.shop_counts(DAY, path,
                         datetime(2026, 11, 13, 23, 40, tzinfo=s.TAIPEI))['status'])


class MorningSync(Fixtures):
    def producer(self):
        function = getattr(s, 'produce_shop_replies_from_morning_sync', None)
        self.assertTrue(callable(function), 'missing D+1 morning-sync receipt entry point')
        return function

    def test_next_morning_sync_produces_previous_day_receipt_including_late_shop_events(self):
        source = self.source([(-7200, TEXT), (0, TEXT), (1, POST), (60, OK),
                              (32340, TEXT2), (32341, POST), (32399, OK),
                              (86400, TEXT), (86401, POST)])
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        out = self.producer()(source, self.root / 'receipts',
                  synced_at=datetime(2026, 11, 13, 10, 5, tzinfo=s.TAIPEI), coverage_complete=True)
        data = json.loads(out.read_text(encoding='utf-8'))
        self.assertEqual('shop-replies-2026-11-12.json', out.name)
        self.assertEqual('2026-11-12', data['date'])
        self.assertEqual((2, 2), (data['received'], data['replied_ok']))
        self.assertTrue(data['complete'])
        self.assertEqual('pass', s.shop_counts(DAY, out,
                         datetime(2026, 11, 13, 23, 40, tzinfo=s.TAIPEI))['status'])
        self.assertEqual(before, hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual([source], list(source.parent.iterdir()))

    def test_morning_sync_requires_1005_or_later_and_aware_time(self):
        source = self.source([(0, TEXT), (1, POST), (60, OK)])
        function = self.producer()
        for synced_at in (datetime(2026, 11, 13, 10, 4, 59, tzinfo=s.TAIPEI),
                          datetime(2026, 11, 13, 10, 5)):
            with self.subTest(synced_at=synced_at), self.assertRaises(ValueError):
                function(source, self.root / 'receipts', synced_at=synced_at, coverage_complete=True)
        self.assertFalse((self.root / 'receipts').exists())

    def test_morning_sync_uses_taipei_day_and_requires_full_copy_attestation(self):
        source = self.source([(0, TEXT), (1, POST), (60, OK)])
        out = self.producer()(source, self.root / 'receipts',
                  synced_at=datetime(2026, 11, 13, 2, 5, tzinfo=timezone.utc))
        data = json.loads(out.read_text(encoding='utf-8'))
        self.assertEqual('2026-11-12', data['date'])
        self.assertFalse(data['complete'])

    def test_1945_evening_copy_cannot_certify_same_shop_day(self):
        out = s.produce_shop_replies(DAY, self.source([(0, TEXT), (1, POST), (60, OK)]),
                  self.root / 'out/receipt.json',
                  now=datetime(2026, 11, 12, 19, 45, tzinfo=s.TAIPEI), coverage_complete=True)
        self.assertFalse(json.loads(out.read_text())['complete'])


class RuleCache(unittest.TestCase):
    def test_previous_async_scoring_results_are_invalidated(self):
        previous = dict(rules_version=6, partial_day=False, incidents=dict(status='pass'),
                        checklist={key: dict(status='pass') for key in lg.CHECKLIST_TITLES})
        self.assertFalse(lg._day_passed(previous))


if __name__ == '__main__':
    unittest.main()
