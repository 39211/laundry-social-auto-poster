"""r3: synthetic payloads in the shapes printed by the actual shop runtime.

Source: runtime/webhook_server.py (POST, Text, Image, Reply, dummy, duplicate),
chat_service.py (Guard), staff_handoff.py (paused), instore_summary_service.py
(push). Sticker/follow/unfollow/postback have NO dedicated runtime log lines.
"""
from datetime import date, datetime, timedelta
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import level1_shop as s
import level1_gates as lg

DAY = date(2026, 11, 12)
POST = '[Webhook] POST /line/webhook HTTP/1.1 - 200'
OK = '[Webhook Reply Success] HTTP 200'
TEXT = "[Webhook Text] User U2468ace...: 'SYNTHETIC ONLY'"
# Proposed non-hex namespace: exact runtime shape, never a valid LINE user ID.
PROBE = "[Webhook Text] User UL1TEST_...: 'SYNTHETIC ONLY'"
GUARD = '[Chat Guard] AI reply rejected (synthetic); using non-AI reply'
FAIL = '[ERROR] Failed to send LINE reply: HTTP Error 400: Bad Request | {"message":"Invalid reply token"}'
PAUSE = '[Handoff] paused user=U2468ace until=2026-11-12 23:00'
PUSH = '[Handoff] push owner=U7654321 success=True'
PING = '[Webhook] Received LINE test webhook verification ping. Skipping dummy token.'
DUP = '[Webhook] Duplicate replyToken received: abc12345..., ignoring.'


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding='utf-8')
        return path

    def lines(self, *bodies, hour=22, offset=0, day=DAY):
        start = datetime.combine(day, datetime.min.time()).replace(hour=hour)
        return ''.join(f'{start + timedelta(seconds=i + offset):%Y-%m-%d %H:%M:%S} {body}\n'
                       for i, body in enumerate(bodies))

    def night(self, *bodies):
        path = self.write('shop/logs/webhook_server.log', self.lines(*bodies))
        return s.night_counts(DAY, path.parent)


