"""R7: real log shapes with synthetic values; future probe/receipt contracts."""
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import level1_gates as lg
import level1_receipts as r7
import level1_shop as shop

DAY = date(2026, 11, 11)
OPEN = datetime(2026, 11, 11, 20, tzinfo=r7.TAIPEI)
CLOSE = OPEN + timedelta(hours=14)
NOW = CLOSE + timedelta(hours=2)


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'tunnel_events.jsonl'
        self.notify = self.root / f'notify-{DAY}.json'
        self.receipt = self.root / f'notify-recipients-{DAY}.json'

    def write(self, path, value):
        path.write_text(json.dumps(value), encoding='utf-8')

    def rows(self, rows):
        self.source.write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')

    def sample(self, ts, **changes):
        row = dict(schema=r7.NIGHT_SCHEMA, event='night_service_observation', ts=ts.isoformat(),
                   runtime='shop-18791', probe='reply-path-no-send/v1',
                   registration_match=True, night_copy_answered=True)
        row.update(changes)
        return row

    def healthy(self, step=15):
        return [self.sample(OPEN + timedelta(minutes=m)) for m in range(5, 840, step)]

    def night(self, now=NOW, sources=None):
        return r7.night_continuity(DAY, [self.source] if sources is None else sources, now)

    def daily(self, **changes):
        # Exact pulled notify gate shape: collector drops outbox/corrupt_lines.
        row = dict(date=str(DAY), sent=3, duplicates=0, wrong_sends=0,
                   wrong_sends_basis='auto_duplicate_deliveries', abandoned=0, no_binding=1,
                   pending=0, reported_by='shop-notify-report', fetched_at=NOW.isoformat())
        row.update(changes)
        self.write(self.notify, row)
        return row

    def receipt_data(self, **changes):
        row = dict(schema=r7.RECIPIENT_SCHEMA, date=str(DAY), timezone='Asia/Taipei',
                   reported_by='shop-recipient-consistency', basis=r7.RECIPIENT_BASIS,
                   generated_at=NOW.isoformat(), coverage_start=f'{DAY}T00:00:00+08:00',
                   coverage_end=f'{DAY + timedelta(days=1)}T00:00:00+08:00', complete=True,
                   snapshot='at_send', outbox='ok', orders='ok', bindings='ok', corrupt_lines=0,
                   sent=3, duplicates=0, checked=3, customer_id_matches=2, phone_unique_matches=1,
                   wrong_recipient=0, unverifiable=0)
        row.update(changes)
        self.write(self.receipt, row)
        return row

    def safety(self, now=NOW):
        return lg.evaluate_notify_safety(DAY, self.notify, {}, None, now)


