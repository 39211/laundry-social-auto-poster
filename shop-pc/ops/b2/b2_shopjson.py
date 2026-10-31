"""DEPLOY-B2 step 7: add the top-level "attribution" key to shop.json with a minimal textual insert.
Keeps BOM/CRLF and every existing byte; refuses if the key already exists; proves the parsed
result equals the original plus exactly the new key. Usage: python b2_shopjson.py <shop.json> [--check]"""
import json, sys

ATTR = {"enabled": True, "secret_path": "secrets/attribution_hmac.key",
        "registry_path": "data/attribution/source-codes.json"}

def main(argv):
    path = argv[0]
    check = '--check' in argv
    raw = open(path, 'rb').read()
    bom = raw.startswith(b'\xef\xbb\xbf')
    text = raw[3:].decode('utf-8') if bom else raw.decode('utf-8')
    before = json.loads(text)
    if not isinstance(before, dict):
        print('REFUSED shop.json is not an object'); return 2
    if 'attribution' in before:
        print('ALREADY attribution=%s' % json.dumps(before['attribution'], sort_keys=True)); return 3
    nl = '\r\n' if '\r\n' in text else '\n'
    end = text.rstrip().rfind('}')
    head = text[:end].rstrip()
    if not head or head[-1] in '{,':
        print('REFUSED unexpected shop.json shape'); return 2
    insert = ',' + nl + '  "attribution": ' + json.dumps(ATTR, ensure_ascii=False) + nl
    new_text = head + insert + text[end:]
    after = json.loads(new_text)
    expect = dict(before); expect['attribution'] = ATTR
    if after != expect:
        print('REFUSED parsed result differs from original + attribution'); return 2
    if check:
        print('CHECK OK (no write) bytes %d -> %d' % (len(raw), len(new_text.encode('utf-8')) + (3 if bom else 0))); return 0
    out = new_text.encode('utf-8')
    tmp = path + '.b2tmp'
    with open(tmp, 'wb') as f:
        f.write((b'\xef\xbb\xbf' if bom else b'') + out)
    json.loads(open(tmp, 'rb').read().decode('utf-8-sig'))
    import os
    os.replace(tmp, path)
    print('WROTE attribution key; bom=%s crlf=%s keys=%d' % (bom, nl == '\r\n', len(after)))
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
