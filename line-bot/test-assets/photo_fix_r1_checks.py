"""Reproducible offline baseline, regression, mutation and customer samples.

Uses the existing A2b isolation runner. Source overlays live only in worker memory;
no working file is ever replaced for baseline/mutation checks. No network or model.
"""
from __future__ import annotations

import hashlib
import ast
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

BOT = Path(__file__).resolve().parents[1]
REPO = BOT.parent
BASE = "26498c2a795bd910469cc1f528ddf4b4db6d8eff"
CORE = ("estimate", "photo_estimate", "quote_flow", "ai_chat", "conversation")
DEPS = Path("C:/Users/cyc39/AppData/Local/hermes/jarvis-memory/venv/Lib/site-packages")


def source(module, baseline=False):
    if baseline:
        return subprocess.run(["git", "show", f"{BASE}:line-bot/{module}.py"], cwd=REPO,
                              check=True, capture_output=True).stdout.decode("utf-8-sig")
    return (BOT / (module + ".py")).read_text(encoding="utf-8-sig")


def mutation_sources(kind):
    changes = {
        "first_item_only": ("estimate", '        for index, detail in enumerate(details):',
                            '        if line is not lines[0]:\n            details = []\n        for index, detail in enumerate(details):'),
        "mixed_discards_photo": ("estimate", 'if any(line.get("source") == "photo" or line.get("photo_items") for line in draft["lines"]):',
                                 'if all(line.get("source") == "photo" for line in draft["lines"]):'),
        "merge_discards_description": ("photo_estimate", '        current.setdefault("diagnoses", [dict(current)]).extend(diagnoses)', '        pass  # mutant: discard later diagnoses'),
        "followup_discards_context": ("ai_chat", '    if photo_context:', '    if False:  # mutant: discard photo context'),
        "bad_json_stops_chain": ("photo_estimate", '                last_error = "unavailable"\n                continue',
                                 '                return {"ok": False, "error": "unavailable"}'),
    }
    module, old, new = changes[kind]
    text = source(module)
    assert text.count(old) == 1, (kind, "mutation anchor changed")
    text = text.replace(old, new)
    # The customer _show path must lose the photo renderer as well as render().
    if kind == "mixed_discards_photo":
        old = 'any(x.get("source") == "photo" or x.get("photo_items") for x in draft.get("lines", []))'
        assert text.count(old) == 1
        text = text.replace(old, 'all(x.get("source") == "photo" for x in draft.get("lines", []))')
    return {module: text}


class OverlayLoader(importlib.machinery.SourceFileLoader):
    def __init__(self, name, path, text):
        super().__init__(name, str(path))
        self.text = text

    def get_code(self, fullname):
        return compile(self.text, self.path, "exec")


class OverlayFinder:
    def __init__(self, sources): self.sources = sources
    def find_spec(self, fullname, path=None, target=None):
        if fullname not in self.sources:
            return None
        filename = BOT / (fullname + ".py")
        return importlib.util.spec_from_file_location(fullname, filename,
                   loader=OverlayLoader(fullname, filename, self.sources[fullname]))


