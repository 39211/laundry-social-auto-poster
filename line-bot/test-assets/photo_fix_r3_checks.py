"""Offline r3 baseline, red/green, twelve mutations and exact live-base samples.

Overlays exist only in worker memory. Reuses the established A2b isolation guard.
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import types
import uuid

import photo_fix_r1_checks as r1

BOT, REPO, CORE, DEPS = r1.BOT, r1.REPO, r1.CORE, r1.DEPS
BASE = "2ccfd5c2"
SAMPLE_BASE = r1.BASE  # 26498c2a: both renderer AND validator/merger must be old.


def source(module, baseline=False, revision=BASE):
    if baseline:
        return subprocess.run(["git", "show", f"{revision}:line-bot/{module}.py"], cwd=REPO,
                              check=True, capture_output=True).stdout.decode("utf-8-sig")
    return (BOT / (module + ".py")).read_text(encoding="utf-8-sig")


def mutation_sources(kind):
    changes = {
        "numbered_question": [
            ('sections.append({"core": "", "question": addressed, "question_detail": detail})',
             'sections.append({"core": "第1件（追問）：", "question": addressed, "question_detail": detail})')],
        "singular_group_question": [
            ('addressed = _photo_addressed_question(question, subject, plural)',
             'addressed = _photo_addressed_question(question, "這件" if plural else subject, False)')],
        "repeated_approximation": [
            ('fee = f"預估 {low:,} 元" if low == high_fee',
             'fee = f"約 {low:,} 元" if low == high_fee')],
        "no_diagnosis_merge": [
            ('            key = _photo_diagnosis_key(detail)',
             '            key = (_photo_diagnosis_key(detail), ordinal)')],
        "unlimited_questions": [
            ('    if candidates:\n        detail, question = min(candidates, key=lambda item: _photo_question_priority(item[0]))',
             '    for detail, question in candidates:')],
        "unlimited_characters": [('PHOTO_MESSAGE_CHARS = 400', 'PHOTO_MESSAGE_CHARS = 4000'),
                                 ('PHOTO_DETAIL_CHARS = 40', 'PHOTO_DETAIL_CHARS = 4000')],
        "equal_range_endpoints": [
            ('                fee = f"預估 {low:,} 元" if low == high_fee else f"先抓 {low:,}–{high_fee:,} 元"',
             '                fee = f"先抓 {low:,}–{high_fee:,} 元"')],
    }
    if kind in changes:
        value = source("estimate")
        for old, new in changes[kind]:
            assert value.count(old) == 1, (kind, "mutation anchor changed")
            value = value.replace(old, new)
        return {"estimate": value}
    # Old r1 protections are still mutated against current production source.
    return r1.mutation_sources(kind)


def run(module, variant="current"):
    token = uuid.uuid4().hex
    tmp = BOT / (".a2b-test-tmp-" + token)
    tmp.mkdir(mode=0o755)
    (tmp / ".a2b-owner").write_text(token, encoding="ascii")
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    env["PYTHONPATH"] = os.pathsep.join([str(BOT), str(DEPS), env.get("PYTHONPATH", "")])
    started = time.monotonic()
    entry = None
    try:
        completed = subprocess.run([sys.executable, "-B", "-X", "utf8", str(Path(__file__).resolve()),
                                   "--worker", module, str(tmp), variant], cwd=BOT, env=env,
                                   capture_output=True, text=True, encoding="utf-8", timeout=150)
        output = completed.stdout + completed.stderr
        entry = {"module": module, "variant": variant, "returncode": completed.returncode,
                 "seconds": round(time.monotonic()-started, 2),
                 "tests": int((re.search(r"Ran (\d+) tests?", output) or [None, "0"])[1]),
                 "failures": re.findall(r"^(?:FAIL|ERROR): (.+)$", output, re.M), "output": output}
    finally:
        try:
            r1.load_runner()._remove_tree(tmp, token)
        except (RuntimeError, OSError) as exc:
            if entry is None:
                raise
            entry.update(returncode=1, cleanup_error=str(exc))
    return entry


def save(name, value):
    (BOT / f"photo-fix-r3-{name}.json").write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def delivery_hashes():
    paths = [BOT / (name + ".py") for name in CORE + ("test_estimate", "test_photo_fix_r1", "test_photo_fix_r2", "test_photo_fix_r3")]
    paths.append(Path(__file__).resolve())
    paths.extend([Path(r1.__file__), Path(__file__).with_name("photo_fix_r2_checks.py")])
    return {p.relative_to(BOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def sample_cases():
    import test_photo_fix_r1 as tests
    # Reuse the literal six r1 fixtures unchanged, not a manually retyped sample.
    tree = ast.parse(Path(r1.__file__).read_text(encoding="utf-8"))
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "write_samples")
    assign = next(n for n in function.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "cases" for t in n.targets))
    namespace = {"row": tests.row}
    exec(compile(ast.Module(body=[assign], type_ignores=[]), r1.__file__, "exec"), namespace)
    return namespace["cases"]


def write_samples():
    import test_photo_fix_r1 as tests
    import estimate
    import photo_estimate as pe
    old_estimate = types.ModuleType("photo_fix_r3_before_estimate")
    old_estimate.__file__ = str(BOT / "estimate.py")
    exec(compile(source("estimate", True, SAMPLE_BASE), old_estimate.__file__, "exec"), old_estimate.__dict__)
    old_photo = types.ModuleType("photo_fix_r3_before_photo")
    old_photo.__file__ = str(BOT / "photo_estimate.py")
    exec(compile(source("photo_estimate", True, SAMPLE_BASE), old_photo.__file__, "exec"), old_photo.__dict__)
    output = ["# PHOTO-FIX r3：六組完整回覆對照", "",
              f"修改前（現役基準）固定使用任務指定 commit `{SAMPLE_BASE}` 的 estimate.py 與 photo_estimate.py；修改後使用本工作樹。沿用 r1 的同六組合成輸入。未讀取現役程序、客人照片或訊息，未呼叫模型。", "",
              "價格為合成測試價表，不是新增對外售價。每個 text 區塊是一則實際函式輸出的完整訊息；字數以 Python len 計，包含標點、空白及換行。", "",
              "修改後上限：3 則／每則 400 字元，5 組詳細診斷，全批 1 個追問。交期固定：衣物 5–7 天、鞋 7 天、難乾大件 10–14 天、包 14 天。", ""]
    metrics = []
    for title, items, extra in sample_cases():
        if title.startswith("大量物件"):
            title = "大量物件：30 件重複診斷合併"
        output += ["## " + title, "", "合成辨識輸入：", "", "```json", json.dumps(items, ensure_ascii=False, indent=2), "```", ""]
        if extra:
            output += ["合成文字追加：" + extra, ""]
        versions = []
        for label, module, vision in (("修改前(現役)", old_estimate, old_photo), ("修改後", estimate, pe)):
            validated = vision.validate_result({"items": items}, set(module.catalog(tests.PRICES)))
            value = module.from_photo(validated, None, tests.PRICES)
            if extra:
                value = module.update(extra, value, tests.PRICES)
            messages = module.render_messages(value) if hasattr(module, "render_messages") else [module.render(value)]
            output += ["### " + label, ""]
            for i, text in enumerate(messages, 1):
                output += [f"訊息 {i}/{len(messages)}（{len(text)} 字元）", "", "```text", text, "```", ""]
            versions.append({"messages": len(messages), "characters": list(map(len, messages)),
                             "sha256": [hashlib.sha256(t.encode("utf-8")).hexdigest() for t in messages],
                             "questions": sum(t.count("？") + t.count("?") for t in messages)})
        metrics.append({"title": title, "before": versions[0], "after": versions[1]})
    (BOT / "photo-fix-r3-samples.md").write_text("\n".join(output), encoding="utf-8")
    save("sample-metrics", metrics)
    save("sample-provenance", {
        "base": SAMPLE_BASE,
        "baseline_source_sha256": {name: hashlib.sha256(source(name, True, SAMPLE_BASE).encode("utf-8")).hexdigest()
                                    for name in ("estimate", "photo_estimate")},
        "current_source_sha256": r1.hashes(),
        "fixture_sha256": hashlib.sha256(json.dumps(sample_cases(), ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest(),
        "document_sha256": hashlib.sha256((BOT / "photo-fix-r3-samples.md").read_bytes()).hexdigest()})
    print(json.dumps(metrics, ensure_ascii=True, indent=2), flush=True)


def verify_artifacts():
    before = json.loads((BOT / "photo-fix-r3-baseline.json").read_text(encoding="utf-8"))
    after = json.loads((BOT / "photo-fix-r3-suite.json").read_text(encoding="utf-8"))
    mutants = json.loads((BOT / "photo-fix-r3-mutations.json").read_text(encoding="utf-8"))
    initial_failures = {r["module"]: r["failures"] for r in before if r["returncode"]}
    retries = []
    # Keep the original run intact. Accept only an explicit clean rerun of the
    # baseline module that actually encountered ENOSPC, never hide a code failure.
    for index, entry in enumerate(before):
        if entry["module"] == "test_arrival_notify" and entry["returncode"]:
            assert "[Errno 28] No space left on device" in entry["output"]
            retry = json.loads((BOT / "photo-fix-r3-baseline-arrival-retry.json").read_text(encoding="utf-8"))[0]
            assert retry["module"] == entry["module"] and retry["variant"] == "baseline"
            assert retry["tests"] == entry["tests"] == 76 and retry["returncode"] == 0 and not retry["failures"]
            retries.append({"module": entry["module"], "initial_errors": len(entry["failures"]), "retry_tests": retry["tests"]})
            before[index] = retry
    failed_before = {r["module"]: r["failures"] for r in before if r["returncode"]}
    failed_after = {r["module"]: r["failures"] for r in after if r["returncode"]}
    assert failed_before == failed_after
    assert sum(map(len, failed_after.values())) == 3
    assert all(not r.get("cleanup_error") for r in after if not r["failures"])
    assert len(after) == len(before) + 1
    assert mutants["before_sha256"] == mutants["after_sha256"] == r1.hashes()
    assert len(mutants["mutations"]) == 12
    assert all(r["returncode"] and r["failures"] and "FAILED (failures=" in r["output"] for r in mutants["mutations"])
    assert all(not re.search(r"^ERROR:", r["output"], re.M) for r in mutants["mutations"])
    witnesses = {
        "numbered_question": "test_two_different_items_have_two_titles_and_named_question",
        "singular_group_question": "test_merged_thirty_items_use_one_title_and_batch_question",
        "repeated_approximation": "test_equal_range_fee_is_estimated_and_turnaround_keeps_approximation",
        "no_diagnosis_merge": "test_thirty_repeated_diagnoses_are_one_line_with_full_quantity_and_fee",
        "unlimited_questions": "test_one_question_per_reply_prefers_missing_evidence",
        "unlimited_characters": "test_every_tariff_count_fee_turnaround_survives_three_four_hundred_char_messages",
        "equal_range_endpoints": "test_same_range_endpoints_are_one_approximate_amount",
        "first_item_only": "test_each_item_has_own_evidence_craft_and_one_question",
        "mixed_discards_photo": "test_mixed_text_keeps_photo_diagnosis",
        "merge_discards_description": "test_same_tariff_keeps_both_physical_diagnoses",
        "followup_discards_context": "test_interleaved_customers_keep_every_item_and_previous_question",
        "bad_json_stops_chain": "test_bad_json_tries_second_model",
    }
    for entry in mutants["mutations"]:
        assert any(f.startswith(witnesses[entry["variant"]] + " (") for f in entry["failures"])
    assert all(r["returncode"] == 0 for r in mutants["restored"])
    frozen = json.loads((BOT / "photo-fix-r3-suite-sources.json").read_text(encoding="utf-8"))
    assert frozen["before_sha256"] == frozen["after_sha256"] == delivery_hashes()
    stable = {"estimate": ("price", "PHOTO_TURNAROUND"),
              "photo_estimate": ("thinking_budget", "model_chain", "MAX_CALLS", "TOTAL_SECONDS", "PER_CALL_SECONDS", "SCHEMA")}
    def definition(text, name):
        for node in ast.parse(text).body:
            if isinstance(node, ast.FunctionDef) and node.name == name:
                return ast.dump(node)
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
                return ast.dump(node)
        raise AssertionError(name)
    for module, names in stable.items():
        for name in names:
            assert definition(source(module, True), name) == definition(source(module), name), (module, name)
    metrics = []
    document = (BOT / "photo-fix-r3-samples.md").read_text(encoding="utf-8")
    provenance = json.loads((BOT / "photo-fix-r3-sample-provenance.json").read_text(encoding="utf-8"))
    recorded_samples = json.loads((BOT / "photo-fix-r3-sample-metrics.json").read_text(encoding="utf-8"))
    assert provenance["base"] == SAMPLE_BASE and provenance["current_source_sha256"] == r1.hashes()
    for name, digest in provenance["baseline_source_sha256"].items():
        assert digest == hashlib.sha256(source(name, True, SAMPLE_BASE).encode("utf-8")).hexdigest()
    assert provenance["document_sha256"] == hashlib.sha256((BOT / "photo-fix-r3-samples.md").read_bytes()).hexdigest()
    assert SAMPLE_BASE in document and "\ufffd" not in document
    expected_groups = (2, 1, 2, 1, 4, 1)
    # Check structure in the written customer artifact, not just section objects.
    heading = re.compile(r"^[^\n：:，,。？?]+(?:（[^\n）]*）)?[：:]", re.M)
    for section, groups, recorded in zip(re.split(r"^## ", document, flags=re.M)[1:], expected_groups, recorded_samples, strict=True):
        versions = section.split("### 修改後", 1)
        assert "### 修改前(現役)" in versions[0]
        for version, key in zip(versions, ("before", "after")):
            texts = re.findall(r"```text\n(.*?)\n```", version, re.S)
            assert [hashlib.sha256(t.encode("utf-8")).hexdigest() for t in texts] == recorded[key]["sha256"]
        messages = re.findall(r"```text\n(.*?)\n```", versions[1], re.S)
        counts = [int(n) for n in re.findall(r"訊息 \d+/\d+（(\d+) 字元）", versions[1])]
        assert counts == list(map(len, messages))
        assert 1 <= len(messages) <= 3 and all(0 < len(t) <= 400 and "AI" not in t for t in messages)
        assert sum(t.count("？") + t.count("?") for t in messages) <= 1
        assert not any("250–250" in t for t in messages)
        text = "\n".join(messages)
        headings = [line for line in text.splitlines() if heading.match(line)
                    and not re.search(r"元|費用待|數量待確認：", line)]
        questions = [line for line in text.splitlines() if "？" in line or "?" in line]
        assert len(headings) == groups
        assert all(not heading.match(line) and not re.match(r"^第[0-9一二三四五六七八九十]+件", line) for line in questions)
        assert not re.search(r"約\s*[\d,]+\s*元，約\s*\d", text)
        if "30 件" in section.splitlines()[0]:
            assert "這件" not in "\n".join(questions)
        metrics.append({"title": section.splitlines()[0], "characters": counts, "detail_headings": len(headings)})
    assert len(metrics) == 6
    commit_message = (BOT / "photo-fix-r3-commit-message.txt").read_text(encoding="utf-8").splitlines()
    assert commit_message[-2:] == ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
                                  "Claude-Session: https://claude.ai/code/session_01MEMrUQbxofj3681QMgaYf8"]
    report = {"base": BASE, "sample_base": SAMPLE_BASE, "source_sha256": r1.hashes(), "delivery_sha256": delivery_hashes(), "baseline_modules": len(before), "current_modules": len(after),
              "baseline_tests": sum(r["tests"] for r in before), "current_tests": sum(r["tests"] for r in after),
              "new_failures": [], "initial_baseline_failures": initial_failures, "baseline_retries": retries,
              "existing_sandbox_failures": failed_after, "unchanged_definitions": stable,
              "mutation_versions_killed": 12, "restored_tests": sum(r["tests"] for r in mutants["restored"]),
              "samples": metrics}
    save("validation", report)
    print(json.dumps(report, ensure_ascii=True, indent=2))


def main():
    if sys.argv[1] == "--worker":
        module, tmp, variant = sys.argv[2:]
        if variant in ("baseline", "red"):
            names = CORE + (("test_estimate", "test_vision_usage", "test_photo_fix_r1", "test_photo_fix_r2") if variant == "baseline" else ())
            sources = {name: source(name, True) for name in names}
        elif variant not in ("current", "samples"):
            sources = mutation_sources(variant)
        else:
            sources = {}
        sys.meta_path.insert(0, r1.OverlayFinder(sources))
        result = r1.load_runner()._run_module(Path(tmp), module)
        if variant == "samples" and result == 0:
            write_samples()
        return result
    mode = sys.argv[1]
    if mode in ("baseline", "suite"):
        modules = [p.stem for p in sorted(BOT.glob("test_*.py")) if mode != "baseline" or p.stem != "test_photo_fix_r3"]
        modules += ["tests." + p.stem for p in sorted((BOT / "tests").glob("test_*.py"))]
        frozen = delivery_hashes()
        results = []
        for module in modules:
            entry = run(module, "baseline" if mode == "baseline" else "current")
            results.append(entry)
            print(module, entry["returncode"], flush=True)
            save(mode, results)
        if mode == "suite":
            save("suite-sources", {"before_sha256": frozen, "after_sha256": delivery_hashes()})
            assert frozen == delivery_hashes(), "source or tests changed during full suite"
        print("TOTAL", len(results), "FAIL", sum(r["returncode"] != 0 for r in results), flush=True)
        return int(any(r["returncode"] != 0 for r in results))
    if mode in ("red", "focused"):
        modules = ["test_photo_fix_r3"] if mode == "red" else ["test_photo_fix_r3", "test_photo_fix_r2", "test_photo_fix_r1", "test_estimate"]
        results = [run(module, "red" if mode == "red" else "current") for module in modules]
        save(mode, results)
        for entry in results:
            print(json.dumps({k: v for k, v in entry.items() if k != "output"}, ensure_ascii=True), flush=True)
            if entry["returncode"]:
                print(entry["output"], flush=True)
        return int(any(r["returncode"] != 0 for r in results))
    if mode == "samples":
        entry = run("test_photo_fix_r3", "samples")
        print(entry["output"], flush=True)
        return entry["returncode"]
    if mode == "mutations":
        before = r1.hashes()
        versions = [("test_photo_fix_r3", k) for k in (
            "numbered_question", "singular_group_question", "repeated_approximation")]
        versions += [("test_photo_fix_r2", k) for k in (
            "no_diagnosis_merge", "unlimited_questions", "unlimited_characters", "equal_range_endpoints")]
        versions += [("test_photo_fix_r1", k) for k in (
            "first_item_only", "mixed_discards_photo", "merge_discards_description", "followup_discards_context", "bad_json_stops_chain")]
        results = []
        for module, kind in versions:
            entry = run(module, kind)
            results.append(entry)
            print(kind, entry["returncode"], entry["failures"], flush=True)
        restored = [run("test_photo_fix_r3"), run("test_photo_fix_r2"), run("test_photo_fix_r1")]
        report = {"before_sha256": before, "after_sha256": r1.hashes(), "mutations": results, "restored": restored}
        save("mutations", report)
        return int(not (before == r1.hashes() and all(r["returncode"] == 0 for r in restored)
                        and all(r["returncode"] and r["failures"] for r in results)))
    if mode == "verify":
        verify_artifacts()
        return 0
    raise SystemExit("usage: photo_fix_r3_checks.py baseline|suite|red|focused|samples|mutations|verify")


if __name__ == "__main__":
    raise SystemExit(main())
