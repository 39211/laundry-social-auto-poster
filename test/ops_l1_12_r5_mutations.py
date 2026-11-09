"""R5 mutants run only in task-owned copies; require assertion failures, not errors."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    work = ROOT / 'output/operations' / ('ops-l1-12-r5-mutations-' + uuid.uuid4().hex)
    files = ('scripts/level1_offline_checks.py', 'test/test_level1_r5.py', 'test/ops_l1_python.py')
    originals = {name: (ROOT / name).read_bytes() for name in files}
    for name, content in originals.items():
        dest = work / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
    mutants = (
        ('zero_cases_pass', 'tests > counts["skipped"]', 'tests >= counts["skipped"]',
         'test_zero_cases_never_pass'),
        ('nonzero_exit_pass', 'if returncode != 0:', 'if False:', 'test_nonzero_exit_never_pass'),
        ('archive_dirty_overlay', 'source.extractall(snapshot, filter="data")',
         'source.extractall(snapshot, filter="data")\n'
         '        __import__("shutil").copytree(root / "line-bot", snapshot / "line-bot", dirs_exist_ok=True)',
         'test_snapshot_excludes_dirty_worktree_and_untracked_files'),
    )
    runs = []
    def run(label):
        result = subprocess.run([sys.executable, '-B', '-X', 'utf8', 'test/ops_l1_python.py', 'test_level1_r5.py'],
                                cwd=work, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'),
                                capture_output=True, text=True, encoding='utf-8', timeout=90)
        output = result.stdout + result.stderr
        (work / (label + '.txt')).write_text(output, encoding='utf-8')
        row = dict(name=label, exit_code=result.returncode,
                   failures=re.findall(r'^FAIL: (\w+)', output, re.M),
                   errors=re.findall(r'^ERROR: (\w+)', output, re.M),
                   tests=int(re.findall(r'^Ran (\d+) tests? in', output, re.M)[-1]),
                   skipped=int(m[-1]) if (m := re.findall(r'^(?:OK|FAILED).*skipped=(\d+)', output, re.M)) else 0)
        runs.append(row)
        return row
    proof = dict(task='OPS-L1-12 r5', runs=runs,
                 candidate_sha256={n: hashlib.sha256(b).hexdigest() for n,b in originals.items()})
    target = work / files[0]
    try:
        assert run('baseline')['exit_code'] == 0, runs
        for name, old, new, required in mutants:
            source = originals[files[0]].decode('utf-8')
            assert source.count(old) == 1, (name, source.count(old))
            target.write_text(source.replace(old,new), encoding='utf-8')
            row = run(name)
            row['mutant_sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
            assert row['exit_code'] == 1 and not row['errors'] and required in row['failures'], row
            print(name + ': RED ' + required, flush=True)
            target.write_bytes(originals[files[0]])
    finally:
        target.write_bytes(originals[files[0]])
        proof['candidate_unchanged'] = all((ROOT / n).read_bytes() == b for n,b in originals.items())
        proof['copy_restored'] = all((work / n).read_bytes() == b for n,b in originals.items())
        (work / 'proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
    assert run('restored')['exit_code'] == 0, runs
    proof['killed'] = sum(r['exit_code'] == 1 for r in runs)
    (work / 'proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
    assert proof['candidate_unchanged'] and proof['copy_restored'] and proof['killed']==3
    print('MUTANTS_KILLED=3 RESTORED_GREEN=true ' + str(work / 'proof.json'), flush=True)


if __name__ == '__main__':
    main()
