# -*- coding: utf-8 -*-
"""Unicode-safe path listing and hashing for visual QA.

PowerShell 5.1 cannot match Chinese paths reliably. This helper lists PNG
files and writes UTF-8 sidecar fragments without going through PS -match.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys


def _out(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8"))
    if not text.endswith("\n"):
        sys.stdout.buffer.write(b"\n")


def list_png(directory: str) -> None:
    if not os.path.isdir(directory):
        return
    names = []
    for name in os.listdir(directory):
        if name.lower().endswith(".png"):
            names.append(os.path.join(directory, name))
    names.sort()
    for path in names:
        _out(path)


def sha256_file(path: str) -> None:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    _out(digest.hexdigest())


def write_bytes(path: str) -> None:
    data = sys.stdin.buffer.read()
    with open(path, "wb") as handle:
        handle.write(data)


def write_text_no_bom(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def run_codex(stdout_path: str, args_file: str) -> int:
    with open(args_file, "r", encoding="utf-8-sig") as handle:
        args = json.load(handle)
    if not isinstance(args, list) or not args:
        sys.stderr.write("run-codex: args file must be a JSON array\n")
        return 2
    prompt = sys.stdin.buffer.read()
    with open(stdout_path, "wb") as out:
        proc = subprocess.run(args, input=prompt, stdout=out, stderr=sys.stderr.buffer)
    return int(proc.returncode)


def list_rejected(path: str) -> None:
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8-sig") as handle:
        payload = json.load(handle)
    for entry in payload.get("concepts", []):
        ident = entry.get("id")
        if ident:
            _out(str(ident))


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write("usage: visual_qa_io.py list-png|sha256|list-rejected PATH\n")
        return 2
    cmd = argv[1]
    target = argv[2] if len(argv) > 2 else ""
    if cmd == "list-png":
        list_png(target)
        return 0
    if cmd == "sha256":
        sha256_file(target)
        return 0
    if cmd == "list-rejected":
        list_rejected(target)
        return 0
    if cmd == "write-bytes":
        write_bytes(target)
        return 0
    if cmd == "write-text":
        write_text_no_bom(target, sys.stdin.read())
        return 0
    if cmd == "run-codex":
        if len(argv) < 4:
            sys.stderr.write("usage: visual_qa_io.py run-codex STDOUT_PATH ARGS_JSON\n")
            return 2
        return run_codex(argv[2], argv[3])
    sys.stderr.write("unknown command: %s\n" % cmd)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
