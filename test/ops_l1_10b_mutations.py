"""Mutate an isolated source copy, assert real test failures, then restore hashes."""
import hashlib
import json
from pathlib import Path
import subprocess
import uuid
from ops_l1_10b_verify import ROOT, OUT, command, digest, run, save

COPY = ROOT / "output/operations" / ("ops-l1-10b-mutations-" + uuid.uuid4().hex)
paths = [*ROOT.glob("src/**/*.ts"), *[ROOT / name for name in (
    "package.json", "scripts/backfill-publish.ps1", "test/ps-backfill-flag.smoke.ps1",
    "test/publishRecovery.test.ts", "test/publishRecovery.r3.test.ts", "test/publishRecovery.backfill.test.ts",
    "test/ops-l1-offline.config.ts", "test/helpers/opsOffline.ts", "test/helpers/opsBootstrap.mjs")]]
originals = {path.relative_to(ROOT).as_posix(): path.read_bytes() for path in paths}
for name, data in originals.items():
    target = COPY / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)

recovery = originals["src/publishRecovery.ts"].decode("utf-8").replace("\r\n", "\n")
page = originals["src/scheduleAhead.ts"].decode("utf-8").replace("\r\n", "\n")
ps = originals["scripts/backfill-publish.ps1"].decode("utf-8-sig").replace("\r\n", "\n")
guard = '''    if (failure?.status === "uncertain" || (!failure && scheduledFailure !== undefined) ||
      /commit point|response lost|may already be live/i.test(error)) reason = "ambiguous_commit";'''
old_guard = '''    if (!/Missing or invalid image file/i.test(error) && (failure?.status === "uncertain" ||
      (!failure && scheduledFailure !== undefined) || /commit point|response lost|may already be live/i.test(error))) reason = "ambiguous_commit";'''
assert recovery.count(guard) == 1
initial_start = recovery.index("  const evidence = await readPublicationEvidence(")
initial_end = recovery.index("  record.evidence = evidence.state;", initial_start)
initial_read = recovery[initial_start:initial_end]
claim = recovery.index("export async function claimRecoveryRetry(")
read_start = recovery.index("  const evidence = await readPublicationEvidence(", claim)
read_end = recovery.index("  decision.record.evidence = evidence.state;", read_start)
fresh_read = recovery[read_start:read_end]
page_start = page.index("    // An empty/incomplete observation")
page_end = page.index("    const exactCaption = normalizeText(caption);", page_start)
page_validation = page[page_start:page_end]
old_validation = '''    if (posts.some(post => typeof (post.message ?? post.caption) !== "string" ||
      toUnixSeconds(post.scheduled_publish_time ?? post.created_time ?? post.timestamp) === undefined)) return { state: "unknown" };
'''
pending = '    if (matches.length) return { state: "pending" };\n'
queue_guard = '  if (input.platform === "facebook") {\n    let scheduled:'
notice = "delivered = await (input.sender ?? existingStaffGroup(input.root))(message, key);"
silent_guard = '''  if (input.backfill) {
    record.notification = "suppressed";
    await writeJsonAtomic(pathFor(input), record);
    return;
  }
'''
for needle in [queue_guard, notice, silent_guard]:
    assert recovery.count(needle) == 1, needle