class NightRules(Fixtures):
    def test_real_row_shapes_are_registration_only(self):
        # Four exact key/type shapes from real tunnel_events.jsonl, no values copied.
        base = dict(ts=OPEN.isoformat(), event='handover_noop', old_url='SYNTHETIC_OLD',
                    new_url='SYNTHETIC_NEW', put_status='not_attempted', verify_status='match')
        update = dict(base, event='webhook_update', put_status=200, readback_url='SYNTHETIC_NEW')
        reclaim = dict(base, event='night_reclaim', status='updated')
        restart = dict(base, event='tunnel_unhealthy_restart', failing_seconds=180,
                       verify_status='not_attempted')
        self.rows([base, update, reclaim])
        result = self.night()
        self.assertEqual('no_data', result['status'])
        self.assertEqual(3, result['details']['registration_observations'])
        self.assertEqual(0, result['details']['healthy_observations'])
        self.rows([base, restart])
        self.assertEqual('fail', self.night()['status'])
        self.assertNotIn('SYNTHETIC_', json.dumps(self.night()))

    def test_gap_limit_20_minutes_is_inclusive_and_20_plus_second_fails(self):
        rows = self.healthy(step=20)
        self.rows(rows)
        self.assertEqual('pass', self.night()['status'])
        rows[5]['ts'] = (datetime.fromisoformat(rows[5]['ts']) + timedelta(seconds=1)).isoformat()
        self.rows(rows)
        self.assertEqual('fail', self.night()['status'])

    def test_any_unhealthy_row_fails_even_between_or_at_same_time_as_success(self):
        rows = self.healthy()
        self.rows(rows)
        self.assertEqual('pass', self.night()['status'])
        for field in ('registration_match', 'night_copy_answered'):
            for index in (5, 0):
                with self.subTest(field=field, index=index):
                    self.rows(rows + [dict(rows[index], **{field: False})])
                    self.assertEqual('fail', self.night()['status'])

    def test_missing_source_never_passes(self):
        self.assertEqual('no_data', self.night()['status'])
        self.rows(self.healthy())
        self.assertEqual('no_data', self.night(sources=[self.source, self.root/'missing'])['status'])
        self.assertEqual('no_data', self.night(sources=[])['status'])

    def test_corrupt_changed_empty_and_missing_timestamps_never_pass(self):
        self.rows([])
        self.assertEqual('no_data', self.night()['status'])
        for bad in ('{broken', '[]', '{"ts":"bad","event":"handover_noop"}',
                    '{"ts":"2026-11-11T20:05:00","event":"handover_noop"}',
                    '{"event":"x","event":"y"}', '{"ts":NaN}'):
            self.rows(self.healthy())
            with self.source.open('a', encoding='utf-8') as stream:
                stream.write(bad + '\n')
            self.assertEqual('no_data', self.night()['status'])
        self.source.write_bytes(b'\xff')
        self.assertEqual('no_data', self.night()['status'])
        with mock.patch.object(r7, '_read', side_effect=OSError('changed')):
            self.assertEqual('no_data', self.night()['status'])

    def test_first_within_five_minutes_and_tail_within_twenty(self):
        rows = self.healthy()
        self.rows(rows)
        self.assertEqual(300, self.night()['details']['first_delay_seconds'])
        self.assertEqual('pass', self.night()['status'])
        rows[0]['ts'] = (OPEN+timedelta(minutes=5, seconds=1)).isoformat()
        self.rows(rows)
        self.assertEqual('fail', self.night()['status'])
        self.rows(self.healthy()[:-1])
        self.assertEqual('fail', self.night()['status'])

    def test_only_target_night_and_until_now_are_used(self):
        rows = self.healthy()
        self.rows(rows + [self.sample(OPEN-timedelta(seconds=1), night_copy_answered=False),
                          self.sample(CLOSE, night_copy_answered=False)])
        self.assertEqual('pass', self.night()['status'])
        self.assertEqual('no_data', self.night(now=OPEN-timedelta(hours=1))['status'])
        self.assertEqual('no_data', self.night(now=OPEN+timedelta(minutes=6))['status'])
        self.assertEqual('no_data', self.night(now=OPEN+timedelta(minutes=30))['status'])
        self.rows(rows[:1])
        self.assertEqual('fail', self.night(now=OPEN+timedelta(minutes=30))['status'])

    def test_wrong_runtime_dry_run_unknown_probe_or_healthz_alone_never_pass(self):
        for change in (dict(runtime='retired-8791'), dict(probe='healthz-only'),
                       dict(schema='unknown'), dict(night_copy_answered=1), dict(dry_run=True)):
            self.rows([dict(row, **change) for row in self.healthy()])
            self.assertEqual('no_data', self.night()['status'])
        self.rows([dict(ts=row['ts'], event='healthz', ok=True) for row in self.healthy()])
        self.assertEqual('no_data', self.night()['status'])

    def test_registered_poll_failures_are_not_ignored(self):
        for event in ('handover_noop', 'webhook_update', 'night_reclaim', 'handover_error',
                      'tunnel_unhealthy_restart', 'configuration_error', 'origin_down', 'supervisor_error'):
            rows = self.healthy()
            self.rows(rows + [dict(ts=rows[0]['ts'], event=event, verify_status='mismatch')])
            self.assertEqual('fail', self.night()['status'])

    def test_unknown_event_cannot_hide_between_healthy_observations(self):
        rows = self.healthy()
        self.rows(rows + [dict(ts=rows[0]['ts'],event='new_unknown_event')])
        self.assertEqual('no_data',self.night()['status'])
        for event in ('night_service_observatioN', 'tunnel_url', 'handover_noop'):
            self.rows(rows + [dict(rows[0],event=event,night_copy_answered=False)])
            self.assertEqual('no_data',self.night()['status'])
        # The task explicitly makes a corrupt source no_data, even with a
        # separately parseable failure. This can never turn into a green.
        self.rows(rows + [dict(ts=rows[0]['ts'],event='origin_down')])
        with self.source.open('a') as stream:
            stream.write('{broken\n')
        self.assertEqual('no_data',self.night()['status'])

    def test_overflow_timestamps_are_corrupt_in_all_service_readers(self):
        for value in ('0001-01-01T00:00:00+14:00', '9999-12-31T23:59:59-12:00'):
            self.assertIsNone(r7.stamp(value))
            self.assertIsNone(shop.stamp(value))
            self.assertIsNone(lg.parse_ts(value, r7.TAIPEI))
            self.rows(self.healthy() + [dict(ts=value,event='handover_noop',verify_status='match')])
            paths = lg.Paths(self.root, mdb_log=self.root/'pull.jsonl',service_logs=[self.source])
            self.assertEqual('no_data', self.night()['status'])
            self.assertEqual('no_data', lg.evaluate_service(DAY,paths,None,None,NOW)['subchecks']['c']['status'])

    def test_checklist_uses_current_window_instead_of_legacy_sampler(self):
        self.rows(self.healthy())
        paths = lg.Paths(self.root, mdb_log=self.root/'pull.jsonl', service_logs=[self.source])
        row = lg.evaluate_service(DAY, paths, None, None, NOW)
        self.assertEqual('pass', row['subchecks']['c']['status'])
        self.source.unlink()
        self.assertEqual('no_data', lg.evaluate_service(DAY, paths, None, None, NOW)['subchecks']['c']['status'])


