"""Offline r4 regression, exact baseline, fifteen in-memory mutants and samples."""
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
import photo_fix_r3_checks as r3

BOT, REPO, CORE, DEPS = r1.BOT, r1.REPO, r1.CORE, r1.DEPS
BASE, SAMPLE_BASE = "d7a45d9c", r1.BASE
PREFIX = "photo-fix-r4-"
FOCUSED = ("test_photo_fix_r4", "test_photo_fix_r3", "test_photo_fix_r2", "test_photo_fix_r1", "test_estimate")
VERSIONS = [
    ("test_photo_fix_r4", "chinese_question_space", "test_chinese_question_subject_has_no_space_after_about"),
    ("test_photo_fix_r4", "first_brand_for_batch", "test_mixed_brand_batch_does_not_attribute_every_item_to_first_brand"),
    ("test_photo_fix_r4", "mid_sentence_singular", "test_group_question_replaces_mid_sentence_singular_and_retains_followup_context"),
    ("test_photo_fix_r3", "numbered_question", "test_two_different_items_have_two_titles_and_named_question"),
    ("test_photo_fix_r3", "singular_group_question", "test_merged_thirty_items_use_one_title_and_batch_question"),
    ("test_photo_fix_r3", "repeated_approximation", "test_equal_range_fee_is_estimated_and_turnaround_keeps_approximation"),
    ("test_photo_fix_r2", "no_diagnosis_merge", "test_thirty_repeated_diagnoses_are_one_line_with_full_quantity_and_fee"),
    ("test_photo_fix_r2", "unlimited_questions", "test_one_question_per_reply_prefers_missing_evidence"),
    ("test_photo_fix_r2", "unlimited_characters", "test_every_tariff_count_fee_turnaround_survives_three_four_hundred_char_messages"),
    ("test_photo_fix_r2", "equal_range_endpoints", "test_same_range_endpoints_are_one_approximate_amount"),
    ("test_photo_fix_r1", "first_item_only", "test_each_item_has_own_evidence_craft_and_one_question"),
    ("test_photo_fix_r1", "mixed_discards_photo", "test_mixed_text_keeps_photo_diagnosis"),
    ("test_photo_fix_r1", "merge_discards_description", "test_same_tariff_keeps_both_physical_diagnoses"),
    ("test_photo_fix_r1", "followup_discards_context", "test_interleaved_customers_keep_every_item_and_previous_question"),
    ("test_photo_fix_r1", "bad_json_stops_chain", "test_bad_json_tries_second_model"),
]


def source(module, revision=None):
    if revision:
        return subprocess.run(["git", "show", f"{revision}:line-bot/{module}.py"], cwd=REPO,
                              check=True, capture_output=True).stdout.decode("utf-8-sig")
    return (BOT / (module + ".py")).read_text(encoding="utf-8-sig")


def mutation_sources(kind):
    changes = {
        "chinese_question_space": [
            ('    separator = " " if re.match(r"[A-Za-z0-9]", subject) else ""', '    separator = " "')],
        "first_brand_for_batch": [
            ('(brands[i], detail.get("photo_model"))', '(detail.get("photo_brand"), detail.get("photo_model"))'),
            ('identity = "，".join(filter(None, (identity, count)))',
             'identity = f"{identity}等 {count}" if identity and len(members) > 1 else "，".join(filter(None, (identity, count)))'),
            ('        if len({d.get("photo_brand", "") for d, _, _ in members}) > 1:\n            identity += "，品牌不一"', '')],
        "mid_sentence_singular": [
            ('        question = question.replace("這件", "這批物品")', '        question = question')],
    }
    if kind not in changes:
        return r3.mutation_sources(kind)
    value = source("estimate")
    for old, new in changes[kind]:
        assert value.count(old) == 1, (kind, "mutation anchor changed")
        value = value.replace(old, new)
    return {"estimate": value}