def load_runner():
    spec = importlib.util.spec_from_file_location("photo_fix_offline_runner", BOT / "run_a2b_tests.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    return runner


def hashes():
    return {name: hashlib.sha256((BOT / (name + ".py")).read_bytes()).hexdigest() for name in CORE}


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
            load_runner()._remove_tree(tmp, token)
        except (RuntimeError, OSError) as exc:
            if entry is None:
                raise
            entry.update(returncode=1, cleanup_error=str(exc))
    return entry


def write_samples():
    import types
    import test_photo_fix_r1 as tests
    import estimate
    import photo_estimate as pe
    old_estimate = types.ModuleType("photo_fix_before_estimate")
    old_estimate.__file__ = str(BOT / "estimate.py")
    exec(compile(source("estimate", True), old_estimate.__file__, "exec"), old_estimate.__dict__)
    old_photo = types.ModuleType("photo_fix_before_inventory")
    old_photo.__file__ = str(BOT / "photo_estimate.py")
    exec(compile(source("photo_estimate", True), old_photo.__file__, "exec"), old_photo.__dict__)
    row = tests.row
    cases = [
        ("不同品項各自保留診斷", [row(brand="Uniqlo", material="棉", stain="領口黃漬", craft="先測色牢度，再局部預處理", question="這處黃漬多久了"),
          row("一般運動鞋", brand="ASICS", material="網布拼接", stain="鞋頭泥漬", craft="鞋面與鞋底分區清潔", question="鞋子曾經自行刷洗嗎")], ""),
        ("照片加文字品項", [row("背包", brand="MUJI", material="帆布", stain="底部灰漬", craft="先測試掉色，再分區清潔", question="曾用清潔劑刷洗嗎")], "棉T2件"),
        ("同價目不同品牌與材質", [row(brand="Uniqlo", material="棉", stain="袖口灰漬", craft="局部預處理", question="灰漬多久了"),
          row(brand="MUJI", material="麻", stain="領口黃漬", craft="先確認纖維與色牢度", question="曾自行去漬嗎")], ""),
        ("低信心具體說明缺證據", [row("一般運動鞋", certainty="uncertain", reason="看不到洗標，看不出材質", brand="疑似 Nike", label="白色鞋子",
          stain="鞋緣灰痕", craft="先確認鞋面材質再評估清潔方式", question="可以補拍洗標或材質標示嗎？以前洗過嗎？")], ""),
        ("衣物鞋包與難乾大件的交期", [row(material="棉", stain="下襬灰漬", craft="局部測試後清潔"),
          row("一般運動鞋", material="網布", stain="鞋底泥沙", craft="鞋面鞋底分區處理"),
          row("背包", material="帆布", stain="背帶泛灰", craft="先測試色牢度"),
          row("棉被雙人", material="棉布表層", stain="邊緣黃痕", craft="依洗標確認填充材質與乾燥方式", question="可以補拍洗標嗎")], ""),
        ("大量物件依優先序刪減，最多五則", [row(brand="合成品牌"+"甲乙丙"[i//10]+"甲乙丙丁戊己庚辛壬癸"[i%10], material="棉",
          stain="袖口灰漬，領口有泛黃痕跡，需核對洗標與近照後才能判斷；接縫與鈕扣周邊也有積灰，照片無法確認深層變色情形",
          craft="先測試色牢度，局部預處理，再按洗標選擇清潔方式；領口袖口需分區處理，鈕扣與接縫避免強刷，特殊狀況交師傅評估",
          question="這件有自行使用過去漬劑或漂白水嗎") for i in range(30)], ""),
    ]
    output = ["# PHOTO-FIX r1：六組合成辨識結果的完整回覆", "",
              "本檔由離線腳本以同一組合成資料分別執行基底與修正版產生。價格為合成測試價表，不是新增的對外售價；沒有客人原訊息、照片或模型呼叫。", "",
              "交期固定：一般衣物 5–7 天、鞋 7 天、難乾大件 10–14 天、皮件包 14 天。每個 text 區塊就是一則訊息。", ""]
    for title, items, extra in cases:
        outputs = []
        for module, vision in ((old_estimate, old_photo), (estimate, pe)):
            names = set(module.catalog(tests.PRICES))
            value = module.from_photo(vision.validate_result({"items": items}, names), None, tests.PRICES)
            if extra:
                value = module.update(extra, value, tests.PRICES)
            messages = module.render_messages(value) if hasattr(module, "render_messages") else [module.render(value)]
            outputs.append(messages)
        output += ["## " + title, "", "合成辨識輸入（含各件欄位）：", "", "```json", json.dumps(items, ensure_ascii=False, indent=2), "```", ""]
        if extra: output += ["合成文字追加：" + extra, ""]
        for label, messages in zip(("修改前回覆", "修改後回覆"), outputs):
            output += ["### " + label, ""]
            for index, text in enumerate(messages, 1):
                output += [f"訊息 {index}/{len(messages)}（{len(text)} 字元）", "", "```text", text, "```", ""]
    (BOT / "photo-fix-r1-samples.md").write_text("\n".join(output), encoding="utf-8")


def verify_artifacts():
    before = json.loads((BOT / "photo-fix-r1-baseline.json").read_text(encoding="utf-8"))
    after = json.loads((BOT / "photo-fix-r1-suite.json").read_text(encoding="utf-8"))
    mutants = json.loads((BOT / "photo-fix-r1-mutations.json").read_text(encoding="utf-8"))
    baseline_failures = {r["module"]: r["failures"] for r in before if r["returncode"]}
    current_failures = {r["module"]: r["failures"] for r in after if r["returncode"]}
    assert current_failures == baseline_failures, "new or changed regression failures"
    assert len(after) == len(before) + 1
    assert mutants["before_sha256"] == mutants["after_sha256"] == hashes()
    assert len(mutants["mutations"]) == 5 and all(r["returncode"] and r["failures"] for r in mutants["mutations"])
    assert mutants["restored"]["returncode"] == 0
    def definition(text, name):
        for node in ast.parse(text).body:
            if isinstance(node, ast.FunctionDef) and node.name == name:
                return ast.dump(node)
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
                return ast.dump(node)
        raise AssertionError(name)
    stable = {"estimate": ("price", "PHOTO_TURNAROUND"),
              "photo_estimate": ("thinking_budget", "model_chain", "MAX_CALLS", "TOTAL_SECONDS", "PER_CALL_SECONDS", "SCHEMA")}
    for module, names in stable.items():
        old, new = source(module, True), source(module)
        for name in names:
            assert definition(old, name) == definition(new, name), (module, name, "changed")
    document = (BOT / "photo-fix-r1-samples.md").read_text(encoding="utf-8")
    sample_metrics = []
    for section in re.split(r"^## ", document, flags=re.M)[1:]:
        text = section.split("### 修改後回覆", 1)[1]
        messages = re.findall(r"```text\n(.*?)\n```", text, re.S)
        assert 1 <= len(messages) <= 5 and all(0 < len(t) <= 900 and "AI" not in t for t in messages)
        sample_metrics.append({"title": section.splitlines()[0], "messages": len(messages), "characters": list(map(len, messages))})
    assert len(sample_metrics) == 6
    report = {"base": BASE, "source_sha256": hashes(), "baseline_modules": len(before), "current_modules": len(after),
              "baseline_tests": sum(r["tests"] for r in before), "current_tests": sum(r["tests"] for r in after),
              "new_failures": [], "existing_sandbox_failures": current_failures,
              "mutation_versions_killed": 5, "restored_tests": mutants["restored"]["tests"],
              "unchanged_definitions": stable, "samples": sample_metrics}
    (BOT / "photo-fix-r1-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True, indent=2))


def main():
    if sys.argv[1] == "--worker":
        module, tmp, variant = sys.argv[2:]
        sources = {name: source(name, True) for name in CORE + ("test_estimate", "test_vision_usage")} if variant == "baseline" else (
            mutation_sources(variant) if variant not in ("current", "samples") else {})
        sys.meta_path.insert(0, OverlayFinder(sources))
        result = load_runner()._run_module(Path(tmp), module)
        if variant == "samples" and result == 0:
            write_samples()
        return result
    mode = sys.argv[1]
    if mode in ("suite", "baseline"):
        modules = [p.stem for p in sorted(BOT.glob("test_*.py")) if mode != "baseline" or p.stem != "test_photo_fix_r1"]
        modules += ["tests." + p.stem for p in sorted((BOT / "tests").glob("test_*.py"))]
        report_path = BOT / f"photo-fix-r1-{mode}.json"
        results = json.loads(report_path.read_text(encoding="utf-8")) if mode == "baseline" and "--resume" in sys.argv else []
        for module in modules:
            if any(r["module"] == module for r in results):
                continue
            entry = run(module, "baseline" if mode == "baseline" else "current")
            results.append(entry)
            print(module, entry["returncode"], flush=True)
            report_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print("TOTAL", len(results), "FAIL", sum(r["returncode"] != 0 for r in results), flush=True)
        return int(any(r["returncode"] != 0 for r in results))
    if mode == "mutations":
        before = hashes()
        results = [run("test_photo_fix_r1", kind) for kind in (
            "first_item_only", "mixed_discards_photo", "merge_discards_description", "followup_discards_context", "bad_json_stops_chain")]
        restored = run("test_photo_fix_r1")
        report = {"before_sha256": before, "after_sha256": hashes(), "mutations": results, "restored": restored}
        (BOT / "photo-fix-r1-mutations.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        for result in results:
            print(result["variant"], result["returncode"], result["failures"])
        return int(not (before == hashes() and restored["returncode"] == 0 and all(r["returncode"] != 0 and r["failures"] for r in results)))
    if mode == "samples":
        result = run("test_photo_fix_r1", "samples")
        print(result["output"])
        return result["returncode"]
    if mode == "verify":
        verify_artifacts()
        return 0
    raise SystemExit("usage: photo_fix_r1_checks.py baseline|suite|mutations|samples|verify")


if __name__ == "__main__":
    raise SystemExit(main())