class RecipientRules(Fixtures):
    def setUp(self):
        super().setUp()
        self.daily()
        self.receipt_data()

    def test_current_pulled_shape_plus_full_receipt_passes(self):
        self.assertEqual('pass', self.safety()['status'])
        self.assertEqual(1, self.safety()['details']['phone_unique_matches'])
        self.assertEqual(3, self.safety()['details']['checked'])

    def test_wrong_recipient_count_fails_even_with_no_duplicates(self):
        self.assertEqual('pass', self.safety()['status'])
        self.receipt_data(wrong_recipient=1, customer_id_matches=1)
        self.assertEqual('fail', self.safety()['status'])

    def test_receipt_missing_corrupt_or_legacy_review_claim_cannot_pass(self):
        self.receipt.unlink()
        self.assertEqual('no_data', self.safety()['status'])
        self.daily(wrong_sends_basis='reviewed_all_deliveries')
        self.assertEqual('no_data', self.safety()['status'])
        for text in ('[]', '{broken', '{"date":"x","date":"y"}'):
            self.receipt.write_text(text)
            self.assertEqual('no_data', self.safety()['status'])

    def test_duplicates_in_either_source_fail(self):
        self.daily(duplicates=1, wrong_sends=1)
        self.receipt.unlink()
        self.assertEqual('fail', self.safety()['status'])
        self.daily()
        self.receipt_data(duplicates=1)
        self.assertEqual('fail', self.safety()['status'])

    def test_partial_missing_sources_corruption_or_current_snapshot_never_pass(self):
        for change in (dict(complete=False), dict(outbox='missing'), dict(orders='missing'),
                       dict(bindings='missing'), dict(snapshot='current'), dict(corrupt_lines=1),
                       dict(coverage_end=f'{DAY}T23:00:00+08:00'),
                       dict(checked=2, customer_id_matches=1, unverifiable=1)):
            self.receipt_data(**change)
            self.assertEqual('no_data', self.safety()['status'], change)

    def test_counts_require_every_sent_notice_and_nonnegative_integers(self):
        for key in r7.RECIPIENT_COUNTS:
            for value in (-1, True, 1.0, '0', None):
                self.receipt_data(**{key:value})
                self.assertEqual('no_data', self.safety()['status'], (key, value))
        for change in (dict(sent=4), dict(checked=2), dict(customer_id_matches=1), dict(phone_unique_matches=0)):
            self.receipt_data(**change)
            self.assertEqual('no_data', self.safety()['status'], change)

    def test_day_interval_and_generated_at_must_be_valid_and_not_future(self):
        for change in (dict(date='2026-11-10'), dict(timezone='UTC'),
                       dict(coverage_start=f'{DAY}T01:00:00+08:00'),
                       dict(generated_at=(NOW+timedelta(seconds=1)).isoformat()),
                       dict(generated_at=f'{DAY}T12:00:00+08:00'),
                       dict(generated_at=f'{DAY}T23:00:00'), dict(complete=1)):
            self.receipt_data(**change)
            self.assertEqual('no_data', self.safety()['status'], change)
        self.receipt_data()
        self.assertEqual('no_data', self.safety(now=OPEN)['status'])

    def test_overflow_timestamps_are_no_data_in_receipt(self):
        for key in ('generated_at','coverage_start','coverage_end'):
            for value in ('0001-01-01T00:00:00+14:00','9999-12-31T23:59:59-12:00'):
                self.receipt_data(**{key:value})
                self.assertEqual('no_data',self.safety()['status'])

    def test_daily_totals_missing_corrupt_or_disagreeing_never_pass(self):
        for change in (dict(sent=4), dict(duplicates=None), dict(outbox='missing'),
                       dict(corrupt_lines=True), dict(reported_by='unknown'), dict(wrong_sends_basis='unknown')):
            self.daily(**change)
            self.assertEqual('no_data', self.safety()['status'], change)
        self.notify.unlink()
        self.assertEqual('no_data', self.safety()['status'])

    def test_zero_sends_requires_complete_independent_zero_receipt(self):
        self.daily(sent=0)
        self.receipt_data(sent=0, checked=0, customer_id_matches=0, phone_unique_matches=0)
        self.assertEqual('pass', self.safety()['status'])
        self.receipt_data(sent=0, checked=0, customer_id_matches=0, phone_unique_matches=0, complete=False)
        self.assertEqual('no_data', self.safety()['status'])

    def test_unknown_fields_are_rejected_and_no_raw_values_are_echoed(self):
        self.receipt_data(customer_id='PRIVATE_ID', phone='PRIVATE_PHONE', uid='PRIVATE_UID', text='PRIVATE_TEXT')
        result = self.safety()
        self.assertEqual('no_data', result['status'])
        self.assertNotIn('PRIVATE_', json.dumps(result))


class VersionRule(unittest.TestCase):
    def test_new_rules_do_not_reuse_r6_passes(self):
        self.assertGreaterEqual(lg.RULES_VERSION, 10)

    def test_published_schema_field_sets_match_the_scorer_contracts(self):
        folder = Path(__file__).resolve().parents[1] / 'schemas'
        for name, fields in (('night-service-observation-v1.schema.json', r7.NIGHT_FIELDS),
                             ('notify-recipient-consistency-v1.schema.json', r7.RECIPIENT_FIELDS)):
            schema = json.loads((folder/name).read_text(encoding='utf-8'))
            self.assertEqual(fields, set(schema['required']))
            self.assertEqual(fields, set(schema['properties']))
            self.assertIs(False, schema['additionalProperties'])


if __name__ == '__main__':
    unittest.main()