def run(module, variant="current"):
    token = uuid.uuid4().hex
    tmp = BOT / (".a2b-test-tmp-" + token)
    tmp.mkdir()
    (tmp / ".a2b-owner").write_text(token, encoding="ascii")
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    env["PYTHONPATH"] = os.pathsep.join([str(BOT), str(DEPS), env.get("PYTHONPATH", "")])
    started, entry = time.monotonic(), None
    try:
        completed = subprocess.run([sys.executable, "-B", "-X", "utf8", str(Path(__file__).resolve()),
                                   "--worker", module, str(tmp), variant], cwd=BOT, env=env,
                                   capture_output=True, text=True, encoding="utf-8", timeout=150)
        output = completed.stdout + completed.stderr
        entry = {"module": module, "variant": variant, "returncode": completed.returncode,
                 "seconds": round(time.monotonic() - started, 2),
                 "tests": int((re.search(r"Ran (\d+) tests?", output) or [None, "0"])[1]),
                 "failures": re.findall(r"^(?:FAIL|ERROR): (.+)$", output, re.M),
                 "skipped": len(re.findall(r"\.\.\. skipped ", output)), "output": output}
    finally:
        try:
            r1.load_runner()._remove_tree(tmp, token)
        except (RuntimeError, OSError) as exc:
            if entry is None:
                raise
            entry.update(returncode=1, cleanup_error=str(exc))
    return entry


def save(name, value):
    (BOT / (PREFIX + name + ".json")).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def read(name):
    return json.loads((BOT / (PREFIX + name + ".json")).read_text(encoding="utf-8"))


