"""L1GATE-r6: exact runtime shapes, with synthetic payloads and distinct IDs."""
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import level1_gates as gates
import level1_shop as shop

DAY = date(2026, 11, 12)
TEXT = "[Webhook Text] User U2468ace...: 'SYNTHETIC ONLY'"
OTHER = "[Webhook Text] User U1357bdf...: 'SYNTHETIC ONLY'"
POST = '[Webhook] POST /line/webhook HTTP/1.1 - 200'
ONBOARD = '[Onboarding] lookup_by_phone note: SYNTHETIC'
BINDING = '[Binding Saved] User: U2468ace... -> CID: SYNTHETIC, Phone: SYNTHETIC, Name: SYNTHETIC'
OK = '[Webhook Reply Success] HTTP 200'
FAIL = '[ERROR] Failed to send LINE reply: HTTP Error 400: Bad Request'
ONBOARD_OK = '[Onboarding Reply Success] HTTP 200'
ONBOARD_FAIL = '[ERROR] Failed to send onboarding reply: HTTP Error 400: Bad Request'
STAFF = '[Chat Guard] STAFF reason=staff user=U2468ace...'
PUSH = '[Handoff] push owner=U7654321 success=True'
PUSH_FAIL = '[Handoff] push owner=U7654321 success=False'
PAUSED = '[Handoff] paused user=U2468ace until=13:00'


