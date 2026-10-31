"""apply_edits.py <answer.md> <root> [--dry-run] [--only rel1,rel2] [--skip-files]

Apply an API answer made of
  === EDIT: <rel path> ===   with <<<<<<< OLD / ======= / >>>>>>> NEW blocks
  === FILE: <rel path> ===   followed by one fenced code block (full content)
All-or-nothing: every OLD must occur exactly once (after earlier blocks of the same
file were applied); otherwise nothing is written. Keeps each file's BOM and newline
style. Python 3.11+, stdlib only (also usable on the shop PC).
"""
import re
import sys
from pathlib import Path

HDR = re.compile(r"^=== (EDIT|FILE): (.+?) ===\s*$")


def parse(text):
    lines = text.splitlines()
    out = []  # (kind, rel, payload)
    i = 0
    while i < len(lines):
        m = HDR.match(lines[i])
        if not m:
            i += 1
            continue
        kind, rel = m.group(1), m.group(2).strip().strip("`")
        j = i + 1
        while j < len(lines) and not HDR.match(lines[j]):
            j += 1
        body = lines[i + 1:j]
        if kind == "FILE":
            k = 0
            while k < len(body) and not body[k].lstrip().startswith("```"):
                k += 1
            if k == len(body):
                raise SystemExit(f"FILE {rel}: no fenced block")
            fence = re.match(r"^\s*(`{3,})", body[k]).group(1)
            e = k + 1
            while e < len(body) and body[e].strip() != fence:
                e += 1
            if e == len(body):
                raise SystemExit(f"FILE {rel}: unterminated fence")
            out.append(("FILE", rel, "\n".join(body[k + 1:e]) + "\n"))
        else:
            blocks, k = [], 0
            while k < len(body):
                if body[k].rstrip() == "<<<<<<< OLD":
                    s = k + 1
                    mid = s
                    while mid < len(body) and body[mid].rstrip() != "=======":
                        mid += 1
                    end = mid + 1
                    while end < len(body) and body[end].rstrip() != ">>>>>>> NEW":
                        end += 1
                    if mid >= len(body) or end >= len(body):
                        raise SystemExit(f"EDIT {rel}: malformed block near line {i + 1 + k + 1}")
                    blocks.append(("\n".join(body[s:mid]), "\n".join(body[mid + 1:end])))
                    k = end + 1
                else:
                    k += 1
            out.append(("EDIT", rel, blocks))
        i = j
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    answer, root = Path(argv[0]), Path(argv[1])
    dry = "--dry-run" in argv
    skip_files = "--skip-files" in argv
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    items = parse(answer.read_text(encoding="utf-8"))
    state = {}  # rel -> [text_lf, bom, crlf, existed]
    errors, report = [], []
    for kind, rel, payload in items:
        if only and rel not in only:
            continue
        p = root / rel
        if kind == "FILE":
            if skip_files:
                continue
            existed = p.exists()
            crlf = p.suffix.lower() in (".ps1", ".cmd", ".bat")
            bom = False
            if existed:
                raw = p.read_bytes()
                bom = raw.startswith(b"\xef\xbb\xbf")
                crlf = b"\r\n" in raw
            state[rel] = [payload, bom, crlf, existed]
            report.append(f"FILE {rel} ({'replace' if existed else 'new'}, {len(payload)} chars)")
            continue
        if rel not in state:
            if not p.exists():
                errors.append(f"EDIT {rel}: file not found")
                continue
            raw = p.read_bytes()
            bom = raw.startswith(b"\xef\xbb\xbf")
            txt = raw[3:].decode("utf-8") if bom else raw.decode("utf-8")
            crlf = "\r\n" in txt
            state[rel] = [txt.replace("\r\n", "\n"), bom, crlf, True]
        cur = state[rel][0]
        for n, (old, new) in enumerate(payload, 1):
            c = cur.count(old) if old else 0
            if c != 1:
                errors.append(f"EDIT {rel} block {n}: OLD matches {c} times: {old[:80]!r}")
                continue
            cur = cur.replace(old, new, 1)
        state[rel][0] = cur
        report.append(f"EDIT {rel}: {len(payload)} blocks")
    for r in report:
        print(r)
    if errors:
        for e in errors:
            print("ERROR", e)
        print(f"NOTHING WRITTEN ({len(errors)} errors)")
        return 1
    if dry:
        print("DRY RUN OK, nothing written")
        return 0
    for rel, (txt, bom, crlf, existed) in state.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        data = txt.replace("\n", "\r\n") if crlf else txt
        b = data.encode("utf-8")
        p.write_bytes((b"\xef\xbb\xbf" + b) if bom else b)
    print(f"WROTE {len(state)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
