"""Read-only publisher previews; writes only this evidence directory and own temp fixtures."""
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
PS = shutil.which("powershell.exe")


def fingerprint(path):
    if not path.exists():
        return None
    if path.is_dir():
        return {str(p.relative_to(path)): fingerprint(p) for p in sorted(path.rglob("*")) if p.is_file()}
    return {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size,
            "mtime_ns": path.stat().st_mtime_ns}


def preview(root=None):
    args = [PS, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(SOURCE),
            "-DryRun", "-NpmCommand", "__A9_NO_REAL_NPM__"]
    if root is not None:
        args += ["-RootPath", str(root)]
    result = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=30)
    return {"exit_code": result.returncode, "stdout": result.stdout.decode("utf-8-sig"),
            "stderr": result.stderr.decode("utf-8-sig")}


@contextmanager
def own_fixture():
    # Python 3.14's 0700 TemporaryDirectory ACL cannot be reopened by this sandbox.
    base = Path(tempfile.gettempdir()).resolve()
    case = base / ("a9-r2-dryrun-" + uuid.uuid4().hex)
    case.mkdir()
    try:
        yield case
    finally:
        assert case.resolve().parent == base and case.name.startswith("a9-r2-dryrun-")
        assert not case.is_symlink() and not case.is_junction()
        assert not any(p.is_symlink() or p.is_junction() for p in case.rglob("*"))
        shutil.rmtree(case)


seed = json.loads(SEED.read_text(encoding="utf-8-sig"))
tracked_paths = [SEED, SOURCE, ROOT / "output/backfill", ROOT / "output/backfill-logs"]
tracked_paths += [ROOT / ("data/content-calendar/" + date + ".json") for date in sorted({row["date"] for row in seed})]
tracked_paths += [ROOT / ("data/posted-log/" + date + ".json") for date in sorted({row["date"] for row in seed})]
before = {str(p.relative_to(ROOT)): fingerprint(p) for p in tracked_paths}
real = preview()
after = {str(p.relative_to(ROOT)): fingerprint(p) for p in tracked_paths}
real["zero_writes"] = before == after
real["runtime_queue_exists"] = (ROOT / "output/backfill/queue.json").exists()
rows = []
sources = []
for date in sorted({entry["date"] for entry in seed}):
    relative = "data/content-calendar/" + date + ".json"
    local = ROOT / relative
    prod = PRODUCTION / relative
    prod_before = fingerprint(prod)
    sources.append({"path": relative, "local": fingerprint(local), "production": prod_before,
                    "same_bytes": prod.exists() and local.read_bytes() == prod.read_bytes(),
                    "production_unchanged": prod_before == fingerprint(prod)})
for entry in seed:
    with own_fixture() as case:
        (case / "data/content-calendar").mkdir(parents=True)
        (case / "data/backfill-seed.json").write_text(json.dumps([entry]), encoding="ascii")
        relative = "data/content-calendar/" + entry["date"] + ".json"
        shutil.copyfile(ROOT / relative, case / relative)
        posted = "data/posted-log/" + entry["date"] + ".json"
        if (ROOT / posted).exists():
            (case / "data/posted-log").mkdir()
            shutil.copyfile(ROOT / posted, case / posted)
        case_before = fingerprint(case)
        result = preview(case)
        result["zero_writes"] = case_before == fingerprint(case)
        match = re.search(r"date_check=(pass|skip) hits=(.*)", result["stdout"])
        hits = match.group(2).strip().split(", ") if match and match.group(2).strip() else []
        exclusions = re.compile(r"^(slot|date|time|id|.*url.*|image.*|asset.*)$", re.I)

        def hit_fields(value, prefix=""):
            if isinstance(value, dict):
                return [row for key, child in value.items() if not exclusions.fullmatch(key)
                        for row in hit_fields(child, prefix + "." + key)]
            if isinstance(value, list):
                return [row for i, child in enumerate(value) for row in hit_fields(child, prefix + f"[{i}]")]
            if isinstance(value, str):
                return [{"field": prefix.lstrip("."), "hits": [hit for hit in hits if hit in value]}] if any(hit in value for hit in hits) else []
            return []

        calendar = json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))
        slot = next(row for row in calendar["slots"] if row["slot"] == entry["slot"])
        rows.append({"date": entry["date"], "slot": entry["slot"],
                     "date_check": match.group(1) if match else None,
                     "hits": match.group(2).strip() if match else None, "hit_fields": hit_fields(slot), **result})
report = {"real_repo": real, "seven": rows, "sources": sources, "before": before, "after": after,
          "scope": "Slot strings recursively scanned by unchanged production PS1; no OCR or live API calls."}
(EVIDENCE / "r2-dryrun-checks.json").write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="ascii")
lines = [real["stdout"].rstrip(), "EXIT_CODE=" + str(real["exit_code"]),
         "QUEUE_AND_LOG_PATHS_UNCHANGED=" + str(real["zero_writes"]).lower(),
         "RUNTIME_QUEUE_EXISTS=" + str(real["runtime_queue_exists"]).lower(), "DEFAULT_ROOT_ENTRY_POINT=true"]
(EVIDENCE / "r2-real-repo-dryrun.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
(EVIDENCE / "r2-all-seven-dryruns.txt").write_text("\n".join(
    f"{row['date']} slot={row['slot']} exit={row['exit_code']} zero_writes={row['zero_writes']}\n{row['stdout'].rstrip()}"
    for row in rows) + "\n", encoding="utf-8")
print(json.dumps({"real_repo": real, "seven": [{k: row[k] for k in ("date", "slot", "date_check", "hits", "zero_writes", "exit_code")} for row in rows],
                  "sources_match_production": all(row["same_bytes"] for row in sources)}, ensure_ascii=True))
assert real["exit_code"] == 0 and real["zero_writes"]
assert all(row["exit_code"] == 0 and row["zero_writes"] for row in rows)
