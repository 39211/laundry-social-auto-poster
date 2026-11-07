"""Kill four r3 mutants plus the r1/r2 guards in an isolated worktree copy."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import uuid

from ops_l1_r3_verify import ROOT, REPORTS, digest, run, save, ts_command

COPY = ROOT / "output/operations" / ("ops-l1-r3-mutations-" + uuid.uuid4().hex)
COPY.mkdir(parents=True)
FILES = [*ROOT.glob("src/**/*.ts"), *[ROOT / p for p in (
    "package.json", "test/publishRecovery.test.ts", "test/publishRecovery.r3.test.ts",
    "test/ops-l1-offline.config.ts", "test/helpers/opsOffline.ts", "test/helpers/opsBootstrap.mjs")]]
originals = {path.relative_to(ROOT).as_posix(): path.read_bytes() for path in FILES}
for name, content in originals.items():
    path = COPY / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)

recovery = originals["src/publishRecovery.ts"].decode("utf-8")
page = originals["src/scheduleAhead.ts"].decode("utf-8")
guard = '''    if (failure?.status === "uncertain" || (!failure && scheduledFailure !== undefined) ||
      /commit point|response lost|may already be live/i.test(error)) reason = "ambiguous_commit";'''
old_guard = '''    if (!/Missing or invalid image file/i.test(error) && (failure?.status === "uncertain" ||
      (!failure && scheduledFailure !== undefined) || /commit point|response lost|may already be live/i.test(error))) reason = "ambiguous_commit";'''
assert recovery.count(guard) == 1

claim = recovery.index("export async function claimRecoveryRetry(")
read_start = recovery.index("  const evidence = await readPublicationEvidence(", claim)
read_end = recovery.index("  decision.record.evidence = evidence.state;", read_start)
fresh_read = recovery[read_start:read_end]
page_start = page.index("    // An empty/incomplete observation")
page_end = page.index("    const exactCaption = normalizeText(caption);", page_start)
page_validation = page[page_start:page_end]
old_validation = '''    // Original negative-proof check (does not reject empty/blank lists).
    if (posts.some(post => typeof (post.message ?? post.caption) !== "string" ||
      toUnixSeconds(post.scheduled_publish_time ?? post.created_time ?? post.timestamp) === undefined)) return { state: "unknown" };
'''
pending = '    if (matches.length) return { state: "pending" };\n'
assert page.count(pending) == 1
queue_guard = '  if (input.platform === "facebook") {\n    let scheduled:'
assert recovery.count(queue_guard) == 1
initial_start = recovery.index("  const evidence = await readPublicationEvidence(")
initial_end = recovery.index("  record.evidence = evidence.state;", initial_start)
notice = "delivered = await (input.sender ?? existingStaffGroup(input.root))(message, key);"
assert recovery.count(notice) == 1

mutants = [
    ("mutation-F1", "src/publishRecovery.ts", recovery.replace(guard, old_guard),
     ["publishRecovery.r3"], "r3 F1:", 6, True),
    ("mutation-F2", "src/publishRecovery.ts", recovery.replace(fresh_read, "  const evidence = { state: 'absent' as const };\n"),
     ["publishRecovery.r3"], "r3 F2:", 8, True),
    ("mutation-F3", "src/scheduleAhead.ts", page.replace(page_validation, "").replace(pending, pending + old_validation),
     ["publishRecovery.r3"], "r3 F3:", 4, True),
    ("mutation-F4", "src/publishRecovery.ts", recovery.replace(queue_guard, "  if (false) {\n    let scheduled:"),
     ["publishRecovery.r3"], "r3 F4: an FB schedule added during final readback", 1, True),
    ("mutation-r1-readback", "src/publishRecovery.ts", recovery[:initial_start] + "  const evidence = { state: 'absent' as const };\n" + recovery[initial_end:],
     ["publishRecovery"], "duplicate guard: a matching published post", 1, False),
    ("mutation-r1-notice", "src/publishRecovery.ts", recovery.replace(notice, "delivered = true;"),
     ["publishRecovery"], "unknown readback never resends", 1, False),
    ("mutation-r2-ambiguous", "src/publishRecovery.ts", recovery.replace(guard, '    if (false) reason = "ambiguous_commit";'),
     ["publishRecovery"], "r2 (?:a|b|c|regex):", 5, True)
]

proof = {"task": "OPS-L1-10-r3", "copy": str(COPY), "runs": [], "mutations": []}
try:
    for name, file, mutant, files, pattern, expected_failed, require_send in mutants:
        target = COPY / file
        target.write_text(mutant, encoding="utf-8", newline="")
        result = run(name, ts_command(name, files, pattern), cwd=COPY, json_result=True)
        data = json.loads((REPORTS / f"ops-l1-10-r3-{name}.json").read_text(encoding="utf-8"))
        failures = [case for suite in data["testResults"] for case in suite["assertionResults"] if case["status"] == "failed"]
        messages = "\n".join(message for case in failures for message in case.get("failureMessages", []))
        assert result["exit_code"] == 1 and result["failed"] == expected_failed and len(failures) == expected_failed, result
        assert all("AssertionError:" in "\n".join(case.get("failureMessages", [])) for case in failures), messages
        if require_send:
            assert re.search(r"expected \[ ['\"]facebook['\"]", messages), "No unintended Facebook send was observed"
        proof["runs"].append(result)
        proof["mutations"].append({"name": name, "file": file, "original_sha256": hashlib.sha256(originals[file]).hexdigest(),
                                   "mutant_sha256": digest(target), "source": mutant,
                                   "failure_cases": [{"title": case["title"], "messages": case.get("failureMessages", [])} for case in failures]})
        target.write_bytes(originals[file])
        assert digest(target) == hashlib.sha256(originals[file]).hexdigest()
finally:
    for name, content in originals.items():
        (COPY / name).write_bytes(content)
    proof["restoration"] = [{"path": name, "candidate_sha256": digest(ROOT / name), "copy_sha256": digest(COPY / name),
                             "before_sha256": hashlib.sha256(content).hexdigest()} for name, content in originals.items()]
    proof["candidate_unchanged"] = all(item["candidate_sha256"] == item["copy_sha256"] == item["before_sha256"] for item in proof["restoration"])
    save("mutations", proof)
    assert proof["candidate_unchanged"], "Mutation escaped its source copy"

restored = run("restored-copy", ts_command("restored-copy", ["publishRecovery", "publishRecovery.r3"]), cwd=COPY, json_result=True)
proof["runs"].append(restored)
save("mutations", proof)
assert restored["exit_code"] == 0 and restored["failed"] == 0
print("MUTANTS_KILLED=7 CANDIDATE_UNCHANGED=true RESTORED_GREEN=true", flush=True)
