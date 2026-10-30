"""Read-only r3 previews using actual calendars; only evidence/own temp writes."""
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
SOURCE = ROOT / "scripts/backfill-publish.ps1"
PRODUCTION = Path("C:/Users/cyc39/laundry-repo")
SEED = ROOT / "data/backfill-seed.json"
COMMENT_FIELDS = ("text", "message", "comment", "comment_text")
PS = shutil.which("powershell.exe")


def fingerprint(path):
    if not path.exists():
        return None
    if path.is_dir():
        return {str(p.relative_to(path)): fingerprint(p)
                for p in sorted(path.rglob("*")) if p.is_file()}
    return {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size, "mtime_ns": path.stat().st_mtime_ns}


def preview(root=None):
    args = [PS, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-File", str(SOURCE), "-DryRun", "-NpmCommand", "__A9_NO_REAL_NPM__"]
    if root is not None:
        args += ["-RootPath", str(root)]
    result = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=30)
    return {"exit_code": result.returncode,
            "stdout": result.stdout.decode("utf-8-sig"),
            "stderr": result.stderr.decode("utf-8-sig")}


@contextmanager
def own_fixture():
    # Avoid Python 3.14 TemporaryDirectory's sandbox-incompatible 0700 ACL.
    base = Path(tempfile.gettempdir()).resolve()
    case = base / ("a9-r3-dryrun-" + uuid.uuid4().hex)
    case.mkdir()
    try:
        yield case
    finally:
        assert case.resolve().parent == base and case.name.startswith("a9-r3-dryrun-")
        assert not case.is_symlink() and not case.is_junction()
        assert not any(p.is_symlink() or p.is_junction() for p in case.rglob("*"))
        shutil.rmtree(case)


def comments_info(root, entry):
    path = root / "data/first-comments" / (entry["date"] + ".json")
    rows = json.loads(path.read_text(encoding="utf-8-sig")) if path.is_file() else []
    selected = [row for row in rows if str(row.get("slot")) == str(entry["slot"])]
    return {"file_exists": path.is_file(), "selected_rows": len(selected),
            "row_keys": sorted({key for row in rows for key in row}),
            "selected_text_fields": sorted({key for row in selected for key in COMMENT_FIELDS
                                            if isinstance(row.get(key), str)})}


seed = json.loads(SEED.read_text(encoding="utf-8-sig"))
dates = sorted({row["date"] for row in seed})
tracked_paths = [SEED, SOURCE, ROOT / "output/backfill", ROOT / "output/backfill-logs"]
tracked_paths += [ROOT / "data" / folder / (date + ".json")
                  for folder in ("content-calendar", "posted-log", "first-comments") for date in dates]
before = {str(p.relative_to(ROOT)): fingerprint(p) for p in tracked_paths}
real = preview()
after = {str(p.relative_to(ROOT)): fingerprint(p) for p in tracked_paths}
real["zero_writes"] = before == after
real["runtime_queue_exists"] = (ROOT / "output/backfill/queue.json").exists()
rows, sources = [], []
for date in dates:
    relative = "data/content-calendar/" + date + ".json"
    local, prod = ROOT / relative, PRODUCTION / relative
    prod_before = fingerprint(prod)
    sources.append({"path": relative, "local": fingerprint(local), "production": prod_before,
                    "same_bytes": prod.exists() and local.read_bytes() == prod.read_bytes(),
                    "production_unchanged": prod_before == fingerprint(prod)})
for entry in seed:
    with own_fixture() as case:
        (case / "data").mkdir()
        (case / "data/backfill-seed.json").write_text(json.dumps([entry]), encoding="ascii")
        for folder in ("content-calendar", "posted-log", "first-comments"):
            relative = "data/" + folder + "/" + entry["date"] + ".json"
            if (ROOT / relative).exists():
                (case / relative).parent.mkdir(exist_ok=True)
                shutil.copyfile(ROOT / relative, case / relative)
        case_before = fingerprint(case)
        result = preview(case)
        result["zero_writes"] = case_before == fingerprint(case)
        match = re.search(r"date_check=(pass|skip) hits=([^\r\n]*)", result["stdout"])
        hits = match.group(2).strip().split(", ") if match and match.group(2).strip() else []
        calendar = json.loads((case / "data/content-calendar" / (entry["date"] + ".json"))
                              .read_text(encoding="utf-8-sig"))
        slot = next(row for row in calendar["slots"] if row["slot"] == entry["slot"])
        text_fields = {name: slot.get(name, "") for name in ("facebook_caption", "instagram_caption")}
        path = case / "data/first-comments" / (entry["date"] + ".json")
        comments = json.loads(path.read_text(encoding="utf-8-sig")) if path.is_file() else []
        for index, row in enumerate(comments):
            if str(row.get("slot")) == str(entry["slot"]):
                text_fields.update({f"first-comments[{index}].{name}": row[name]
                                    for name in COMMENT_FIELDS if isinstance(row.get(name), str)})
        hit_fields = [{"field": name, "hits": [hit for hit in hits if hit in value]}
                      for name, value in text_fields.items() if any(hit in value for hit in hits)]
        rows.append({"date": entry["date"], "slot": entry["slot"],
                     "date_check": match.group(1) if match else None,
                     "hits": hits, "hit_fields": hit_fields,
                     "local_first_comments": comments_info(ROOT, entry),
                     "production_first_comments": comments_info(PRODUCTION, entry), **result})
final = {str(p.relative_to(ROOT)): fingerprint(p) for p in tracked_paths}
report = {"real_repo": real, "seven": rows, "sources": sources,
          "before": before, "after_all_previews": final,
          "all_source_queue_and_log_paths_unchanged": before == final,
          "scope": "Only captions and selected first-comment text; no OCR or live API calls."}
(EVIDENCE / "r3-dryrun-checks.json").write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="ascii")
(EVIDENCE / "r3-real-repo-dryrun.txt").write_text("\n".join([
    real["stdout"].rstrip(), "EXIT_CODE=" + str(real["exit_code"]),
    "QUEUE_AND_LOG_PATHS_UNCHANGED=" + str(real["zero_writes"]).lower(),
    "RUNTIME_QUEUE_EXISTS=" + str(real["runtime_queue_exists"]).lower(),
    "DEFAULT_ROOT_ENTRY_POINT=true"]) + "\n", encoding="utf-8")
(EVIDENCE / "r3-all-seven-dryruns.txt").write_text("\n".join(
    f"{row['date']} slot={row['slot']} exit={row['exit_code']} zero_writes={row['zero_writes']}\n{row['stdout'].rstrip()}"
    for row in rows) + "\n", encoding="utf-8")
print(json.dumps({"real_repo": real,
                  "seven": [{key: row[key] for key in ("date", "slot", "date_check", "hits", "hit_fields", "zero_writes", "exit_code")}
                            for row in rows],
                  "sources_match_production": all(row["same_bytes"] for row in sources),
                  "all_source_queue_and_log_paths_unchanged": before == final}, ensure_ascii=True))
assert real["exit_code"] == 0 and real["zero_writes"] and before == final
assert all(row["exit_code"] == 0 and row["zero_writes"] and row["date_check"] == "pass" for row in rows)
