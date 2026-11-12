"""Reproducible rule-removal proof, in disposable copies; synthetic tests only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
SHOP = 'scripts/level1_shop.py'
GATES = 'scripts/level1_gates.py'

# Every mutant removes a decision/guard, with an exact named regression test.
MUTATIONS = [
 ('shop_self_registration', SHOP, "action == 'shop_fixed_no_cover'", 'False',
  'OwnershipTests.test_shop_self_registered_is_timely_without_ai_tunnel_event'),
 ('handback_verify', SHOP, "row.get('verify') == 'match'", 'True',
  'OwnershipTests.test_verified_handback_and_local_date_are_required'),
 ('day_ai_cover', SHOP, 'if ai_count:', 'if False:',
  'OwnershipTests.test_ai_day_cover_overrides_shop_observation'),
 ('check_error', SHOP, "and not row.get('check_error')", '',
  'OwnershipTests.test_check_error_is_not_shop_confirmation'),
 ('ownership_date', SHOP, 'ts.date() == day and start_hour', 'True and start_hour',
  'OwnershipTests.test_verified_handback_and_local_date_are_required'),
 ('handback_deadline', SHOP, '(first - expected).total_seconds() <= 300', 'True',
  'OwnershipTests.test_missing_corrupt_late_and_night_records_do_not_pass'),
 ('active_handover_source', GATES, 'if day >= shop.CUTOVER and closed(tomorrow) is False:', 'if False:',
  'OwnershipTests.test_current_service_uses_day_cover_and_rejects_retired_heartbeat'),
 ('retired_heartbeat', GATES, 'if day >= shop.CUTOVER:\n        # The old sampler', 'if False:\n        # The old sampler',
  'OwnershipTests.test_current_service_uses_day_cover_and_rejects_retired_heartbeat'),
 ('received_event_boundary', SHOP, "elif text.startswith(('[Webhook Text] User ', '[Webhook Image] Received image ')):", 'elif False:',
  'LogTests.test_batch_events_and_handoff_ack_are_counted_once'),
 ('reply_success_marker', SHOP, "elif SUCCESS.fullmatch(text):", 'elif False:',
  'LogTests.test_batch_events_and_handoff_ack_are_counted_once'),
 ('reply_failure', SHOP, "counts['reply_failed'] += 1", 'pass',
  'LogTests.test_reply_failures_stay_red_even_with_a_success'),
 ('staff_delivery', SHOP, "pending['push'] |= ok", 'pass',
  'LogTests.test_staff_push_without_reply_can_answer_but_failure_cannot'),
 ('owner_push_failure', SHOP, "elif counts['reply_failed'] or stats['handoff_push_failed']:", "elif counts['reply_failed']:",
  'LogTests.test_staff_push_without_reply_can_answer_but_failure_cannot'),
 ('disjoint_reply_handoff', SHOP, "if pending['reply']:", 'if False:',
  'LogTests.test_batch_events_and_handoff_ack_are_counted_once'),
 ('canonical_log', SHOP, 'next((p for p in paths if p.is_file()), None)', 'next((p for p in reversed(paths) if p.is_file()), None)',
  'LogTests.test_stderr_mirror_never_double_counts_identical_events'),
 ('paused_is_not_delivery', SHOP, "elif stats['ambiguous'] or source.name.endswith('.err.log'):", "elif source.name.endswith('.err.log'):",
  'LogTests.test_paused_turn_is_unmeasured_without_owner_delivery'),
 ('missing_half_null', SHOP, "else None for k in COUNTS}", 'else 0 for k in COUNTS}',
  'LogTests.test_missing_shop_half_stays_null_and_failure_dominates_missing'),
 ('unobserved_night_null', SHOP, "details.update({k: None for k in (*COUNTS, 'unanswered')})", 'pass',
  'LogTests.test_ping_duplicate_get_rejected_post_and_wrong_day_never_inflate_replies'),
 ('shop_complete_receipt', SHOP, "and data.get('complete') is True", '',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('shop_count_integer_type', SHOP, 'type(data.get(k)) is int and data[k] >= 0', 'data[k] >= 0',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('shop_count_nonnegative', SHOP, 'type(data.get(k)) is int and data[k] >= 0', 'type(data.get(k)) is int',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('shop_no_private_extra_fields', SHOP, 'and set(data) <= allowed', '',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('shop_schema_version', SHOP, "and data.get('schema') == 'shop-replies/v1'", '',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('shop_receipt_date', SHOP, "and data.get('date') == str(day)", '',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('shop_day_window', SHOP, "and data.get('window') == 'shop_day'", '',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('shop_counter_invariants', SHOP, "answered > data['received']", 'False',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('shop_future_receipt', SHOP, 'and generated <= now', '',
  'LogTests.test_shop_schema_complete_disjoint_nonnegative_counts_and_time'),
 ('current_receipt_schema', SHOP, "or data.get('schema') != 'level1-shop-checks/v2'", '',
  'EvidenceTests.test_required_shop_groups_reject_legacy_wrong_runtime_skips_and_missing_suite'),
 ('mandatory_suite_list', SHOP, "if len(suites) != len(expected) or {s.get('suite') for s in suites if isinstance(s, dict)} != expected:", 'if False:',
  'EvidenceTests.test_required_shop_groups_reject_legacy_wrong_runtime_skips_and_missing_suite'),
 ('same_day_live_hash', SHOP, 'and digest(Path(live) / n) == sha', '',
  'EvidenceTests.test_changed_live_code_invalidates_same_day_receipt'),
 ('manifest_privacy', SHOP, 'and all(source_allowed(n)', 'and all(True',
  'IsolatedRunnerTests.test_manifest_cannot_redirect_reader_to_customer_or_secret_files'),
 ('base_red_test_hash', SHOP, "and row.get('test_sha256') == spec[0]", '',
  'EvidenceTests.test_base_red_is_visible_not_pass_and_changed_shape_or_bytes_fail'),
 ('base_red_failure_shape', SHOP, "and tuple(row.get(k) for k in ('tests', 'failures', 'errors')) == spec[1:4]", '',
  'EvidenceTests.test_base_red_is_visible_not_pass_and_changed_shape_or_bytes_fail'),
 ('baseline_never_counts_as_pass', SHOP, "existing.append(suite['suite'])", "existing.append(suite['suite']); total += suite['tests']",
  'EvidenceTests.test_base_red_is_visible_not_pass_and_changed_shape_or_bytes_fail'),
 ('reader_rejects_skipped_cases', SHOP, "or suite['skipped']", '',
  'EvidenceTests.test_required_shop_groups_reject_legacy_wrong_runtime_skips_and_missing_suite'),
 ('partial_day', GATES, "and not evaluation.get('partial_day')", '',
  'EvidenceTests.test_partial_day_cannot_count_as_a_complete_day'),
 ('copy_source_bytes', SHOP, 'shutil.copyfile(source, target)', 'pass',
  'IsolatedRunnerTests.test_snapshot_copies_current_code_not_private_data_or_old_runtime'),
 ('exclude_private_subtrees', SHOP, "if not any(part in ('__pycache__', 'tests', 'secrets', 'data', 'logs') for part in p.relative_to(live).parts)", 'if True',
  'IsolatedRunnerTests.test_snapshot_copies_current_code_not_private_data_or_old_runtime'),
 ('source_link_guard', SHOP, 'if any(p.is_symlink() or p.is_junction() for p in (source, *source.parents)):', 'if False:',
  'IsolatedRunnerTests.test_snapshot_rejects_a_link_before_reading_source_bytes'),
 ('network_guard', SHOP, "'socket.connect', 'socket.getaddrinfo', 'socket.bind',", "'socket.getaddrinfo', 'socket.bind',",
  'IsolatedRunnerTests.test_real_per_file_runner_blocks_network_and_live_reads_writes'),
 ('filesystem_guard', SHOP, 'if not inside and (write or not any(p.is_relative_to(lib) for lib in libraries)):', 'if False:',
  'IsolatedRunnerTests.test_real_per_file_runner_blocks_network_and_live_reads_writes'),
 ('skip_is_not_pass', SHOP, "if row['status'] == 'pass' and row['skipped']:", 'if False:',
  'IsolatedRunnerTests.test_zero_cases_and_skips_are_not_a_green_suite'),
 ('current_runtime_wire', GATES, "current = day >= shop.CUTOVER", 'current = False',
  'EvidenceTests.test_current_checklist_uses_shop_readers_but_6_to_12_stay_identical'),
 ('budget_300', SHOP, 'BUDGET = 300', 'BUDGET = 780',
  'IsolatedRunnerTests.test_producer_uses_shop_snapshot_and_has_300_second_budget'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    workspace = args.work_root.resolve() / ('mutation-' + uuid.uuid4().hex)
    workspace.mkdir(parents=True)
    files = [SHOP, GATES, 'scripts/level1_offline_checks.py', 'scripts/publish_recovery_report.py',
             'test/test_level1_current.py']
    before = {n: hashlib.sha256((ROOT / n).read_bytes()).hexdigest() for n in files}
    sources = {n: (ROOT / n).read_text(encoding='utf-8-sig') for n in files}
    report = ['TASK-L1GATE-r1 rule-removal mutations; synthetic fixtures only.',
              'Original source hashes: ' + json.dumps(before, sort_keys=True)]

    def run(folder, test):
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1',
                   PYTHONPATH=os.pathsep.join(str(folder / p) for p in ('scripts', 'test')),
                   TEMP=str(workspace), TMP=str(workspace))
        return subprocess.run([sys.executable, '-B', '-X', 'utf8', '-m', 'unittest', test],
                              cwd=folder, env=env, capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=60)

    baseline = workspace / 'baseline'
    for name, body in sources.items():
        dest = baseline / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body, encoding='utf-8')
    result = run(baseline, 'test_level1_current')
    summary = re.findall(r'^Ran \d+ tests? in [^\n]*', result.stdout + result.stderr, re.M)
    report.append('BASELINE exit=' + str(result.returncode) + ' ' + '; '.join(summary))
    if result.returncode:
        raise RuntimeError('baseline is not green: ' + result.stderr[-3000:])
    all_red = True
    for identifier, name, old, new, test in MUTATIONS:
        if sources[name].count(old) != 1:
            raise ValueError('mutation anchor not unique: ' + identifier)
        folder = workspace / identifier
        shutil.copytree(baseline, folder)
        (folder / name).write_text(sources[name].replace(old, new, 1), encoding='utf-8')
        test = 'test_level1_current.' + test
        result = run(folder, test)
        failures = re.findall(r'^(?:FAIL|ERROR): ([^\n]+)', result.stdout + result.stderr, re.M)
        red = result.returncode != 0 and any(test.split('.')[-1] in line for line in failures)
        all_red &= red
        line = identifier + ': ' + ('RED' if red else 'SURVIVED/INVALID') + ' exit=' + str(result.returncode) + ' test=' + test
        report.append(line)
        print(line, flush=True)
    unchanged = before == {n: hashlib.sha256((ROOT / n).read_bytes()).hexdigest() for n in files}
    report += ['SOURCE_UNCHANGED=' + str(unchanged), f'TOTAL {len(MUTATIONS)}; ALL_NAMED_RED={all_red}']
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text('\n'.join(report) + '\n', encoding='utf-8')
    return 0 if all_red and unchanged else 1


if __name__ == '__main__':
    raise SystemExit(main())
