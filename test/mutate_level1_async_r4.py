"""L1GATE-r4 isolated healthy -> assertion red -> healthy, synthetic logs only."""
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
MUTATIONS = (
    ('lifo_instead_of_fifo', SHOP, 'p = pending.popleft()', 'p = pending.pop()',
     'AsyncMatching.test_fifo_reply_answers_oldest_guard_event'),
    ('unbounded_window', SHOP, 'REPLY_WINDOW_SECONDS = 180', "REPLY_WINDOW_SECONDS = float('inf')",
     'AsyncMatching.test_reply_window_is_inclusive_at_180_seconds_and_expires_at_181'),
    ('cross_day_matching', SHOP, 'if ts.date() != day:', 'if False:',
     'AsyncMatching.test_never_matches_across_midnight_even_within_180_seconds'),
    ('owner_failure_is_success', SHOP, "outcome(ts, 'push' if push[1] == 'True' else 'push_failed')",
     "outcome(ts, 'push')", 'OwnerNotifications.test_failed_summary_push_never_answers_the_event'),
    ('unverified_onboarding_is_replied', SHOP, "        result = 'unanswered'",
     "        p['reply'] |= p['onboarding']\n        result = 'unanswered'",
     'OnboardingEvidence.test_unlogged_onboarding_reply_is_no_data_never_pass_or_fail'),
    ('missing_receipt_field_defaulted_to_zero', SHOP,
     'def shop_counts(day, path, now):\n    data = load(path)',
     'def shop_counts(day, path, now):\n    data = load(path)\n'
     '    if isinstance(data, dict):\n        for key in COUNTS:\n            data.setdefault(key, 0)',
     'ShopReceiptContract.test_missing_any_one_count_is_no_data_instead_of_defaulting_zero'),
    ('morning_sync_scores_current_day', SHOP, 'day = local.date() - timedelta(days=1)',
     'day = local.date()',
     'MorningSync.test_next_morning_sync_produces_previous_day_receipt_including_late_shop_events'),
    ('morning_sync_before_1005', SHOP, 'if (local.hour, local.minute) < (10, 5):', 'if False:',
     'MorningSync.test_morning_sync_requires_1005_or_later_and_aware_time'),
    ('unverified_onboarding_receipt_complete', SHOP, "and not details['unverified_onboarding']", '',
     'ShopReceiptContract.test_unverified_onboarding_cannot_be_certified_complete_by_v1_producer'),
    ('old_scoring_cache_still_valid', GATES, 'RULES_VERSION = 7', 'RULES_VERSION = 6',
     'RuleCache.test_previous_async_scoring_results_are_invalidated'),
    ('async_reply_tail_dropped_at_closing', SHOP,
     'and not end_hour * 3600 <= clock_seconds <= end_hour * 3600 + REPLY_WINDOW_SECONDS', '',
     'ShopReceiptContract.test_last_shop_event_can_receive_its_async_reply_after_closing'),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    work = args.work_root.resolve() / ('r4-' + uuid.uuid4().hex)
    work.mkdir(parents=True)
    names = (SHOP, GATES, 'scripts/level1_offline_checks.py', 'scripts/slot_retirements.py',
             'scripts/publish_recovery_report.py', 'test/test_level1_async_r4.py')
    originals = {name: (ROOT / name).read_bytes() for name in names}
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in originals.items()}
    report = ['TASK-L1GATE-r4. Isolated code and synthetic fixtures only; no real logs copied.',
              'Source SHA256: ' + json.dumps(hashes, sort_keys=True)]
    failures = []
    for label, target, old, new, selector in MUTATIONS:
        tree = work / label
        for name, data in originals.items():
            path = tree / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        tmp = tree / 'tmp'
        tmp.mkdir()
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1',
                   TEMP=str(tmp), TMP=str(tmp),
                   PYTHONPATH=os.pathsep.join(str(tree / part) for part in ('scripts', 'test')))

        def run():
            code = ("import contextlib,io,json,sys,unittest; buffer=io.StringIO(); "
                    "suite=unittest.defaultTestLoader.loadTestsFromName(sys.argv[1]); "
                    "r=unittest.TextTestRunner(stream=buffer).run(suite); "
                    "print(json.dumps(dict(tests=r.testsRun,failures=len(r.failures),errors=len(r.errors)))); "
                    "sys.exit(0 if r.wasSuccessful() else 1)")
            result = subprocess.run([sys.executable, '-B', '-X', 'utf8', '-c', code,
                                      'test_level1_async_r4.' + selector],
                                     cwd=tree, env=env, capture_output=True, text=True,
                                     encoding='utf-8', timeout=30)
            try:
                counts = json.loads(result.stdout.strip().splitlines()[-1])
            except (ValueError, IndexError):
                counts = dict(tests=0, failures=0, errors=1)
            return dict(exit=result.returncode, **counts)

        healthy = run()
        source = originals[target].decode('utf-8-sig').replace('\r\n', '\n')
        if source.count(old) != 1:
            raise ValueError('MutationAnchorNotUnique:' + label)
        (tree / target).write_text(source.replace(old, new, 1), encoding='utf-8', newline='')
        red = run()
        (tree / target).write_bytes(originals[target])
        restored = run()
        passed = (healthy['exit'] == restored['exit'] == 0 and healthy['tests'] > 0
                  and red['exit'] != 0 and red['failures'] > 0 and red['errors'] == 0)
        report.append(json.dumps(dict(rule=label, test=selector, healthy=healthy, red=red,
                                      restored=restored, verdict='PASS' if passed else 'FAIL'), sort_keys=True))
        print(label + ': ' + ('PASS' if passed else 'FAIL'), flush=True)
        if not passed:
            failures.append(label)
    unchanged = hashes == {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in names}
    report += ['Source SHA256 unchanged: ' + str(unchanged),
               f'Healthy -> red assertion -> healthy: {len(MUTATIONS) - len(failures)}/{len(MUTATIONS)}',
               'Failed rules: ' + json.dumps(failures)]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text('\n'.join(report) + '\n', encoding='utf-8')
    return 0 if unchanged and not failures else 1


if __name__ == '__main__':
    raise SystemExit(main())
