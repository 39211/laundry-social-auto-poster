import json, os, subprocess, sys, tempfile
HERE = r'C:\Users\cyc39\AI-Lanes\api-jobs\shop-deploy-1031\stage-B2\b2_shopjson.py'
def run(path, *a):
    r = subprocess.run([sys.executable, HERE, path, *a], capture_output=True, text=True)
    return r.returncode, r.stdout.strip()
ok = True
def check(name, cond):
    global ok
    print(('PASS ' if cond else 'FAIL ') + name); ok = ok and cond
d = tempfile.mkdtemp()
# 1 CRLF, no BOM, nested, trailing newline
p = os.path.join(d, 'a.json')
src = '{\r\n  "shop_id": "fx",\r\n  "privacy": {"x": [1, 2]},\r\n  "name": "私享家"\r\n}\r\n'
open(p, 'wb').write(src.encode('utf-8'))
rc, out = run(p, '--check'); check('check mode exit 0, no write', rc == 0 and open(p, 'rb').read() == src.encode('utf-8'))
rc, out = run(p); b = open(p, 'rb').read(); t = b.decode('utf-8')
check('write exit 0', rc == 0)
check('original bytes kept as prefix', t.startswith(src.rstrip()[:-1].rstrip()))
check('crlf only (no bare LF)', t.count('\n') == t.count('\r\n'))
dd = json.loads(t); check('parsed = original + attribution', dd == {**json.loads(src), 'attribution': {"enabled": True, "secret_path": "secrets/attribution_hmac.key", "registry_path": "data/attribution/source-codes.json"}})
rc, out = run(p); check('second run refused (exit 3), file unchanged', rc == 3 and open(p, 'rb').read() == b)
# 2 BOM + LF
q = os.path.join(d, 'b.json'); src2 = '{\n  "a": 1\n}'
open(q, 'wb').write(b'\xef\xbb\xbf' + src2.encode('utf-8'))
rc, out = run(q); b2 = open(q, 'rb').read()
check('bom kept', rc == 0 and b2.startswith(b'\xef\xbb\xbf') and b'\r\n' not in b2)
# 3 empty object refused
r3 = os.path.join(d, 'c.json'); open(r3, 'w').write('{}')
rc, out = run(r3); check('empty object refused', rc == 2 and open(r3).read() == '{}')
# 4 invalid json -> nonzero, untouched
r4 = os.path.join(d, 'd.json'); open(r4, 'w').write('{"a": 1,}')
rc, out = run(r4); check('invalid json untouched', rc != 0 and open(r4).read() == '{"a": 1,}')
print('ALL OK' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
