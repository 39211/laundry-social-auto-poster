"""L1GATE-r5: exact runtime shapes; synthetic fixtures, no network or secrets."""
import ast
from datetime import date, datetime, timedelta
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import level1_gates as lg
import level1_shop as s

DAY = date(2026, 11, 12)
TEXT = "[Webhook Text] User U2468ace...: 'SYNTHETIC ONLY'"
OTHER = TEXT.replace('U2468ace', 'U1357bdf')
PROBE = TEXT.replace('U2468ace', 'UL1TEST_')
POST = '[Webhook] POST /line/webhook HTTP/1.1 - 200'
OK = '[Webhook Reply Success] HTTP 200'
FAIL = '[ERROR] Failed to send LINE reply: HTTP Error 400: Bad Request | {"message":"Invalid reply token"}'
BINDING = '[Binding Saved] User: U2468ace... -> CID: SYNTHETIC, Phone: SYNTHETIC, Name: SYNTHETIC'
ONBOARD = '[Onboarding] lookup_by_phone note: SYNTHETIC'


def tunnel(clock='00:00:00', event='handover_noop', verify='match', day=DAY):
    return dict(ts=f'{day}T{clock}+08:00', event=event, old_url='',
                new_url='https://synthetic.trycloudflare.com/line/webhook',
                put_status='not_attempted' if event == 'handover_noop' else 200,
                verify_status=verify)


def cover(clock, action='shop_fixed_no_cover', **fields):
    return dict(ts=f'{DAY}T{clock}+08:00', action=action, **fields)


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, name, body):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding='utf-8')
        return path

    def owners(self, night=None, day=()):
        return dict(tunnel_logs=[self.write('tunnel_events.jsonl', ''.join(
                    json.dumps(r) + '\n' for r in ([tunnel()] if night is None else night)))],
                    day_cover_log=self.write('day_cover.jsonl', ''.join(json.dumps(r) + '\n' for r in day)))

    def log(self, rows):
        return self.write('night/live/logs/webhook_server.log', ''.join(
                    f'{DAY} {clock} {body}\n' for clock, body in rows))

    def count(self, rows, **owners):
        return s.night_counts(DAY, self.log(rows).parent, **owners)