mutants = [
    ("B-window", "src/publishRecovery.ts", recovery.replace('!input.backfill && !inWindow(input)', '!inWindow(input)'),
     ["publishRecovery.backfill"], "B1:", 1),
    ("B-readback", "src/publishRecovery.ts", recovery.replace(initial_read,
     "  const evidence = input.backfill ? { state: 'absent' as const } : await readPublicationEvidence({ config: input.config, fetchImpl: input.fetchImpl, platform: input.platform, caption: input.slot.facebook_caption, slotTime: 0 });\n").replace(fresh_read,
     "  const evidence = { state: 'absent' as const };\n"), ["publishRecovery.backfill"], "B3:", 1),
    ("B-notice", "src/publishRecovery.ts", recovery.replace(silent_guard, ""),
     ["publishRecovery.backfill"], "B5 B6:", 4),
    ("B-flag", "scripts/backfill-publish.ps1", ps.replace(" --live --backfill'", " --live'"), [], None, None),
    # Existing six r3/r1 mutation definitions are preserved, plus r2 ambiguity.
    ("original-F1", "src/publishRecovery.ts", recovery.replace(guard, old_guard), ["publishRecovery.r3"], "r3 F1:", 6),
    ("original-F2", "src/publishRecovery.ts", recovery.replace(fresh_read, "  const evidence = { state: 'absent' as const };\n"),
     ["publishRecovery.r3"], "r3 F2:", 8),
    ("original-F3", "src/scheduleAhead.ts", page.replace(page_validation, "").replace(pending, pending + old_validation),
     ["publishRecovery.r3"], "r3 F3:", 4),
    ("original-F4", "src/publishRecovery.ts", recovery.replace(queue_guard, "  if (false) {\n    let scheduled:"),
     ["publishRecovery.r3"], "r3 F4: an FB schedule added during final readback", 1),
    ("original-r1-readback", "src/publishRecovery.ts", recovery.replace(initial_read, "  const evidence = { state: 'absent' as const };\n"),
     ["publishRecovery"], "duplicate guard: a matching published post", 1),
    ("original-r1-notice", "src/publishRecovery.ts", recovery.replace(notice, "delivered = true;"),
     ["publishRecovery"], "unknown readback never resends", 1),
    ("original-r2-ambiguous", "src/publishRecovery.ts", recovery.replace(guard, '    if (false) reason = "ambiguous_commit";'),
     ["publishRecovery"], "r2 (?:a|b|c|regex):", 5),
]
proof = {"task": "OPS-L1-10b r1", "copy": str(COPY), "mutations": [], "baseline": None}
try:
    # Actual supplied base with the new integration test, not a mocked failure.
    for name in ("src/publishRecovery.ts", "src/postCurrentSlot.ts"):
        base = subprocess.run(["git", "show", "cbf5e126:" + name], cwd=ROOT, capture_output=True, check=True).stdout
        (COPY / name).write_bytes(base)
    result = run("baseline-red", command("baseline-red", ["publishRecovery.backfill"], "B1:"), cwd=COPY, ts=True)
    assert result["exit_code"] == 1 and result["failed"] == 1 and len(result["failures"]) == 1, result
    proof["baseline"] = result
    for name, data in originals.items():
        (COPY / name).write_bytes(data)
    for label, name, mutant, files, pattern, count in mutants:
        target = COPY / name
        assert mutant.encode("utf-8") != originals[name], label
        target.write_text(mutant, encoding="utf-8", newline="")
        if files:
            result = run(label, command(label, files, pattern), cwd=COPY, ts=True)
            assert result["exit_code"] == 1 and result["failed"] == count and len(result["failures"]) == count, result
            if label == "B-window":
                assert "needs_manual:outside_same_day_window" in result["failures"][0]["failureMessages"][0], result
            else:
                assert all("AssertionError:" in "\n".join(case["failureMessages"]) for case in result["failures"]), result
        else:
            result = run(label, ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                                str(COPY / "test/ps-backfill-flag.smoke.ps1")], cwd=COPY)
            assert result["exit_code"] == 1 and "BACKFILL_FLAG_MISSING_OR_WRONG_ARGUMENTS" in result["tail"], result
        proof["mutations"].append({"name": label, "file": name, "candidate_sha256": hashlib.sha256(originals[name]).hexdigest(),
                                   "mutant_sha256": digest(target), "result": result})
        target.write_bytes(originals[name])
        save("mutations", proof)
finally:
    for name, data in originals.items():
        (COPY / name).write_bytes(data)
    proof["restoration"] = [{"path": name, "original_sha256": hashlib.sha256(data).hexdigest(),
                             "candidate_sha256": digest(ROOT / name), "restored_sha256": digest(COPY / name)} for name, data in originals.items()]
    proof["candidate_unchanged"] = all(p["original_sha256"] == p["candidate_sha256"] == p["restored_sha256"] for p in proof["restoration"])
    save("mutations", proof)
    assert proof["candidate_unchanged"]

proof["restored"] = run("restored-green", command("restored-green", ["publishRecovery", "publishRecovery.r3", "publishRecovery.backfill"]), cwd=COPY, ts=True)
proof["restored_flag"] = run("restored-flag", ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                               "-File", str(COPY / "test/ps-backfill-flag.smoke.ps1")], cwd=COPY)
save("mutations", proof)
assert proof["restored"]["exit_code"] == 0 and proof["restored_flag"]["exit_code"] == 0
print("MUTANTS_KILLED=11 CANDIDATE_UNCHANGED=true RESTORED_GREEN=true", flush=True)