class CustomerRules(Fixtures):
    def test_only_proven_probe_events_and_their_failures_are_excluded(self):
        row = self.night(POST, PROBE, FAIL, POST, TEXT, OK)
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['received'])
        self.assertEqual(1, row['details']['replied_ok'])
        self.assertEqual(0, row['details']['reply_failed'])
        self.assertEqual(1, row['details'].get('excluded_synthetic_events'))
        self.assertEqual(1, row['details'].get('excluded_reply_failed'))

    def test_all_probe_traffic_stays_no_data_not_zero_customer_pass(self):
        row = self.night(POST, PROBE, FAIL)
        self.assertEqual('no_data', row['status'])
        self.assertIsNone(row['details']['received'])
        self.assertEqual(1, row['details'].get('excluded_synthetic_events'))

    def test_dummy_verification_exclusion_does_not_create_an_unknown_customer(self):
        row = self.night(POST, PING, POST, TEXT, OK)
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details'].get('excluded_verification_events'))
        self.assertEqual(1, row['details']['received'])

    def test_probe_image_and_paused_image_use_the_same_marker(self):
        row = self.night(POST, '[Webhook Image] Received image 100 from UL1TEST_...', FAIL,
                         POST, '[Handoff] paused user=UL1TEST_ until=2026-11-12 23:00',
                         POST, TEXT, OK)
        self.assertEqual(2, row['details'].get('excluded_synthetic_events'))
        self.assertEqual(1, row['details']['received'])
        self.assertEqual('pass', row['status'])

    def test_unknown_and_similar_ids_and_invalid_tokens_remain_customer_failures(self):
        for user in ('U0000000', 'U0000001', 'U2468ace', 'Udiagtes'):
            with self.subTest(user=user):
                row = self.night(POST, TEXT.replace('U2468ace', user), FAIL)
                self.assertEqual('fail', row['status'])
                self.assertEqual(1, row['details']['received'])
                self.assertEqual(1, row['details']['reply_failed'])
                self.assertEqual(1, row['details'].get('invalid_token_events'))

    def test_current_probe_truncation_is_not_proof_of_synthetic_origin(self):
        row = self.night(POST,TEXT.replace('U2468ace','U0000000'),FAIL)
        self.assertEqual('fail',row['status'])
        self.assertEqual(1,row['details'].get('unconfirmed_test_candidates'))
        self.assertEqual(0,row['details']['excluded_synthetic_events'])
        self.assertEqual(1,row['details']['reply_failed'])

    def test_unanswered_breakdown_is_disjoint_and_unknown_never_becomes_no_reply_needed(self):
        row = self.night(POST,TEXT,GUARD,POST,TEXT,PAUSE,POST,TEXT,FAIL,POST,TEXT,POST)
        for category in ('guard','paused','reply_failed','silent','unknown'):
            self.assertEqual(1,row['details'].get('unanswered_'+category),category)
        self.assertEqual(4,row['details']['unanswered'])
        self.assertEqual(0,row['details']['no_reply_needed'])

    def test_guard_reject_with_reply_is_replied_ok(self):
        row = self.night(POST, TEXT, GUARD, OK)
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['replied_ok'])
        self.assertEqual(1, row['details'].get('guard_replied_ok'))
        self.assertEqual(0, row['details']['unanswered'])

    def test_guard_reject_without_delivery_is_unanswered(self):
        row = self.night(POST, TEXT, GUARD)
        self.assertEqual('fail', row['status'])
        self.assertEqual(1, row['details']['unanswered'])
        self.assertEqual(1, row['details'].get('guard_unanswered'))

    def test_guard_with_only_confirmed_owner_push_is_to_staff(self):
        row = self.night(POST, TEXT, GUARD, PUSH)
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['to_staff'])

    def test_paused_without_push_remains_unanswered(self):
        for bodies in ((POST, TEXT, PAUSE), (POST, PAUSE)):
            row = self.night(*bodies)
            self.assertEqual(1, row['details']['received'])
            self.assertEqual(1, row['details']['unanswered'])
            self.assertEqual(1, row['details'].get('paused_unanswered'))
            self.assertNotEqual('pass', row['status'])

    def test_paused_can_only_be_to_staff_with_this_turns_push(self):
        row = self.night(POST, TEXT, PUSH, PAUSE)
        self.assertEqual(1, row['details']['to_staff'])
        self.assertEqual(0, row['details']['unanswered'])

    def test_duplicate_transport_is_no_reply_needed_and_not_a_new_customer_turn(self):
        row = self.night(POST, TEXT, OK, DUP, POST, DUP)
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['received'])
        self.assertEqual(1, row['details']['replied_ok'])
        self.assertEqual(2, row['details'].get('duplicate_no_reply_needed'))

    def test_unlogged_sticker_follow_unfollow_or_empty_body_stays_unknown(self):
        # All four have precisely the same observable output: POST 200 only.
        row = self.night(POST)
        self.assertNotEqual('pass', row['status'])
        self.assertIsNone(row['details']['unanswered'])
        self.assertIsNone(row['details']['received'])
        self.assertEqual(1,row['details'].get('unanswered_unknown'))
        self.assertEqual(1, row['details'].get('unknown_requests'))

    def test_postback_success_is_observed_but_its_unlogged_type_is_not_invented(self):
        row = self.night(POST, OK)
        self.assertIsNone(row['details']['replied_ok'])
        self.assertEqual(1,row['details'].get('unattributed_replied_ok'))
        self.assertEqual(1, row['details'].get('unattributed_events'))
        self.assertEqual('no_data', row['status'])

    def test_second_unattributed_success_cannot_hide_behind_a_text_reply(self):
        row = self.night(POST, TEXT, OK, OK)
        self.assertEqual('no_data', row['status'])
        self.assertEqual(1, row['details'].get('unattributed_events'))

    def test_reply_failure_is_per_event_even_if_logged_twice_then_successful(self):
        row = self.night(POST, TEXT, FAIL, FAIL, OK)
        self.assertEqual('fail', row['status'])
        self.assertEqual(1, row['details']['reply_failed'])
        self.assertEqual(1, row['details']['replied_ok'])

    def test_silent_text_and_failed_owner_push_stay_red(self):
        self.assertEqual('fail', self.night(POST, TEXT)['status'])
        row = self.night(POST, TEXT, '[Handoff] push owner=U7654321 success=False', OK)
        self.assertEqual('fail', row['status'])

    def test_unknown_replies_cannot_mask_a_separate_silent_customer(self):
        row = self.night(POST,TEXT,POST,OK)
        self.assertEqual('fail',row['status'])
        self.assertEqual(1,row['details']['unanswered_silent'])
        self.assertEqual(1,row['details']['unattributed_events'])

    def test_message_content_never_selects_synthetic_filter_or_delivery(self):
        row = self.night(POST, TEXT[:-1] + " U0000000 probe-invalid-token [Webhook Reply Success] HTTP 200'")
        self.assertEqual('fail', row['status'])
        self.assertEqual(1, row['details']['received'])
        self.assertEqual(0, row['details'].get('excluded_synthetic_events'))
        for private in ('SYNTHETIC', 'U2468ace', 'U0000000', 'probe-invalid-token'):
            self.assertNotIn(private, json.dumps(row))