class OwnershipWindows(Fixtures):
    def test_outside_probe_failures_never_become_customers(self):
        owner = self.owners(day=[cover('10:00:00'),
            cover('10:54:38', 'switched_to_ai', verify='match')])
        row = self.count([('10:31:00', TEXT.replace('U2468ace', 'U0000000')),
                          ('10:31:01', POST), ('10:31:02', FAIL),
                          ('10:54:39', TEXT), ('10:54:40', POST), ('10:54:41', OK)], **owner)
        self.assertEqual('pass', row['status'])
        self.assertEqual((1, 1, 0, 1), tuple(row['details'][k] for k in
                        ('received', 'replied_ok', 'reply_failed', 'outside_ai_window')))

    def test_unknown_ownership_is_no_data_and_never_customer_traffic(self):
        row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)],
                         **self.owners(night=[]))
        self.assertEqual('no_data', row['status'])
        self.assertIsNone(row['details']['received'])
        self.assertEqual(1, row['details']['ownership_unknown_events'])

    def test_unknown_ownership_mixed_with_answered_ai_traffic_cannot_pass(self):
        row = self.count([('10:00:00', TEXT), ('10:00:01', POST), ('10:00:02', OK),
                          ('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)],
                         **self.owners(night=[tunnel('10:30:00')]))
        self.assertEqual('no_data', row['status'])
        self.assertEqual((1, 1, 1), tuple(row['details'][k] for k in
                        ('received', 'replied_ok', 'ownership_unknown_events')))

    def test_no_implicit_fallback_to_real_ownership_logs(self):
        row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)])
        self.assertEqual('no_data', row['status'])
        self.assertIsNone(row['details']['received'])

    def test_half_open_boundaries_and_retakeover(self):
        row = self.count([('10:54:37', TEXT), ('10:54:37', FAIL),
                          ('10:54:38', TEXT), ('10:54:39', POST), ('10:54:40', OK),
                          ('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', FAIL),
                          ('11:05:00', TEXT), ('11:05:01', POST), ('11:05:02', OK)],
            **self.owners(day=[cover('10:00:00'), cover('10:54:38', 'switched_to_ai', verify='match'),
                              cover('11:00:00', 'handed_back_to_shop', verify='match'),
                              cover('11:05:00', 'switched_to_ai', verify='match')]))
        self.assertEqual('pass', row['status'])
        self.assertEqual((2, 2, 2), tuple(row['details'][k] for k in
                        ('received', 'replied_ok', 'outside_ai_window')))

    def test_prior_day_verified_takeover_carries_across_midnight(self):
        row = self.count([('00:01:00', TEXT), ('00:01:01', POST), ('00:01:02', OK)],
            **self.owners(night=[tunnel('20:05:00', 'webhook_update', day=DAY-timedelta(days=1))]))
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['received'])

    def test_utc_journal_timestamp_is_localized_before_lookup(self):
        observation = tunnel('10:30:00')
        observation['ts'] = '2026-11-12T02:30:00Z'
        row = self.count([('10:29:59', TEXT), ('10:29:59', OK),
                          ('10:30:00', OTHER), ('10:30:01', POST), ('10:30:02', OK)],
                         **self.owners(night=[observation], day=[cover('10:00:00')]))
        self.assertEqual('pass', row['status'])
        self.assertEqual((1, 1), tuple(row['details'][k] for k in ('received', 'outside_ai_window')))

    def test_same_timestamp_conflicting_owners_remain_unknown(self):
        row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)],
                         **self.owners(night=[tunnel('10:00:00')], day=[cover('10:00:00')]))
        self.assertEqual('no_data', row['status'])
        self.assertEqual(1, row['details']['ownership_unknown_events'])

    def test_already_ai_shape_is_a_direct_endpoint_readback(self):
        row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)],
                         **self.owners(night=[], day=[cover('10:00:00', 'already_ai')]))
        self.assertEqual('pass', row['status'])

    def test_verified_tunnel_event_with_unrecognized_target_is_not_ai(self):
        observation = tunnel()
        observation['new_url'] = 'https://synthetic.example.invalid/line/webhook'
        row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)],
                         **self.owners(night=[observation]))
        self.assertEqual('no_data', row['status'])
        self.assertIsNone(row['details']['received'])

    def test_changing_ownership_source_is_unknown(self):
        owner = self.owners()
        target = owner['tunnel_logs'][0]
        original_stat = Path.stat
        calls = 0

        def changing_stat(path, *args, **kwargs):
            nonlocal calls
            result = original_stat(path, *args, **kwargs)
            if path == target:
                calls += 1
                return mock.Mock(st_size=result.st_size + calls, st_mtime_ns=result.st_mtime_ns)
            return result

        with mock.patch.object(Path, 'stat', changing_stat):
            row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)], **owner)
        self.assertEqual('no_data', row['status'])
        self.assertGreater(row['details']['ownership_source_errors'], 0)

    def test_tunnel_runtime_shapes_require_verified_match(self):
        rows = [('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)]
        for event in ('webhook_update', 'night_reclaim', 'handover_noop'):
            for verify in ('match', 'mismatch', 'not_attempted', None):
                with self.subTest(event=event, verify=verify):
                    row = self.count(rows, **self.owners(night=[tunnel(event=event, verify=verify)]))
                    self.assertEqual('pass' if verify == 'match' else 'no_data', row['status'])

    def test_unverified_switch_invalidates_previous_owner(self):
        for observation in (tunnel('10:30:00', 'webhook_update', 'mismatch'),
                            cover('10:30:00', 'switched_to_ai', verify='mismatch'),
                            cover('10:30:00', 'handed_back_to_shop', verify='mismatch'),
                            cover('10:30:00', check_error='SYNTHETIC')):
            with self.subTest(marker=observation.get('event', observation.get('action'))):
                night, day = ([tunnel(), observation], []) if 'event' in observation else ([tunnel()], [observation])
                row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)],
                                 **self.owners(night=night, day=day))
                self.assertEqual('no_data', row['status'])

    def test_unrelated_or_future_observations_do_not_establish_ownership(self):
        for night, day in (([tunnel(event='tunnel_url')], []),
                           ([tunnel('12:00:00')], []),
                           ([], [cover('10:00:00', 'noop_no_flag')])):
            with self.subTest(night=bool(night), day=bool(day)):
                row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)],
                                 **self.owners(night=night, day=day))
                self.assertEqual('no_data', row['status'])

    def test_missing_or_corrupt_ownership_source_cannot_pass(self):
        for target in ('tunnel_logs', 'day_cover_log'):
            for damaged in ('missing', 'bad_json', 'bad_timestamp'):
                with self.subTest(target=target, damaged=damaged):
                    owner = self.owners()
                    path = owner[target][0] if target == 'tunnel_logs' else owner[target]
                    if damaged == 'missing':
                        path.unlink()
                    else:
                        with path.open('a', encoding='utf-8') as stream:
                            stream.write('broken\n' if damaged == 'bad_json' else '{"ts":"naive","action":"switched_to_ai"}\n')
                    row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)], **owner)
                    self.assertEqual('no_data', row['status'])

    def test_shop_only_traffic_is_diagnostic_no_data_not_zero_customer_pass(self):
        row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', FAIL)],
                         **self.owners(day=[cover('10:00:00')]))
        self.assertEqual('no_data', row['status'])
        self.assertIsNone(row['details']['received'])
        self.assertEqual(1, row['details']['outside_ai_window'])

    def test_outside_and_unknown_orphan_failures_do_not_become_customer_failures(self):
        for observation in (cover('10:30:00'), cover('10:30:00', 'switched_to_ai', verify='mismatch')):
            row = self.count([('10:00:00', TEXT), ('10:00:01', POST), ('10:00:02', OK),
                              ('11:00:00', FAIL)], **self.owners(day=[observation]))
            self.assertEqual(0, row['details']['unattributed_reply_failed'])
            self.assertEqual('pass' if observation['action'] == 'shop_fixed_no_cover' else 'no_data', row['status'])

    def test_event_ownership_is_at_arrival_even_if_reply_follows_handback(self):
        row = self.count([('10:59:59', TEXT), ('11:00:01', POST), ('11:00:02', OK)],
                         **self.owners(day=[cover('11:00:00', 'handed_back_to_shop', verify='match')]))
        self.assertEqual('pass', row['status'])
        self.assertEqual((1, 1), tuple(row['details'][k] for k in ('received', 'replied_ok')))

    def test_outside_event_consumes_its_reply_without_answering_ai_event(self):
        row = self.count([('10:59:59', TEXT), ('11:00:00', OTHER), ('11:00:01', POST), ('11:00:02', OK)],
                         **self.owners(night=[], day=[cover('10:00:00'),
                             cover('11:00:00', 'switched_to_ai', verify='match')]))
        self.assertEqual('fail', row['status'])
        self.assertEqual((1, 0, 1, 1), tuple(row['details'][k] for k in
                        ('received', 'replied_ok', 'unanswered_silent', 'outside_ai_window')))

    def test_outside_transport_markers_cannot_hide_unknown_ai_requests(self):
        row = self.count([('10:00:00', s.VERIFICATION),
                          ('10:00:01', '[Webhook] Duplicate replyToken received: synthetic..., ignoring.'),
                          ('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK), ('11:05:00', POST)],
                         **self.owners(night=[], day=[cover('10:00:00'),
                             cover('11:00:00', 'switched_to_ai', verify='match')]))
        self.assertEqual('no_data', row['status'])
        self.assertEqual(1, row['details']['unknown_requests'])

    def test_counts_result_has_no_raw_ids_or_message_bodies(self):
        row = self.count([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)], **self.owners())
        for forbidden in ('U2468ace', 'SYNTHETIC ONLY', 'trycloudflare.com'):
            self.assertNotIn(forbidden, json.dumps(row))

    def test_shop_day_parser_remains_unfiltered(self):
        row = s.reply_log_counts(DAY, [self.log([('11:00:00', TEXT), ('11:00:01', POST), ('11:00:02', OK)])], 10, 20)
        self.assertEqual('pass', row['status'])
        self.assertEqual(1, row['details']['received'])


class OnboardingGroup(Fixtures):
    def parse(self, rows):
        return s.reply_log_counts(DAY, [self.log(rows)])

    def test_binding_marks_all_open_events_with_same_prefix(self):
        row = self.parse([('09:03:00', TEXT), ('09:03:10', TEXT), ('09:03:11', POST), ('09:03:12', BINDING)])
        self.assertEqual('no_data', row['status'])
        self.assertEqual((2, 2, 0), tuple(row['details'][k] for k in
                         ('received', 'unverified_onboarding', 'unanswered_silent')))

    def test_onboarding_without_id_uses_latest_prefix_for_all_open_events(self):
        row = self.parse([('09:03:00', TEXT), ('09:03:10', TEXT), ('09:03:11', POST), ('09:03:12', ONBOARD)])
        self.assertEqual((2, 0), tuple(row['details'][k] for k in ('unverified_onboarding', 'unanswered_silent')))

    def test_binding_explicit_prefix_does_not_mark_interleaved_other_user(self):
        row = self.parse([('09:03:00', TEXT), ('09:03:10', TEXT), ('09:03:11', OTHER), ('09:03:12', BINDING)])
        self.assertEqual((2, 1), tuple(row['details'][k] for k in ('unverified_onboarding', 'unanswered_silent')))

    def test_onboarding_without_id_keeps_other_prefix_silent(self):
        row = self.parse([('09:03:00', OTHER), ('09:03:10', TEXT), ('09:03:11', TEXT), ('09:03:12', ONBOARD)])
        self.assertEqual((2, 1), tuple(row['details'][k] for k in ('unverified_onboarding', 'unanswered_silent')))

    def test_binding_180_second_boundary_and_closed_events(self):
        row = self.parse([('09:00:00', TEXT), ('09:00:01', TEXT), ('09:00:02', TEXT),
                          ('09:00:03', FAIL), ('09:03:01', BINDING)])
        self.assertEqual((1, 2, 0), tuple(row['details'][k] for k in
                         ('reply_failed', 'unverified_onboarding', 'unanswered_silent')))

    def test_expired_event_same_prefix_stays_silent(self):
        row = self.parse([('09:00:00', TEXT), ('09:00:01', TEXT), ('09:03:01', BINDING)])
        self.assertEqual((1, 1), tuple(row['details'][k] for k in ('unverified_onboarding', 'unanswered_silent')))

    def test_marker_in_text_cannot_mark_group(self):
        row = self.parse([('09:03:00', TEXT + BINDING), ('09:03:01', TEXT + ONBOARD), ('09:03:02', POST)])
        self.assertEqual((0, 2), tuple(row['details'][k] for k in ('unverified_onboarding', 'unanswered_silent')))


class Integration(Fixtures):
    def test_item2_passes_explicit_ownership_sources(self):
        paths = lg.Paths(self.root, mdb_log=self.root / 'mdb.jsonl',
                         service_logs=[self.root / 'tunnel_events.jsonl'], day_cover_log=self.root / 'cover.jsonl')
        with mock.patch.object(s, 'accounting', return_value={'status': 'no_data'}) as accounting:
            lg.evaluate_checklist(DAY, paths, None, None, datetime(2026, 11, 13, tzinfo=s.TAIPEI))
        self.assertEqual(paths.service_logs, accounting.call_args.kwargs['tunnel_logs'])
        self.assertEqual(paths.day_cover_log, accounting.call_args.kwargs['day_cover_log'])

    def test_previous_scoring_cache_is_invalidated(self):
        old = dict(rules_version=7, partial_day=False, incidents=dict(status='pass'),
                   checklist={key: dict(status='pass') for key in lg.CHECKLIST_TITLES})
        self.assertFalse(lg._day_passed(old))


class ProbeNamespace(unittest.TestCase):
    def test_probe_uid_is_excluded_namespace_without_executing_probe(self):
        path = Path(os.environ.get('L1GATE_PROBE_PATH',
                    'C:/Users/cyc39/AI-Lanes/collab/trunk/bench/_shop_copy_probe.py'))
        tree = ast.parse(path.read_text(encoding='utf-8-sig'))
        assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                       and any(isinstance(target, ast.Name) and target.id == 'uid' for target in node.targets)]
        self.assertEqual(1, len(assignments))
        scope = {}
        exec(compile(ast.Module(body=assignments, type_ignores=[]), '<synthetic-probe-uid>', 'exec'), {}, scope)
        self.assertTrue(scope['uid'].startswith('UL1TEST_'))
        self.assertIn(scope['uid'][:8], s.SYNTHETIC_PREFIXES)


if __name__ == '__main__':
    unittest.main()