class RoutingR6(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def source(self, rows, origin=datetime(2026, 11, 12, 11)):
        path = self.root / 'synced/logs/webhook_server.log'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(''.join(f'{origin + timedelta(seconds=offset):%Y-%m-%d %H:%M:%S} {body}\n'
                                for offset, body in rows), encoding='utf-8')
        return path

    def count(self, rows, **kwargs):
        return shop.reply_log_counts(DAY, [self.source(rows)], **kwargs)

    def handoff(self, outcome=PUSH):
        return [(0, TEXT), (0, STAFF), (1, outcome), (2, OK), (3, POST)]

    def test_2213_onboarding_cannot_eat_three_2215_webhook_replies(self):
        row = self.count([(0, TEXT), (1, ONBOARD), (14, TEXT), (15, ONBOARD),
                          (29, TEXT), (30, BINDING), (113, TEXT), (117, OTHER),
                          (119, TEXT), (120, STAFF), (121, POST), (122, POST),
                          (123, OK), (129, OK), (130, OK)])
        self.assertEqual((6, 3, 3, 0, 0, 1), tuple(row['details'][key] for key in
                         ('received', 'replied_ok', 'unverified_onboarding',
                          'unanswered_silent', 'unanswered_guard', 'guard_replied_ok')))
        self.assertEqual('no_data', row['status'])

    def test_webhook_failure_skips_onboarding_backlog(self):
        row = self.count([(0, TEXT), (1, ONBOARD), (2, OTHER), (3, POST), (4, FAIL)])
        self.assertEqual((1, 1, 1, 0), tuple(row['details'][key] for key in
                         ('reply_failed', 'unverified_onboarding',
                          'unanswered_reply_failed', 'unanswered_silent')))

    def test_onboarding_terminals_skip_webhook_events(self):
        for terminal in (ONBOARD_OK, ONBOARD_FAIL):
            with self.subTest(terminal=terminal):
                row = self.count([(0, OTHER), (1, TEXT), (2, BINDING),
                                  (3, POST), (4, terminal), (5, OK)])
                self.assertEqual(0, row['details']['unanswered_silent'])
                self.assertEqual(0, row['details']['unverified_onboarding'])
                self.assertEqual(2 if terminal == ONBOARD_OK else 1, row['details']['replied_ok'])

    def test_orphan_onboarding_terminal_cannot_answer_unmarked_webhook(self):
        for terminal in (ONBOARD_OK, ONBOARD_FAIL):
            with self.subTest(terminal=terminal):
                row = self.count([(0, TEXT), (1, POST), (2, terminal)])
                self.assertEqual(0, row['details']['replied_ok'])
                self.assertEqual(0, row['details']['reply_failed'])
                self.assertEqual(1, row['details']['unanswered_silent'])

    def test_route_fifo_failure_stays_terminal(self):
        row = self.count([(0, TEXT), (1, ONBOARD), (2, TEXT), (3, ONBOARD),
                          (4, OTHER), (5, POST), (6, ONBOARD_FAIL), (7, OK), (8, ONBOARD_OK)])
        self.assertEqual((2, 1, 1, 0), tuple(row['details'][key] for key in
                         ('replied_ok', 'reply_failed', 'unanswered_reply_failed', 'unanswered_silent')))

    def test_summary_cards_do_not_handle_or_fail_a_customer_turn(self):
        for card in ('delivery', 'instore', 'unknown'):
            for success in ('True', 'False'):
                with self.subTest(card=card, success=success):
                    marker = f'[OwnerNotify] Pushed {card} card to owner U7654321... success={success}'
                    row = self.count([(0, TEXT), (1, STAFF), (2, OTHER), (3, TEXT),
                                      (4, POST), (5, marker)])
                    self.assertEqual((0, 0, 0, 1, 2), tuple(row['details'][key] for key in
                                     ('to_staff', 'handoff_push_ok', 'handoff_push_failed',
                                      'unanswered_guard', 'unanswered_silent')))

    def test_explicit_staff_cards_can_handle_but_do_not_prove_a_pause(self):
        for card in ('staff', 'handoff'):
            with self.subTest(card=card):
                marker = f'[OwnerNotify] Pushed {card} card to owner U7654321... success=True'
                row = self.count([(0, TEXT), (1, STAFF), (2, marker), (3, POST),
                                  (3600, TEXT), (3601, PAUSED), (3602, POST)])
                self.assertEqual(1, row['details']['to_staff'])
                self.assertEqual(0, row['details'].get('to_staff_paused', 0))
                self.assertEqual(1, row['details']['unanswered_paused'])

    def test_successful_same_customer_handoff_proves_later_paused_text(self):
        row = self.count(self.handoff() + [(3600, TEXT), (3601, PAUSED), (3602, POST)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((2, 1, 0, 1, 0, 0), tuple(row['details'].get(key) for key in
                         ('received', 'replied_ok', 'to_staff', 'to_staff_paused',
                          'unanswered', 'ambiguous')))

    def test_handoff_push_and_ack_belong_to_same_turn(self):
        row = self.count(self.handoff())
        self.assertEqual('pass', row['status'])
        self.assertEqual((1, 1, 0, 0), tuple(row['details'][key] for key in
                         ('received', 'replied_ok', 'to_staff', 'unattributed_events')))

    def test_paused_image_has_its_own_turn_after_handoff(self):
        row = self.count(self.handoff() + [(30, PAUSED), (31, POST)])
        self.assertEqual((2, 1, 1, 0), tuple(row['details'].get(key) for key in
                         ('received', 'replied_ok', 'to_staff_paused', 'unanswered')))

    def test_missing_failed_other_customer_or_owner_prefix_is_not_pause_proof(self):
        for handoff in ([(0, TEXT), (0, STAFF), (1, OK), (2, POST)],
                        self.handoff(PUSH_FAIL),
                        [(offset, body.replace('U2468ace', 'U1357bdf')) for offset, body in self.handoff()],
                        [(offset, body.replace('U2468ace', 'U7654321')) for offset, body in self.handoff()]):
            with self.subTest(handoff=handoff):
                row = self.count(handoff + [(3600, TEXT), (3601, PAUSED), (3602, POST)])
                self.assertEqual(0, row['details'].get('to_staff_paused', 0))
                self.assertEqual(1, row['details']['unanswered_paused'])
                self.assertNotEqual('pass', row['status'])

    def test_non_staff_or_mismatched_staff_guard_cannot_prove_pause(self):
        for guard in ('[Chat Guard] AI reply rejected (synthetic); using non-AI reply',
                      STAFF.removesuffix('...'),
                      STAFF.replace('U2468ace', 'U1357bdf')):
            with self.subTest(guard=guard):
                rows = [(offset, guard if body == STAFF else body) for offset, body in self.handoff()]
                row = self.count(rows + [(3600, TEXT), (3601, PAUSED), (3602, POST)])
                self.assertEqual(0, row['details'].get('to_staff_paused', 0))
                self.assertEqual(1, row['details']['unanswered_paused'])

    def test_pause_is_half_open_bounded_to_two_hours(self):
        for delay, expected in ((7199, 1), (7200, 0), (7201, 0), (10800, 0)):
            with self.subTest(delay=delay):
                row = self.count(self.handoff() + [(delay, TEXT), (delay, PAUSED), (delay + 1, POST)])
                self.assertEqual(expected, row['details'].get('to_staff_paused', 0))
                self.assertEqual(1 - expected, row['details']['unanswered_paused'])

    def test_until_must_belong_to_this_handoff_and_have_exact_runtime_shape(self):
        for marker in (PAUSED.replace('13:00', '14:00'), PAUSED.replace('13:00', '99:99'),
                       PAUSED + ' trailing'):
            with self.subTest(marker=marker):
                row = self.count(self.handoff() + [(3600, TEXT), (3601, marker), (3602, POST)])
                self.assertEqual(0, row['details'].get('to_staff_paused', 0))
                self.assertNotEqual('pass', row['status'])

    def test_pause_without_text_and_without_origin_stays_no_data(self):
        row = self.count([(0, PAUSED), (1, POST)])
        self.assertEqual('no_data', row['status'])
        self.assertEqual((1, 0, 1), tuple(row['details'].get(key) for key in
                         ('received', 'to_staff_paused', 'unanswered_paused')))

    def test_paused_turn_cannot_eat_next_webhook_reply(self):
        row = self.count(self.handoff() + [(3600, TEXT), (3601, PAUSED),
                                          (3602, OTHER), (3603, POST), (3604, OK)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((3, 2, 1, 0), tuple(row['details'].get(key) for key in
                         ('received', 'replied_ok', 'to_staff_paused', 'unanswered')))

    def test_interleaved_customer_texts_reuse_same_prefix_pending_pause(self):
        row = self.count(self.handoff() + [(3600, TEXT), (3601, OTHER), (3602, PAUSED),
                                          (3603, OK), (3604, POST), (3605, POST)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((3, 2, 1, 0), tuple(row['details'][key] for key in
                         ('received', 'replied_ok', 'to_staff_paused', 'unanswered')))

    def test_two_paused_texts_same_prefix_consume_two_oldest_open_turns(self):
        row = self.count(self.handoff() + [(3600, TEXT), (3601, TEXT), (3602, PAUSED),
                                          (3603, PAUSED), (3604, POST), (3605, POST)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((3, 1, 2, 0), tuple(row['details'][key] for key in
                         ('received', 'replied_ok', 'to_staff_paused', 'unanswered')))

    def test_origin_waiting_for_ack_is_not_reused_as_paused_image_or_text(self):
        for incoming in ([], [(2, TEXT)]):
            with self.subTest(incoming=incoming):
                row = self.count([(0, TEXT), (0, STAFF), (1, PUSH)] + incoming +
                                  [(2, PAUSED), (3, OK), (4, POST), (5, POST)])
                self.assertEqual('pass', row['status'])
                self.assertEqual((2, 1, 1, 0), tuple(row['details'][key] for key in
                                 ('received', 'replied_ok', 'to_staff_paused', 'unanswered')))

    def test_onboarding_backlog_is_not_reused_as_a_later_paused_text(self):
        row = self.count([(0, TEXT), (1, ONBOARD), (2, TEXT), (3, STAFF), (4, PUSH), (5, OK),
                          (6, POST), (30, TEXT), (31, PAUSED), (32, POST)])
        self.assertEqual('no_data', row['status'])
        self.assertEqual((3, 1, 1, 1, 0), tuple(row['details'][key] for key in
                         ('received', 'replied_ok', 'to_staff_paused',
                          'unverified_onboarding', 'unanswered_silent')))

    def test_unproven_pause_also_cannot_eat_next_webhook_reply(self):
        row = self.count([(0, TEXT), (1, PAUSED), (2, OTHER), (3, POST), (4, OK)])
        self.assertEqual((1, 0, 1, 0), tuple(row['details'][key] for key in
                         ('replied_ok', 'to_staff_paused', 'unanswered_paused', 'unanswered_silent')))

    def test_ack_before_push_does_not_turn_the_push_into_another_turn(self):
        row = self.count([(0, TEXT), (0, STAFF), (1, OK), (2, PUSH), (3, POST),
                          (3600, TEXT), (3601, PAUSED), (3602, POST)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((1, 1, 0), tuple(row['details'][key] for key in
                         ('replied_ok', 'to_staff_paused', 'unattributed_events')))

    def test_multiple_owner_recipients_do_not_consume_an_unrelated_event(self):
        row = self.count([(0, TEXT), (0, STAFF), (1, PUSH),
                          (2, PUSH.replace('U7654321', 'Uabcdef0')), (3, OK),
                          (4, OTHER), (5, OK), (6, POST)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((2, 0, 1), tuple(row['details'][key] for key in
                         ('replied_ok', 'to_staff', 'handoff_push_ok')))

    def test_pause_origin_before_shop_open_is_context_only(self):
        source = self.source(self.handoff() + [(3600, TEXT),
                             (3601, PAUSED.replace('13:00', '11:30')), (3602, POST)],
                             origin=datetime(2026, 11, 12, 9, 30))
        row = shop.reply_log_counts(DAY, [source], 10, 20)
        self.assertEqual('pass', row['status'])
        self.assertEqual((1, 0, 1), tuple(row['details'][key] for key in
                         ('received', 'replied_ok', 'to_staff_paused')))

    def test_pause_proof_survives_midnight_without_cross_day_reply_matching(self):
        source = self.source(self.handoff() + [(3600, TEXT), (3601, PAUSED.replace('13:00', '01:30')),
                                               (3602, POST)], origin=datetime(2026, 11, 11, 23, 30))
        row = shop.reply_log_counts(DAY, [source])
        self.assertEqual('pass', row['status'])
        self.assertEqual((1, 0, 1, 0), tuple(row['details'].get(key) for key in
                         ('received', 'replied_ok', 'to_staff_paused', 'unanswered')))

    def test_two_unresolved_handoffs_cannot_assign_an_identity_free_push(self):
        row = self.count([(0, TEXT), (1, STAFF), (2, OTHER),
                          (3, STAFF.replace('U2468ace', 'U1357bdf')), (4, PUSH), (5, POST),
                          (3600, TEXT), (3601, PAUSED), (3602, POST)])
        self.assertEqual(0, row['details'].get('to_staff_paused', 0))
        self.assertNotEqual('pass', row['status'])

    def test_competing_guardless_onboarding_blocks_staff_prefix_pause_proof(self):
        row = self.count([(0, TEXT), (1, STAFF), (2, OTHER), (3, ONBOARD), (4, PUSH),
                          (5, OK), (6, ONBOARD_OK), (7, POST), (8, POST),
                          (3600, TEXT), (3601, PAUSED), (3602, POST)])
        self.assertEqual('no_data', row['status'])
        self.assertEqual((3, 2, 0, 1, 0), tuple(row['details'][key] for key in
                         ('received', 'replied_ok', 'to_staff_paused',
                          'unanswered_paused', 'unanswered_silent')))
        self.assertGreater(row['details']['ambiguous'], 0)

    def test_unique_guardless_onboarding_handoff_and_ack_prove_same_prefix_pause(self):
        row = self.count([(0, TEXT), (1, ONBOARD), (2, PUSH), (3, ONBOARD_OK), (4, POST),
                          (3600, TEXT), (3601, PAUSED), (3602, POST)])
        self.assertEqual('pass', row['status'])
        self.assertEqual((2, 1, 1, 0), tuple(row['details'][key] for key in
                         ('received', 'replied_ok', 'to_staff_paused', 'unattributed_events')))

    def test_later_owner_recipient_push_after_ack_cannot_become_another_customers_handoff(self):
        for marker, ack in ((STAFF, OK), (ONBOARD, ONBOARD_OK)):
            with self.subTest(origin=marker):
                row = self.count([(0, TEXT), (0, marker), (1, PUSH), (2, ack), (3, OTHER),
                                  (4, PUSH.replace('U7654321', 'Uabcdef0')), (5, OK),
                                  (6, POST), (7, POST), (3600, OTHER),
                                  (3601, PAUSED.replace('U2468ace', 'U1357bdf')), (3602, POST)])
                self.assertEqual('no_data', row['status'])
                self.assertEqual((3, 2, 0, 1, 0), tuple(row['details'][key] for key in
                                 ('received', 'replied_ok', 'to_staff_paused',
                                  'unanswered_paused', 'unanswered_silent')))
                self.assertGreater(row['details']['ambiguous'], 0)

    def test_new_handoff_failure_cannot_reuse_previous_pause_success(self):
        rows = self.handoff() + [(1800, TEXT), (1801, STAFF), (1802, PUSH_FAIL), (1803, OK),
                                 (1804, POST), (3600, TEXT),
                                 (3601, PAUSED.replace('13:00', '13:30')), (3602, POST)]
        row = self.count(rows)
        self.assertEqual(0, row['details'].get('to_staff_paused', 0))
        self.assertEqual(1, row['details']['unanswered_paused'])

    def test_proven_pause_is_kept_separate_in_shop_receipt_and_accounting(self):
        source = self.source(self.handoff() + [(3600, TEXT), (3601, PAUSED), (3602, POST)])
        now = datetime(2026, 11, 13, 10, 5, tzinfo=shop.TAIPEI)
        receipt = shop.produce_shop_replies(DAY, source, self.root / 'receipt.json',
                                            now=now, coverage_complete=True)
        data = json.loads(receipt.read_text(encoding='utf-8'))
        self.assertEqual(1, data.get('to_staff_paused'))
        scored = shop.shop_counts(DAY, receipt, now)
        self.assertEqual('pass', scored['status'])
        self.assertEqual(0, scored['details']['unanswered'])
        with mock.patch.object(shop, 'night_counts', return_value=scored):
            combined = shop.accounting(DAY, self.root, receipt, now)
        self.assertEqual(2, combined['details'].get('to_staff_paused'))

    def test_legacy_receipt_has_zero_pauses_and_invalid_new_count_is_rejected(self):
        now = datetime(2026, 11, 13, 10, 5, tzinfo=shop.TAIPEI)
        path = self.root / 'receipt.json'
        data = dict(schema='shop-replies/v1', date=str(DAY), generated_at=now.isoformat(),
                    complete=True, window='shop_day', received=2, replied_ok=2,
                    reply_failed=0, to_staff=0, no_reply_needed=0)
        path.write_text(json.dumps(data), encoding='utf-8')
        scored = shop.shop_counts(DAY, path, now)
        self.assertEqual('pass', scored['status'])
        self.assertEqual(0, scored['details']['to_staff_paused'])
        for value in (True, -1, '1', None, 1):
            with self.subTest(value=value):
                path.write_text(json.dumps(dict(data, to_staff_paused=value)), encoding='utf-8')
                self.assertEqual('no_data', shop.shop_counts(DAY, path, now)['status'])

    def test_old_rule_cache_is_invalidated(self):
        old = dict(rules_version=8, partial_day=False, incidents=dict(status='pass'),
                   checklist={key: dict(status='pass') for key in gates.CHECKLIST_TITLES})
        self.assertFalse(gates._day_passed(old))

    def test_no_customer_payload_or_prefix_is_emitted(self):
        row = self.count(self.handoff() + [(3600, TEXT), (3601, PAUSED), (3602, POST)])
        encoded = json.dumps(row)
        for private in ('U2468ace', 'U1357bdf', 'U7654321', 'SYNTHETIC ONLY', 'prefix_hash'):
            self.assertNotIn(private, encoded)


if __name__ == '__main__':
    unittest.main()
