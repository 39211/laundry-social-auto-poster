"""L1GATE-r5 healthy -> assertion red -> healthy in isolated synthetic copies."""
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
PROBE = 'bench/_shop_copy_probe.py'
TEST = 'test_level1_ownership_r5.'
MUTATIONS = (
    ('ownership_window_ignored', SHOP, 'ownership=ownership)', 'ownership=None)',
     'OwnershipWindows.test_outside_probe_failures_never_become_customers'),
    ('unknown_ownership_passes', SHOP,
     "return self.states[index] if not self.errors and index >= 0 else 'unknown'",
     "return self.states[index] if not self.errors and index >= 0 else 'ai'",
     'OwnershipWindows.test_unknown_ownership_is_no_data_and_never_customer_traffic'),
    ('onboarding_marks_only_latest', SHOP, 'for p in candidates:', 'for p in candidates[-1:]:',
     'OnboardingGroup.test_binding_marks_all_open_events_with_same_prefix'),
    ('probe_prefix_reverted', PROBE, "uid = 'UL1TEST_' + '0' * 24 + '1'", "uid = 'U' + '0' * 31 + '1'",
     'ProbeNamespace.test_probe_uid_is_excluded_namespace_without_executing_probe'),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-root', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--probe-path', type=Path,
        default=Path('C:/Users/cyc39/AI-Lanes/collab/trunk/bench/_shop_copy_probe.py'))
    args = parser.parse_args()
    paths = (SHOP, 'scripts/level1_gates.py', 'scripts/level1_offline_checks.py',
             'scripts/slot_retirements.py', 'scripts/publish_recovery_report.py',
             'test/test_level1_ownership_r5.py')
    sources = {name: ROOT / name for name in paths}
    sources[PROBE] = args.probe_path
    original = {name: path.read_bytes() for name, path in sources.items()}
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in original.items()}
    work = args.work_root.resolve() / ('r5-' + uuid.uuid4().hex)
    report = ['TASK-L1GATE-r5. Isolated source + synthetic fixtures only; no real logs or credentials.',
              'Source SHA256: ' + json.dumps(hashes, sort_keys=True)]
    failures = []
    for label, target, old, new, selector in MUTATIONS:
        tree = work / label
        for name, data in original.items():
            path = tree / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        tmp = tree / 'tmp'
        tmp.mkdir()
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1', TEMP=str(tmp), TMP=str(tmp),
                   PYTHONPATH=os.pathsep.join(str(tree / p) for p in ('scripts', 'test')),
                   L1GATE_PROBE_PATH=str(tree / PROBE))

        def run():
            code = ("import contextlib,io,json,sys,unittest; b=io.StringIO(); "
                    "suite=unittest.defaultTestLoader.loadTestsFromName(sys.argv[1]); "
                    "r=unittest.TextTestRunner(stream=b).run(suite); "
                    "print(json.dumps(dict(tests=r.testsRun,failures=len(r.failures),errors=len(r.errors)))); "
                    "sys.exit(0 if r.wasSuccessful() else 1)")
            result = subprocess.run([sys.executable, '-B', '-X', 'utf8', '-c', code, TEST + selector],
                                    cwd=tree, env=env, capture_output=True, text=True,
                                    encoding='utf-8', timeout=30)
            try:
                counts = json.loads(result.stdout.strip().splitlines()[-1])
            except (ValueError, IndexError):
                counts = dict(tests=0, failures=0, errors=1)
            return dict(exit=result.returncode, **counts)

        healthy = run()
        source = original[target].decode('utf-8-sig').replace('\r\n', '\n')
        if source.count(old) != 1:
            raise ValueError('MutationAnchorNotUnique:' + label)
        (tree / target).write_text(source.replace(old, new, 1), encoding='utf-8', newline='')
        red = run()
        (tree / target).write_bytes(original[target])
        restored = run()
        passed = (healthy['exit'] == restored['exit'] == 0 and healthy['tests'] > 0
                  and red['exit'] != 0 and red['failures'] > 0 and red['errors'] == 0)
        report.append(json.dumps(dict(rule=label, test=selector, healthy=healthy, red=red,
                                      restored=restored, verdict='PASS' if passed else 'FAIL'), sort_keys=True))
        print(label + ': ' + ('PASS' if passed else 'FAIL'), flush=True)
        if not passed:
            failures.append(label)
    unchanged = hashes == {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sources.items()}
    report.extend(['Source SHA256 unchanged: ' + str(unchanged),
                   f'Healthy -> assertion red -> healthy: {len(MUTATIONS)-len(failures)}/{len(MUTATIONS)}',
                   'Failed rules: ' + json.dumps(failures)])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text('\n'.join(report) + '\n', encoding='utf-8')
    return 0 if unchanged and not failures else 1


if __name__ == '__main__':
    raise SystemExit(main())
