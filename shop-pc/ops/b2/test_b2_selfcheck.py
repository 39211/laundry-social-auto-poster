import json, os, shutil, subprocess, sys, tempfile
repo = r'C:\Users\cyc39\laundry-repo\shop-pc\fxwash'          # release: OLD shop_config (rejects attribution)
fixed = r'C:\Users\cyc39\AI-Lanes\wt\b2-7\shop-pc\fxwash'      # fix/b2c: NEW shop_config
st = r'C:\Users\cyc39\AI-Lanes\api-jobs\shop-deploy-1031\stage-B2'
ok = True
def check(n, c):
    global ok; print(('PASS ' if c else 'FAIL ') + n); ok = ok and c
def tree(with_key=True, enabled=True, attr=True, config_src=fixed):
    d = tempfile.mkdtemp()
    shutil.copytree(repo, d, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', 'logs', 'backups'))
    shutil.copy(os.path.join(config_src, 'shop_config.py'), os.path.join(d, 'shop_config.py'))
    cfg = json.loads(open(os.path.join(repo, 'shop.json'), 'rb').read().decode('utf-8-sig'))
    if attr:
        cfg['attribution'] = {'enabled': enabled, 'secret_path': 'secrets/attribution_hmac.key', 'registry_path': 'data/attribution/source-codes.json'}
    open(os.path.join(d, 'shop.json'), 'w', encoding='utf-8').write(json.dumps(cfg, ensure_ascii=False, indent=2))
    os.makedirs(os.path.join(d, 'secrets'), exist_ok=True)
    k = os.path.join(d, 'secrets', 'attribution_hmac.key')
    if os.path.exists(k): os.remove(k)
    if with_key:
        subprocess.run([sys.executable, os.path.join(repo, 'tools', 'make_attribution_secret.py'), 'secrets/attribution_hmac.key'], cwd=d, check=True, capture_output=True)
    return d
def run(d):
    r = subprocess.run([sys.executable, '-I', '-S', '-B', os.path.join(st, 'b2_selfcheck.py')], cwd=d, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()
rc, out = run(tree()); print('  ', out.replace('\n', ' | ')); check('fixed shop_config + key -> exit 0, load_shop ok, ledger_enabled=True', rc == 0 and 'load_shop=ok' in out and 'ledger_enabled=True' in out)
d = tree(); run(d); check('selfcheck writes no ledger rows', not os.path.exists(os.path.join(d, 'data', 'inquiries.jsonl')))
rc, out = run(tree(config_src=repo)); print('  ', out[:160]); check('OLD shop_config (10/31 14:04 failure) -> exit 1 load_shop=FAIL', rc == 1 and 'load_shop=FAIL' in out)
rc, out = run(tree(with_key=False)); check('missing key -> exit 1', rc == 1 and 'ledger_enabled=False' in out)
rc, out = run(tree(enabled=False)); check('enabled=false -> exit 1', rc == 1)
rc, out = run(tree(attr=False)); check('no attribution key -> exit 1', rc == 1)
print('ALL OK' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
