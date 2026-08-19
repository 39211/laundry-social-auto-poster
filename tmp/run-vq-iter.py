# -*- coding: utf-8 -*-
"""One-shot visual-QA judge runner for prompt iteration. Writes only under tmp/."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP_DATA = os.environ.get("APPDATA", "")
CODEX = os.path.join(APP_DATA, "npm", "codex.cmd")
TSX = os.path.join(ROOT, "node_modules", ".bin", "tsx.cmd")
CLI = os.path.join(ROOT, "src", "visualQaCli.ts")
IO_PY = os.path.join(ROOT, "scripts", "visual_qa_io.py")


def run(name: str, fixture_id: str, has_middle: bool, existing_qa: str | None = None) -> dict:
    qa = existing_qa or os.path.join(ROOT, "tmp", "vq-iter", name, fixture_id)
    if not existing_qa:
        src = os.path.join(ROOT, "data", "visual-qa-fixtures", fixture_id)
        if os.path.isdir(qa):
            shutil.rmtree(qa)
        os.makedirs(qa, exist_ok=True)
        for filename in os.listdir(src):
            if filename.lower().endswith(".png") or filename == "sidecar.json":
                shutil.copy2(os.path.join(src, filename), os.path.join(qa, filename))

    sidecar_path = os.path.join(qa, "sidecar.json")
    with open(sidecar_path, "r", encoding="utf-8-sig") as handle:
        sidecar = json.load(handle)
    frames = sidecar["frames"]
    frame_names = ",".join(item["name"] for item in frames)
    frame_acts = ",".join(item["act"] for item in frames)
    emit = [TSX, CLI, "--emit-prompt", "--frames", frame_names, "--acts", frame_acts]
    if has_middle:
        emit.append("--has-middle")
    prompt_out = subprocess.check_output(emit, cwd=ROOT)
    text = prompt_out.decode("utf-8")
    lines = text.splitlines()
    prompt_hash = ""
    body = []
    for line in lines:
        if line.startswith("PROMPT_HASH="):
            prompt_hash = line[len("PROMPT_HASH=") :]
        else:
            body.append(line)
    prompt = "\n".join(body) + "\n"
    prompt_path = os.path.join(qa, "judge-prompt.txt")
    with open(prompt_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(prompt)
    with open(os.path.join(qa, "prompt-hash.txt"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(prompt_hash + "\n")

    args = [CODEX, "exec", "-C", ROOT, "-s", "read-only"]
    for item in frames:
        args.extend(["-i", os.path.join(qa, item["name"])])
    args.append("-")
    args_path = os.path.join(qa, "judge-args.json")
    with open(args_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(args, handle, ensure_ascii=False)
    stdout_path = os.path.join(qa, "judge-stdout.txt")
    rc = subprocess.call([sys.executable, IO_PY, "run-codex", stdout_path, args_path], cwd=ROOT, stdin=open(prompt_path, "rb"))
    if rc != 0:
        raise SystemExit("codex exit %s for %s" % (rc, fixture_id))

    out_path = os.path.join(qa, "live.visual-qa.json")
    eval_cmd = [
        TSX,
        CLI,
        "--evaluate",
        "--stdout-file",
        stdout_path,
        "--sidecar",
        sidecar_path,
        "--reel",
        sidecar["reel"],
        "--qa-dir",
        qa,
        "--out",
        out_path,
        "--prompt-hash",
        prompt_hash,
        "--run-id",
        "iter-%s-%s" % (name, fixture_id),
    ]
    eval_out = subprocess.check_output(eval_cmd, cwd=ROOT).decode("utf-8")
    with open(out_path, "r", encoding="utf-8-sig") as handle:
        record = json.load(handle)
    record["_eval_line"] = eval_out.strip()
    record["_stdout_path"] = stdout_path
    return record


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.stderr.write("usage: run-vq-iter.py ROUND_NAME FIXTURE_ID has-middle|no-middle [EXISTING_QA_DIR]\n")
        raise SystemExit(2)
    existing = sys.argv[4] if len(sys.argv) > 4 else None
    result = run(sys.argv[1], sys.argv[2], sys.argv[3] == "has-middle", existing)
    print(json.dumps({
        "fixture": sys.argv[2],
        "verdict": result.get("verdict"),
        "fail_class": result.get("fail_class"),
        "axes": result.get("axes"),
        "stdout_path": result.get("_stdout_path"),
        "eval": result.get("_eval_line"),
    }, ensure_ascii=False, indent=2))
