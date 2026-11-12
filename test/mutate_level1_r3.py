"""Isolated healthy -> red -> healthy proof; synthetic fixtures, counts only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
SHOP = 'scripts/level1_shop.py'
GATES = 'scripts/level1_gates.py'
MUTATIONS = [
    ('exclude_documented_probe', SHOP, "if p['synthetic']:", 'if False:',
     'CustomerRules.test_only_proven_probe_events_and_their_failures_are_excluded'),
    ('never_exclude_unknown_ids', SHOP, "synthetic=prefix in SYNTHETIC_PREFIXES)", 'synthetic=True)',
     'CustomerRules.test_unknown_and_similar_ids_and_invalid_tokens_remain_customer_failures'),
    ('truncated_probe_not_proven', SHOP, "SYNTHETIC_PREFIXES = frozenset({'UL1TEST_'})", "SYNTHETIC_PREFIXES = frozenset({'UL1TEST_', 'U0000000'})",
     'CustomerRules.test_current_probe_truncation_is_not_proof_of_synthetic_origin'),
    ('verification_is_not_a_customer', SHOP, "request_controls += 1\n            stats['verification_pings']", "request_controls += 0\n            stats['verification_pings']",
     'CustomerRules.test_dummy_verification_exclusion_does_not_create_an_unknown_customer'),
    ('guard_needs_delivery', SHOP, "if p['reply']:\n            result = 'replied_ok'", "if p['reply'] or p['guard']:\n            result = 'replied_ok'",
     'CustomerRules.test_guard_reject_without_delivery_is_unanswered'),
    ('guard_with_reply_is_answered', SHOP, "if p['reply']:\n            result = 'replied_ok'", "if p['reply'] and not p['guard']:\n            result = 'replied_ok'",
     'CustomerRules.test_guard_reject_with_reply_is_replied_ok'),
    ('confirmed_owner_push', SHOP, "elif p['push'] and not p['push_failed']:", 'elif False:',
     'CustomerRules.test_guard_with_only_confirmed_owner_push_is_to_staff'),
    ('pause_is_not_delivery', SHOP, "elif p['paused']:\n            stats['paused_unanswered']", "elif p['paused']:\n            counts['no_reply_needed'] += 1\n            stats['paused_unanswered']",
     'CustomerRules.test_paused_without_push_remains_unanswered'),
    ('duplicate_is_transport_only', SHOP, "request_controls += 1\n            stats['duplicate_tokens']", "request_controls += 0\n            stats['duplicate_tokens']",
     'CustomerRules.test_duplicate_transport_is_no_reply_needed_and_not_a_new_customer_turn'),
    ('unknown_post_is_unanswered', SHOP, "stats['unknown_requests'] += 1\n            start(unknown=True)\n            finish()", "stats['unknown_requests'] += 1",
     'CustomerRules.test_unlogged_sticker_follow_unfollow_or_empty_body_stays_unknown'),
    ('postback_type_is_unobserved', SHOP, 'if unknown:', 'if False:',
     'CustomerRules.test_postback_success_is_observed_but_its_unlogged_type_is_not_invented'),
    ('second_orphan_reply_stays_unknown', SHOP, "if pending is None or pending['reply']:\n                start(unknown=True)  # e.g. postback", "if pending is None:\n                start(unknown=True)  # e.g. postback",
     'CustomerRules.test_second_unattributed_success_cannot_hide_behind_a_text_reply'),
    ('reply_failures_stay_red', SHOP, "counts['reply_failed'] += p['failed']", "counts['reply_failed'] += 0",
     'CustomerRules.test_reply_failure_is_per_event_even_if_logged_twice_then_successful'),
    ('unknown_does_not_mask_silent_customer', SHOP, "elif any(stats['unanswered_' + category] for category in ('guard', 'reply_failed', 'silent')):", "elif (details['unanswered'] or 0) > stats['ambiguous']:",
     'CustomerRules.test_unknown_replies_cannot_mask_a_separate_silent_customer'),
    ('all_renamed_trees', SHOP, "if include_siblings and log_dir.parent.name.startswith('live'):", 'if False:',
     'ContinuityRules.test_all_live_trees_for_day_are_read_and_other_dates_ignored'),
    ('exact_copy_dedup', SHOP, "key = hashlib.sha256(line.encode('utf-8')).digest()", "key = hashlib.sha256(f'{index}:{number}:{line}'.encode('utf-8')).digest()",
     'ContinuityRules.test_duplicate_timestamp_line_across_trees_counted_once_in_time_order'),
    ('dedup_includes_the_whole_line', SHOP, "key = hashlib.sha256(line.encode('utf-8')).digest()", "key = hashlib.sha256(m[1].encode('utf-8')).digest()",
     'ContinuityRules.test_exact_dedup_does_not_collapse_different_lines_at_the_same_second'),
    ('chronological_merge', SHOP, 'records = ordered', 'records = list(reversed(ordered))',
     'ContinuityRules.test_split_request_can_finish_in_a_later_tree'),
    ('tee_file_order_before_timestamp', SHOP, 'records = ordered', 'records = sorted(ordered, key=lambda row: row[:3])',
     'ContinuityRules.test_tee_duplicates_preserve_final_file_order_even_if_timestamps_invert'),
    ('conflicting_copy_order', SHOP, "stats['ordering_conflicts'] += 1", "stats['ordering_conflicts'] += 0",
     'ContinuityRules.test_conflicting_copy_order_cannot_be_green'),
    ('canonical_before_stderr', SHOP, "('webhook_server.log', 'webhook_server.err.log')", "('webhook_server.err.log', 'webhook_server.log')",
     'ContinuityRules.test_stderr_mirror_is_not_added_to_canonical_and_fallback_stays_no_data'),
    ('morning_grace', SHOP, 'grace = sum(ai and timely and ts < first for ts, _, ai in rows)', 'grace = 0',
     'MorningRules.test_pre_shop_ai_is_ignored_only_when_first_shop_is_within_five_minutes'),
    ('ai_after_handback_still_fails', SHOP, 'ai and timely and ts < first', 'ai and timely',
     'MorningRules.test_ai_after_shop_observation_still_fails_even_inside_grace'),
    ('grace_is_strictly_before_shop', SHOP, 'ts < first', 'ts <= first',
     'MorningRules.test_ai_at_same_timestamp_as_shop_cannot_be_proven_before_it'),
    ('five_minute_limit', SHOP, '(first - expected).total_seconds() <= 300', '(first - expected).total_seconds() <= 301',
     'MorningRules.test_boundary_at_open_plus_five_inclusive_and_late_confirmation_never_gets_grace'),
    ('shop_and_night_share_customer_filter', SHOP, 'synthetic=prefix in SYNTHETIC_PREFIXES)', 'synthetic=False)',
     'ProducerRules.test_shop_receipt_uses_identical_customer_and_delivery_rules'),
    ('shop_window_only', SHOP, "row = reply_log_counts(day, [source_log], start_hour, end_hour)", "row = reply_log_counts(day, [source_log])",
     'ProducerRules.test_day_window_excludes_night_traffic_and_has_exclusive_closing'),
    ('complete_requires_closing', SHOP, 'coverage_complete is True and now >= closing', 'coverage_complete is True',
     'ProducerRules.test_1950_sync_cannot_claim_complete_until_the_shop_window_ends'),
    ('complete_requires_attestation', SHOP, 'coverage_complete is True and now >= closing', 'now >= closing',
     'ProducerRules.test_source_copy_requires_explicit_complete_coverage_attestation'),
    ('unknown_prevents_complete', SHOP, "and not details['ambiguous'] and not details['handoff_push_failed']", "and not details['handoff_push_failed']",
     'ProducerRules.test_unknown_activity_or_stderr_copy_cannot_certify_complete_receipt'),
    ('push_failure_not_lost_in_v1', SHOP, "and not details['handoff_push_failed']", '',
     'ProducerRules.test_v1_cannot_lose_a_failed_staff_push_and_become_green'),
    ('request_boundary_required_for_complete', SHOP, "and (details['received'] is None or details['inbound_posts'] > 0)", '',
     'ProducerRules.test_missing_request_boundary_cannot_produce_complete_receipt'),
    ('source_is_read_only', SHOP, 'or out_path.is_relative_to(source_log.parent)', '',
     'ProducerRules.test_missing_source_or_writing_into_input_log_is_rejected'),
    ('receipt_remains_counts_only', SHOP, "receipt = dict(schema='shop-replies/v1',", "receipt = dict(customer_text='SYNTHETIC', schema='shop-replies/v1',",
     'ProducerRules.test_shop_receipt_uses_identical_customer_and_delivery_rules'),
    ('new_streak_rules_version', GATES, 'RULES_VERSION = 6', 'RULES_VERSION = 5',
     'VersionRule.test_changed_scoring_rules_invalidate_older_streak_cache'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    work = args.work_root.resolve() / ('r3-' + uuid.uuid4().hex)
    work.mkdir(parents=True)
    names = [SHOP, GATES, 'scripts/level1_offline_checks.py', 'scripts/publish_recovery_report.py',
             'test/test_level1_r3.py']
    originals = {name: (ROOT/name).read_bytes() for name in names}
    before = {name: hashlib.sha256(data).hexdigest() for name, data in originals.items()}
    report = ['TASK-L1GATE-r3 isolated mutations. No live logs or runtime copied.',
              'Source SHA256: ' + json.dumps(before, sort_keys=True)]
    failures = []
    for label, target, old, new, test in MUTATIONS:
        tree = work / label
        for name, data in originals.items():
            path = tree / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        tmp = tree / 'tmp'
        tmp.mkdir()
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1', TEMP=str(tmp), TMP=str(tmp),
                   PYTHONPATH=os.pathsep.join(str(tree/p) for p in ('scripts','test')))

        def run():
            code = ("import io,json,sys,unittest; "
                    "suite=unittest.defaultTestLoader.loadTestsFromName(sys.argv[1]); "
                    "r=unittest.TextTestRunner(stream=io.StringIO()).run(suite); "
                    "print(json.dumps(dict(tests=r.testsRun,failures=len(r.failures),errors=len(r.errors)))); "
                    "sys.exit(0 if r.wasSuccessful() else 1)")
            result = subprocess.run([sys.executable, '-B', '-X', 'utf8', '-c', code,
                                     'test_level1_r3.' + test], cwd=tree, env=env,
                                     capture_output=True, text=True, encoding='utf-8', timeout=30)
            # Raw output is synthetic but still need not be stored.
            try:
                measured = json.loads(result.stdout.strip().splitlines()[-1])
            except (ValueError,IndexError):
                measured = dict(tests=0,failures=0,errors=1)
            return dict(exit=result.returncode, assertion_failure=measured['failures']>0,
                        import_or_runtime_error=measured['errors']>0,**measured)

        healthy = run()
        text = originals[target].decode('utf-8-sig')
        if text.count(old) != 1:
            raise ValueError('MutationAnchorNotUnique:' + label)
        # Preserve mixed historical CRLF/LF bytes: Windows newline translation
        # would turn CRLF into CRCRLF and break backslash continuations.
        (tree/target).write_text(text.replace(old,new,1),encoding='utf-8',newline='')
        red = run()
        (tree/target).write_bytes(originals[target])
        restored = run()
        passed = (healthy['exit'] == restored['exit'] == 0 and red['exit'] != 0
                  and red['assertion_failure'] and not red['import_or_runtime_error'])
        report.append(json.dumps(dict(rule=label, test=test, healthy=healthy, red=red,
                                      restored=restored, verdict='PASS' if passed else 'FAIL'),sort_keys=True))
        print(label + ': ' + ('PASS' if passed else 'FAIL'),flush=True)
        if not passed:
            failures.append(label)
    after = {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in names}
    unchanged = before == after
    report += ['Source SHA256 unchanged: ' + str(unchanged),
               f'Healthy -> red assertion -> healthy: {len(MUTATIONS)-len(failures)}/{len(MUTATIONS)}',
               'Failed rules: ' + json.dumps(failures)]
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text('\n'.join(report)+'\n',encoding='utf-8')
    return 0 if unchanged and not failures else 1


if __name__ == '__main__':
    raise SystemExit(main())