class ContinuityRules(Fixtures):
    def test_tee_duplicates_preserve_final_file_order_even_if_timestamps_invert(self):
        # SafeWriter's file/console tee can duplicate records; its two writers
        # are not an event clock. Bodies use the real runtime's exact shapes.
        data = (self.lines(TEXT,offset=2) + self.lines(OK,offset=1) + self.lines(POST) +
                self.lines(TEXT,offset=2) + self.lines(OK,offset=1))
        self.write('night/live/logs/webhook_server.log',data)
        row = s.night_counts(DAY,self.root/'night/live/logs')
        self.assertEqual('pass',row['status'])
        self.assertEqual(1,row['details']['received'])
        self.assertEqual(1,row['details']['replied_ok'])
        self.assertEqual(2,row['details']['duplicate_lines'])

    def test_conflicting_copy_order_cannot_be_green(self):
        post,text,ok = (self.lines(POST),self.lines(TEXT,offset=1),self.lines(OK,offset=2))
        self.write('night/live/logs/webhook_server.log',post+text+ok)
        self.write('night/live-20261112-r1/logs/webhook_server.log',post+ok+text)
        row = s.night_counts(DAY,self.root/'night/live/logs')
        self.assertNotEqual('pass',row['status'])
        self.assertEqual(1,row['details'].get('ordering_conflicts'))

    def test_all_live_trees_for_day_are_read_and_other_dates_ignored(self):
        self.write('night/live/logs/webhook_server.log', self.lines(POST, TEXT, OK))
        self.write('night/live-20261112-r2/logs/webhook_server.log', self.lines(POST, TEXT, offset=10))
        self.write('night/live-20261111-r1/logs/webhook_server.log', self.lines(POST, TEXT, OK, day=DAY-timedelta(days=1)))
        row = s.night_counts(DAY, self.root / 'night/live/logs')
        self.assertEqual('fail', row['status'])
        self.assertEqual(2, row['details']['received'])
        self.assertEqual(1, row['details']['unanswered'])
        self.assertEqual(2, row['details'].get('day_source_files'))

    def test_duplicate_timestamp_line_across_trees_counted_once_in_time_order(self):
        first = self.lines(POST, TEXT, OK)
        self.write('night/live/logs/webhook_server.log', first + self.lines(POST, TEXT, OK, offset=10))
        self.write('night/live-20261112-r2/logs/webhook_server.log', first)
        row = s.night_counts(DAY, self.root / 'night/live/logs')
        self.assertEqual(2, row['details']['received'])
        self.assertEqual(2, row['details']['replied_ok'])
        self.assertEqual(3, row['details'].get('duplicate_lines'))

    def test_split_request_can_finish_in_a_later_tree(self):
        self.write('night/live-20261112-r1/logs/webhook_server.log', self.lines(POST, TEXT))
        self.write('night/live/logs/webhook_server.log', self.lines(OK, offset=2))
        row = s.night_counts(DAY, self.root / 'night/live/logs')
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['received'])
        self.assertEqual(1, row['details']['replied_ok'])

    def test_missing_current_log_does_not_hide_renamed_tree(self):
        self.write('night/live-20261112-r1/logs/webhook_server.log', self.lines(POST, TEXT, OK))
        row = s.night_counts(DAY, self.root / 'night/live/logs')
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['received'])

    def test_reading_an_archived_live_tree_also_discovers_its_siblings(self):
        self.write('night/live/logs/webhook_server.log',self.lines(POST,TEXT,OK))
        self.write('night/live-20261112-r1/logs/webhook_server.log',self.lines(POST,TEXT,offset=10))
        row = s.night_counts(DAY,self.root/'night/live-20261112-r1/logs')
        self.assertEqual(2,row['details']['received'])
        self.assertEqual('fail',row['status'])

    def test_stderr_mirror_is_not_added_to_canonical_and_fallback_stays_no_data(self):
        data = self.lines(POST, TEXT, OK)
        self.write('shop/logs/webhook_server.log', data)
        self.write('shop/logs/webhook_server.err.log', data + self.lines(POST, TEXT, offset=10))
        row = s.night_counts(DAY, self.root / 'shop/logs')
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['received'])
        (self.root / 'shop/logs/webhook_server.log').unlink()
        self.assertNotEqual('pass', s.night_counts(DAY, self.root / 'shop/logs')['status'])

    def test_exact_dedup_does_not_collapse_different_lines_at_the_same_second(self):
        data = ''.join(self.lines(body, offset=1) for body in (POST, TEXT, OK))
        self.write('night/live/logs/webhook_server.log', data)
        self.write('night/live-20261112-r1/logs/webhook_server.log', data)
        row = s.night_counts(DAY, self.root / 'night/live/logs')
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['received'])


