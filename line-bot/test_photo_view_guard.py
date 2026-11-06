# -*- coding: utf-8 -*-
"""Photo recognition precision (11/06): a partly visible item is never "clear".

The model states `view` ("whole"/"partial") before `certainty`; validate_result turns clear+partial into estimated.
Run this file in its own Python process. No real network, no production writes.
"""
import json
import os
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
TEMP = Path(tempfile.mkdtemp(prefix="sxj-view-guard-")).resolve()
os.environ["LAUNDRY_VISION_USAGE_DIR"] = str(TEMP / "vision-usage")
os.environ["LAUNDRY_PHOTO_ESTIMATE"] = "0"
urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(AssertionError("unmocked network"))
sys.path.insert(0, str(ROOT))
import photo_estimate as pe

NAMES = {"厚外套", "中大衣", "一般運動鞋", "一般包"}


def row(name="厚外套", view=None, certainty="clear", quantity=1, reason="看到外套", question=""):
    data = {"name": name, "label": "深色外套", "quantity": quantity, "certainty": certainty, "reason": reason,
            "brand": "", "model": "", "material": "羊毛", "color": "深棕", "stain": "", "craft": "", "question": question}
    if view is not None:
        data["view"] = view
    return data


def validate(*rows):
    return pe.validate_result({"items": list(rows)}, NAMES)


class ViewGuardTests(unittest.TestCase):
    def test_partial_view_cannot_stay_clear(self):
        out = validate(row(view="partial", certainty="clear"))[0]
        self.assertEqual(out["certainty"], "estimated")
        self.assertEqual(out["name"], "厚外套")
        self.assertEqual(out["quantity"], 1)

    def test_partial_view_asks_for_a_full_photo_when_the_model_asked_nothing(self):
        out = validate(row(view="partial", certainty="clear", question=""))[0]
        self.assertEqual(out["question"], "可以補拍整件的照片嗎")

    def test_the_models_own_question_and_reason_are_kept(self):
        out = validate(row(view="partial", certainty="clear", question="可以拍衣長嗎", reason="只看到領口"))[0]
        self.assertEqual((out["question"], out["reason"]), ("可以拍衣長嗎", "只看到領口"))

    def test_partial_view_with_an_empty_reason_gets_a_plain_one(self):
        out = validate(row(view="partial", certainty="clear", reason=""))[0]
        self.assertEqual(out["reason"], "照片只拍到一部分，款式或尺寸還需要確認")

    def test_whole_view_stays_clear(self):
        out = validate(row(view="whole", certainty="clear"))[0]
        self.assertEqual((out["certainty"], out["question"]), ("clear", ""))

    def test_answers_without_a_view_field_behave_as_before(self):
        out = validate(row(view=None, certainty="clear"))[0]
        self.assertEqual(out["certainty"], "clear")

    def test_junk_view_values_do_not_break_or_downgrade(self):
        for junk in ("PARTIAL", "", None, 1, ["partial"], {"a": 1}):
            data = row(certainty="clear")
            data["view"] = junk
            self.assertEqual(validate(data)[0]["certainty"], "clear", repr(junk))

    def test_estimated_and_uncertain_rows_are_not_touched_by_partial(self):
        out = validate(row(view="partial", certainty="estimated", question=""))[0]
        self.assertEqual((out["certainty"], out["question"]), ("estimated", ""))
        out = validate(row(name="", view="partial", certainty="clear", quantity=None))[0]
        self.assertEqual(out["certainty"], "uncertain")

    def test_partial_row_merged_with_a_clear_row_of_the_same_name_is_not_clear(self):
        out = validate(row(view="whole", certainty="clear"), row(view="partial", certainty="clear"))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["certainty"], "estimated")
        self.assertEqual(out[0]["quantity"], 2)

    def test_other_rows_in_the_same_answer_are_unaffected(self):
        out = validate(row("中大衣", view="partial"), row("一般運動鞋", view="whole"))
        by = {r["name"]: r["certainty"] for r in out}
        self.assertEqual(by, {"中大衣": "estimated", "一般運動鞋": "clear"})

    def test_validation_errors_still_raise(self):
        bad = row(view="partial")
        bad["quantity"] = 0
        with self.assertRaises(ValueError):
            validate(bad)


class SchemaAndPromptTests(unittest.TestCase):
    def test_schema_makes_the_model_state_view_before_certainty(self):
        props = list(pe.SCHEMA["properties"]["items"]["items"]["properties"])
        self.assertLess(props.index("quantity"), props.index("view"))
        self.assertLess(props.index("view"), props.index("certainty"))
        spec = pe.SCHEMA["properties"]["items"]["items"]["properties"]["view"]
        self.assertEqual(spec, {"type": "string", "enum": ["whole", "partial"]})
        self.assertIn("view", pe.SCHEMA["properties"]["items"]["items"]["required"])

    def test_prompt_defines_whole_and_partial_and_forbids_clear_for_partial(self):
        prompt = pe.build_prompt(sorted(NAMES))
        self.assertIn("view（寫在 certainty 之前）", prompt)
        self.assertIn("填 whole", prompt)
        self.assertIn("填 partial", prompt)
        self.assertIn("view 是 partial 時 certainty 一定不可以是 clear", prompt)
        self.assertIn("【欄位】view：whole 或 partial", prompt)


class PlainFormatTests(unittest.TestCase):
    def test_plain_json_format_lists_view_between_quantity_and_certainty(self):
        fmt = pe.FALLBACK_FORMAT
        self.assertIn("這 13 個欄位", fmt)
        self.assertLess(fmt.index('"quantity"'), fmt.index('"view"'))
        self.assertLess(fmt.index('"view"'), fmt.index('"certainty"'))
        self.assertIn("partial 時 certainty 不可是 clear", fmt)


class PipelineTests(unittest.TestCase):
    def test_inventory_downgrades_a_partial_clear_answer_from_the_model(self):
        rows = [row(view="partial", certainty="clear")]
        body = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps({"items": rows})}]}}]}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, *args):
                return json.dumps(body).encode()

        settings = {"GEMINI_API_KEY": "synthetic-key", "LAUNDRY_PHOTO_ESTIMATE": "1", "LAUNDRY_VISION_MODEL": "gemini-2.5-flash"}
        with patch.dict(os.environ, settings), \
             patch.object(pe.urllib.request, "urlopen", side_effect=[Response()]) as request, \
             patch.object(pe.time, "sleep"):
            result = pe.inventory([ROOT / "test-assets" / "estimate-items-synthetic.png"], sorted(NAMES))
        self.assertTrue(result["ok"])
        self.assertEqual(result["items"][0]["certainty"], "estimated")
        # gemini-2.5-flash is asked in plain JSON mode: the request carries FALLBACK_FORMAT, not SCHEMA.
        sent = json.loads(request.call_args_list[0].args[0].data)
        self.assertNotIn("responseJsonSchema", sent["generationConfig"])
        texts = [p["text"] for p in sent["contents"][0]["parts"] if "text" in p]
        self.assertTrue(any('"view"("whole"' in t for t in texts), texts)


if __name__ == "__main__":
    unittest.main()