def delivery_hashes():
    paths = [BOT / (name + ".py") for name in CORE + FOCUSED]
    paths += sorted((BOT / "test-assets").glob("photo_fix_r*_checks.py"))
    return {p.relative_to(BOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def write_samples():
    import estimate
    import photo_estimate as pe
    from test_photo_fix_r1 import PRICES
    old = {}
    for name in ("estimate", "photo_estimate"):
        module = types.ModuleType("photo_fix_r4_before_" + name)
        module.__file__ = str(BOT / (name + ".py"))
        exec(compile(source(name, SAMPLE_BASE), module.__file__, "exec"), module.__dict__)
        old[name] = module
    output = ["# PHOTO-FIX r4：六組完整回覆對照", "",
              f"修改前固定取現役基準 `{SAMPLE_BASE}` 的 estimate.py 與 photo_estimate.py（驗證、合併、回覆均為該版本）；修改後為本工作樹。沿用 r1 六組合成輸入，未讀取客人資料、未呼叫模型。", "",
              "合成價格只用於測試。每個 text 區塊是一則實際函式輸出的完整訊息；字元以 Python len 計，包含空格及換行。", "",
              "修改後限制：最多 3 則、每則 400 字元、5 組詳細診斷、全批 1 個追問。衣物 5–7 天、鞋 7 天、難乾大件 10–14 天、包 14 天。", ""]
    metrics = []
    for title, items, extra in r3.sample_cases():
        if title.startswith("大量物件"):
            title = "大量物件：30 件重複診斷合併"
        output += ["## " + title, "", "合成辨識輸入：", "", "```json", json.dumps(items, ensure_ascii=False, indent=2), "```", ""]
        if extra:
            output += ["合成文字追加：" + extra, ""]
        versions = []
        for label, module, vision in (("修改前(現役)", old["estimate"], old["photo_estimate"]), ("修改後", estimate, pe)):
            validated = vision.validate_result({"items": items}, set(module.catalog(PRICES)))
            value = module.from_photo(validated, None, PRICES)
            if extra:
                value = module.update(extra, value, PRICES)
            messages = module.render_messages(value) if hasattr(module, "render_messages") else [module.render(value)]
            output += ["### " + label, ""]
            for i, text in enumerate(messages, 1):
                output += [f"訊息 {i}/{len(messages)}（{len(text)} 字元）", "", "```text", text, "```", ""]
            versions.append({"messages": len(messages), "characters": list(map(len, messages)),
                             "sha256": [hashlib.sha256(t.encode("utf-8")).hexdigest() for t in messages],
                             "questions": sum(t.count("？") + t.count("?") for t in messages)})
        metrics.append({"title": title, "before": versions[0], "after": versions[1]})
    document = BOT / (PREFIX + "samples.md")
    document.write_text("\n".join(output), encoding="utf-8")
    save("sample-metrics", metrics)
    save("sample-provenance", {
        "base": SAMPLE_BASE,
        "baseline_source_sha256": {name: hashlib.sha256(source(name, SAMPLE_BASE).encode("utf-8")).hexdigest() for name in old},
        "current_source_sha256": r1.hashes(),
        "fixture_sha256": hashlib.sha256(json.dumps(r3.sample_cases(), ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest(),
        "document_sha256": hashlib.sha256(document.read_bytes()).hexdigest()})


def verify():
    before, after, mutants = read("baseline"), read("suite"), read("mutations")
    failed_before = {r["module"]: r["failures"] for r in before if r["returncode"]}
    failed_after = {r["module"]: r["failures"] for r in after if r["returncode"]}
    expected_sandbox = {
        "test_isolation_guard": ["unittest.case.FunctionTestCase (test_import_without_explicit_install_isolation)"],
        "test_run_scripts": ["unittest.case.FunctionTestCase (test_f6_recursive_stop_source)",
                             "unittest.case.FunctionTestCase (test_p1_healthz_pid_match_tree)"],
    }
    assert failed_before == failed_after == expected_sandbox
    assert len(after) == len(before) + 1
    assert all(not r.get("cleanup_error") for r in before + after if not r["failures"])
    assert {r["module"] for r in before if r.get("cleanup_error")} == {r["module"] for r in after if r.get("cleanup_error")}
    assert all(not r.get("cleanup_error") or r["module"] in expected_sandbox for r in before + after)
    assert sum(r["skipped"] for r in before) == sum(r["skipped"] for r in after) == 4
    focused = read("focused")
    assert all(r["returncode"] == 0 and r["tests"] > 0 for r in focused)
    red = read("red")[0]
    assert red["returncode"] and red["failures"] and not re.search(r"^ERROR:", red["output"], re.M)
    assert any(f.startswith("test_chinese_question_subject_has_no_space_after_about (") for f in red["failures"])
    assert any(f.startswith("test_mixed_brand_batch_does_not_attribute_every_item_to_first_brand (") for f in red["failures"])
    assert mutants["before_sha256"] == mutants["after_sha256"] == r1.hashes()
    assert len(mutants["mutations"]) == len(VERSIONS) == 15
    for entry, (module, variant, witness) in zip(mutants["mutations"], VERSIONS, strict=True):
        assert (entry["module"], entry["variant"]) == (module, variant)
        assert entry["returncode"] and entry["failures"] and "FAILED (failures=" in entry["output"]
        assert not entry.get("cleanup_error") and not re.search(r"^ERROR:", entry["output"], re.M)
        assert any(f.startswith(witness + " (") for f in entry["failures"]), (variant, entry["failures"])
    assert all(r["returncode"] == 0 and r["tests"] > 0 for r in mutants["restored"])
    frozen = read("suite-sources")
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
            assert definition(source(module, BASE), name) == definition(source(module), name)
    document_path = BOT / (PREFIX + "samples.md")
    document, metrics, provenance = document_path.read_text(encoding="utf-8"), read("sample-metrics"), read("sample-provenance")
    assert provenance["base"] == SAMPLE_BASE and provenance["current_source_sha256"] == r1.hashes()
    assert provenance["document_sha256"] == hashlib.sha256(document_path.read_bytes()).hexdigest()
    assert provenance["fixture_sha256"] == hashlib.sha256(json.dumps(r3.sample_cases(), ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    for name, digest in provenance["baseline_source_sha256"].items():
        assert digest == hashlib.sha256(source(name, SAMPLE_BASE).encode("utf-8")).hexdigest()
    assert SAMPLE_BASE in document and "\ufffd" not in document
    from test_photo_fix_r3 import detail_headings, question_lines
    original = (BOT / "photo-fix-r1-samples.md").read_text(encoding="utf-8")
    original_before = [re.findall(r"```text\n(.*?)\n```", s.split("### 修改後", 1)[0], re.S)
                       for s in re.split(r"^## ", original, flags=re.M)[1:]]
    for section, recorded, groups, old_texts in zip(re.split(r"^## ", document, flags=re.M)[1:], metrics, (2, 1, 2, 1, 4, 1), original_before, strict=True):
        versions = section.split("### 修改後", 1)
        for version, key in zip(versions, ("before", "after"), strict=True):
            texts = re.findall(r"```text\n(.*?)\n```", version, re.S)
            assert len(texts) == recorded[key]["messages"]
            assert list(map(len, texts)) == recorded[key]["characters"]
            assert [hashlib.sha256(t.encode("utf-8")).hexdigest() for t in texts] == recorded[key]["sha256"]
            assert [int(n) for n in re.findall(r"訊息 \d+/\d+（(\d+) 字元）", version)] == list(map(len, texts))
            if key == "before":
                assert texts == old_texts, "baseline differs from original r1 live-base sample"
        text = "\n".join(texts)
        assert 1 <= len(texts) <= 3 and all(0 < len(t) <= 400 and "AI" not in t for t in texts)
        assert len(detail_headings(text)) == groups and len(question_lines(text)) == 1
        assert not re.search(r"關於 [^A-Za-z0-9]", text)
        assert not re.search(r"約\s*[\d,]+\s*元，約\s*\d|250–250", text)
        if "30 件" in section.splitlines()[0]:
            assert "品牌不一" in text and "合成品牌" not in text
            assert "這件" not in "\n".join(question_lines(text))
    assert len(metrics) == 6
    commit_message = (BOT / (PREFIX + "commit-message.txt")).read_text(encoding="utf-8").splitlines()
    assert commit_message[-2:] == ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
                                  "Claude-Session: https://claude.ai/code/session_01MEMrUQbxofj3681QMgaYf8"]
    report = {"base": BASE, "sample_base": SAMPLE_BASE, "delivery_sha256": delivery_hashes(),
              "baseline_modules": len(before), "current_modules": len(after),
              "baseline_tests": sum(r["tests"] for r in before), "current_tests": sum(r["tests"] for r in after),
              "focused_tests": sum(r["tests"] for r in focused), "new_failures": [], "existing_sandbox_failures": failed_after,
              "sandbox_cleanup_errors": {r["module"]: r["cleanup_error"] for r in after if r.get("cleanup_error")},
              "skipped": 4, "mutation_versions_killed": 15, "restored_tests": sum(r["tests"] for r in mutants["restored"]),
              "unchanged_definitions": stable, "samples": metrics}
    save("validation", report)
    print(json.dumps(report, ensure_ascii=True, indent=2))


def main():
    if sys.argv[1] == "--worker":
        module, tmp, variant = sys.argv[2:]
        sources = ({name: source(name, BASE) for name in CORE + FOCUSED[1:]} if variant == "baseline" else
                   {name: source(name, BASE) for name in CORE} if variant == "red" else
                   {} if variant in ("current", "samples", "verify") else mutation_sources(variant))
        sys.meta_path.insert(0, r1.OverlayFinder(sources))
        result = r1.load_runner()._run_module(Path(tmp), module)
        if variant == "samples" and result == 0:
            write_samples()
        if variant == "verify" and result == 0:
            verify()
        return result
    mode = sys.argv[1]
    if mode in ("baseline", "suite"):
        modules = [p.stem for p in sorted(BOT.glob("test_*.py")) if mode != "baseline" or p.stem != "test_photo_fix_r4"]
        modules += ["tests." + p.stem for p in sorted((BOT / "tests").glob("test_*.py"))]
        frozen, results = delivery_hashes(), []
        for module in modules:
            entry = run(module, "baseline" if mode == "baseline" else "current")
            results.append(entry)
            print(module, entry["returncode"], flush=True)
            save(mode, results)
        save(mode + "-sources", {"before_sha256": frozen, "after_sha256": delivery_hashes()})
        assert frozen == delivery_hashes(), "sources changed during full suite"
        print("TOTAL", len(results), "TESTS", sum(r["tests"] for r in results), "FAIL", sum(bool(r["returncode"]) for r in results), flush=True)
        return int(any(r["returncode"] for r in results))
    if mode in ("red", "focused"):
        results = [run(module, "red" if mode == "red" else "current") for module in (("test_photo_fix_r4",) if mode == "red" else FOCUSED)]
        save(mode, results)
        for entry in results:
            print(json.dumps({k: v for k, v in entry.items() if k != "output"}, ensure_ascii=True), flush=True)
            if entry["returncode"]:
                print(entry["output"], flush=True)
        return int(any(r["returncode"] for r in results))
    if mode == "mutations":
        frozen, results = r1.hashes(), []
        for module, kind, _ in VERSIONS:
            entry = run(module, kind)
            results.append(entry)
            print(kind, entry["returncode"], entry["failures"], flush=True)
        restored = [run(module) for module in FOCUSED[:-1]]
        save(mode, {"before_sha256": frozen, "after_sha256": r1.hashes(), "mutations": results, "restored": restored})
        return int(not (frozen == r1.hashes() and all(r["returncode"] == 0 for r in restored)
                        and all(r["returncode"] and r["failures"] for r in results)))
    if mode == "samples":
        entry = run("test_photo_fix_r4", "samples")
        print(entry["output"], flush=True)
        return entry["returncode"]
    if mode == "verify":
        entry = run("test_photo_fix_r4", "verify")
        print(entry["output"], flush=True)
        return entry["returncode"]
    raise SystemExit("usage: photo_fix_r4_checks.py baseline|red|focused|suite|mutations|samples|verify")


if __name__ == "__main__":
    raise SystemExit(main())