class MorningRules(Fixtures):
    def cover(self, *observations):
        return self.write('day_cover.jsonl', ''.join(json.dumps(dict(ts=f'{DAY}T{clock}+08:00', action=action, **kw))+'\n'
                          for clock, action, kw in observations))

    def test_pre_shop_ai_is_ignored_only_when_first_shop_is_within_five_minutes(self):
        path = self.cover(('10:00:00', 'already_ai', {}), ('10:02:00', 'shop_fixed_no_cover', {}))
        row = s.day_ownership(DAY, path)
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details'].get('grace_ai_checks'))

    def test_ai_after_shop_observation_still_fails_even_inside_grace(self):
        path = self.cover(('10:00:00', 'already_ai', {}), ('10:02:00', 'shop_fixed_no_cover', {}),
                          ('10:03:00', 'switched_to_ai', {}))
        row = s.day_ownership(DAY, path)
        self.assertEqual('fail', row['status'])
        self.assertEqual(1, row['details'].get('grace_ai_checks'))
        self.assertEqual(1, row['details']['ai_cover_checks'])

    def test_boundary_at_open_plus_five_inclusive_and_late_confirmation_never_gets_grace(self):
        for clock, expected in (('10:05:00', 'pass'), ('10:05:01', 'fail')):
            path = self.cover(('10:00:00', 'switched_to_ai', {}), (clock, 'handed_back_to_shop', {'verify':'match'}))
            self.assertEqual(expected, s.day_ownership(DAY, path)['status'])

    def test_ai_at_same_timestamp_as_shop_cannot_be_proven_before_it(self):
        path = self.cover(('10:02:00', 'already_ai', {}), ('10:02:00', 'shop_fixed_no_cover', {}))
        self.assertEqual('fail', s.day_ownership(DAY, path)['status'])

    def test_unverified_shop_observation_does_not_start_grace(self):
        path = self.cover(('10:00:00', 'already_ai', {}), ('10:02:00', 'handed_back_to_shop', {'verify':'mismatch'}))
        self.assertEqual('fail', s.day_ownership(DAY, path)['status'])


