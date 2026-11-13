"""Four R7 mutations in disposable copies. No runtime or real data copied."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'scripts/level1_receipts.py'
FILES = (TARGET, 'scripts/level1_gates.py', 'scripts/level1_shop.py',
         'scripts/publish_recovery_report.py', 'scripts/slot_retirements.py',
         'test/test_level1_r7.py', 'schemas/night-service-observation-v1.schema.json',
         'schemas/notify-recipient-consistency-v1.schema.json')
MUTATIONS = (
    ('gap_limit_removed', 'or maximum is not None and maximum > NIGHT_GAP_SECONDS', 'or False',
     'NightRules.test_gap_limit_20_minutes_is_inclusive_and_20_plus_second_fails'),
    ('unhealthy_row_ignored', 'if unhealthy:', 'if False:',
     'NightRules.test_any_unhealthy_row_fails_even_between_or_at_same_time_as_success'),
    ('missing_source_passes',
     "return gate('no_data', '夜間來源缺失、損毀或讀取中變動，不能當通過'",
     "return gate('pass', '夜間來源缺失、損毀或讀取中變動，不能當通過'",
     'NightRules.test_missing_source_never_passes'),
    ('wrong_recipient_count_ignored', "if receipt['wrong_recipient'] > 0:", 'if False:',
     'RecipientRules.test_wrong_recipient_count_fails_even_with_no_duplicates'),
)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(argv)
    work = args.work_root.resolve() / ('mutation-' + uuid.uuid4().hex)
    work.mkdir(parents=True)
    originals = {name:(ROOT/name).read_bytes() for name in FILES}
    before = {name:hashlib.sha256(data).hexdigest() for name,data in originals.items()}
    report = ['R7: isolated synthetic copies only; no real runtime, logs or customer data.',
              'Source SHA256: ' + json.dumps(before, sort_keys=True)]
    failed = []
    for label, old, new, test in MUTATIONS:
        tree = work / label
        for name, data in originals.items():
            path = tree / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        temp = tree / 'tmp'
        temp.mkdir()
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1',
                   PYTHONPATH=os.pathsep.join(str(tree/p) for p in ('scripts', 'test')),
                   TEMP=str(temp), TMP=str(temp))

        def run():
            code = ("import io,json,sys,unittest; "
                    "s=unittest.defaultTestLoader.loadTestsFromName(sys.argv[1]); "
                    "r=unittest.TextTestRunner(stream=io.StringIO()).run(s); "
                    "print(json.dumps(dict(tests=r.testsRun,failures=len(r.failures),errors=len(r.errors),"
                    "skipped=len(r.skipped)))); sys.exit(0 if r.wasSuccessful() else 1)")
            process = subprocess.run([sys.executable, '-B', '-X', 'utf8', '-c', code,
                                      'test_level1_r7.' + test], cwd=tree, env=env, capture_output=True,
                                     text=True, encoding='utf-8', timeout=30)
            try:
                counts = json.loads(process.stdout.strip())
            except ValueError:
                counts = dict(tests=0, failures=0, errors=1, skipped=0)
            return dict(exit=process.returncode, **counts)

        healthy = run()
        source = originals[TARGET].decode('utf-8-sig')
        if source.count(old) != 1:
            raise ValueError('mutation anchor not unique: ' + label)
        (tree/TARGET).write_text(source.replace(old,new,1), encoding='utf-8', newline='')
        red = run()
        (tree/TARGET).write_bytes(originals[TARGET])
        restored = run()
        passed = (healthy['exit'] == restored['exit'] == 0 and red['exit'] != 0
                  and red['failures'] > 0 and red['errors'] == 0
                  and all(row['tests'] == 1 and row['skipped'] == 0 for row in (healthy,red,restored)))
        report.append(json.dumps(dict(rule=label, test=test, healthy=healthy, red=red, restored=restored,
                                      verdict='PASS' if passed else 'FAIL'), sort_keys=True))
        print(label + ': ' + ('PASS' if passed else 'FAIL'), flush=True)
        if not passed:
            failed.append(label)
    after = {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}
    unchanged = before == after
    report += ['Source SHA256 unchanged: ' + str(unchanged),
               f'Healthy -> red assertion -> healthy: {len(MUTATIONS)-len(failed)}/{len(MUTATIONS)}',
               'Failed rules: ' + json.dumps(failed)]
    args.out.write_text('\n'.join(report)+'\n', encoding='utf-8')
    return 0 if unchanged and not failed else 1


if __name__ == '__main__':
    raise SystemExit(main())