class ProducerRules(Fixtures):
    def produce(self, bodies, now=None, coverage_complete=True):
        self.assertTrue(callable(getattr(s, 'produce_shop_replies', None)), 'missing shared-rules receipt producer')
        source = self.write('synced/logs/webhook_server.log', self.lines(*bodies, hour=11))
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        out = self.root / 'out/shop-replies-2026-11-12.json'
        path = s.produce_shop_replies(DAY, source, out,
                     now=now or datetime(2026,11,12,20,1,tzinfo=s.TAIPEI), coverage_complete=coverage_complete)
        self.assertEqual(out, path)
        self.assertEqual(before, hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual([source], list(source.parent.iterdir()))
        return json.loads(path.read_text(encoding='utf-8')), path

    def test_shop_receipt_uses_identical_customer_and_delivery_rules(self):
        bodies = (POST, PROBE, FAIL, POST, TEXT, GUARD, OK, POST, TEXT, PUSH)
        data, path = self.produce(bodies)
        night = self.night(*bodies)['details']
        self.assertTrue(data['complete'])
        self.assertEqual('shop-replies/v1', data['schema'])
        self.assertEqual('shop_day', data['window'])
        for key in s.COUNTS:
            self.assertEqual(night[key], data[key], key)
        self.assertEqual('pass', s.shop_counts(DAY, path, datetime(2026,11,13,tzinfo=s.TAIPEI))['status'])
        self.assertEqual(set(s.COUNTS) | {'schema','date','generated_at','complete','window'}, set(data))

    def test_day_window_excludes_night_traffic_and_has_exclusive_closing(self):
        self.assertTrue(callable(getattr(s, 'produce_shop_replies', None)))
        source = self.write('synced/logs/webhook_server.log', self.lines(POST,TEXT,hour=9) +
                            self.lines(POST,TEXT,OK,hour=10) + self.lines(POST,TEXT,hour=20))
        path = s.produce_shop_replies(DAY, source, self.root/'out/day.json',
                    now=datetime(2026,11,12,20,1,tzinfo=s.TAIPEI), coverage_complete=True)
        data = json.loads(path.read_text())
        self.assertEqual(1, data['received'])
        self.assertEqual(1, data['replied_ok'])

    def test_1950_sync_cannot_claim_complete_until_the_shop_window_ends(self):
        data, path = self.produce((POST,TEXT,OK), now=datetime(2026,11,12,19,50,tzinfo=s.TAIPEI))
        self.assertFalse(data['complete'])
        self.assertEqual('no_data', s.shop_counts(DAY, path, datetime(2026,11,13,tzinfo=s.TAIPEI))['status'])

    def test_source_copy_requires_explicit_complete_coverage_attestation(self):
        data, _ = self.produce((POST,TEXT,OK), coverage_complete=False)
        self.assertFalse(data['complete'])

    def test_unknown_activity_or_stderr_copy_cannot_certify_complete_receipt(self):
        data, _ = self.produce((POST,))
        self.assertFalse(data['complete'])
        self.assertEqual(0, data['received'])  # no fabricated customer for a POST-only request
        self.assertEqual(0, data['no_reply_needed'])

    def test_reply_failed_is_preserved_as_a_customer_failure(self):
        data, path = self.produce((POST,TEXT,FAIL))
        self.assertEqual(1, data['reply_failed'])
        self.assertEqual('fail', s.shop_counts(DAY, path, datetime(2026,11,13,tzinfo=s.TAIPEI))['status'])

    def test_v1_cannot_lose_a_failed_staff_push_and_become_green(self):
        data, path = self.produce((POST,TEXT,'[Handoff] push owner=U7654321 success=False',OK))
        self.assertFalse(data['complete'])  # v1 has no push-failed field; cannot certify it
        self.assertNotEqual('pass', s.shop_counts(DAY,path,datetime(2026,11,13,tzinfo=s.TAIPEI))['status'])

    def test_missing_request_boundary_cannot_produce_complete_receipt(self):
        data, _ = self.produce((TEXT,OK))
        self.assertFalse(data['complete'])

    def test_missing_source_or_writing_into_input_log_is_rejected(self):
        self.assertTrue(callable(getattr(s, 'produce_shop_replies', None)))
        source = self.write('synced/logs/webhook_server.log', self.lines(POST,TEXT,OK,hour=11))
        for input_path, output in ((self.root/'missing.log', self.root/'out.json'), (source,source),
                                   (source,source.parent/'receipt.json')):
            with self.subTest(input_path=input_path,output=output), self.assertRaises(ValueError):
                s.produce_shop_replies(DAY, input_path, output)

    def test_receipt_never_emits_customer_content_identifiers_or_error_bodies(self):
        data, _ = self.produce((POST,TEXT,FAIL))
        result = json.dumps(data)
        for private in ('SYNTHETIC', 'U2468ace', 'Invalid reply token', 'HTTP Error'):
            self.assertNotIn(private,result)


class VersionRule(unittest.TestCase):
    def test_changed_scoring_rules_invalidate_older_streak_cache(self):
        self.assertGreaterEqual(lg.RULES_VERSION, 6)


if __name__ == '__main__':
    unittest.main()
