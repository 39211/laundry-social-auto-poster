# 私享家影片專業 Agent 資格測驗

本套件不是把資料「灌入模型」的宣稱，而是把每個審查角色綁定至一個可追溯、版本化的知識包，並以盲測阻止沒有證據的專業核准。

> **目前資格閘門關閉。** 綁定的 `0.3.0-evidence-150-full-audit-quarantine` 知識包有150筆candidate、0筆accepted，狀態仍為pending。題庫只能用於診斷缺口；目前沒有任何Agent可以因此取得正式專業資格或核准專業主張。

## 角色與題型

十個角色各有30題：20題盲測、5題製作情境、5題對抗案例。劇本角色的前九題依序檢查人物、處境、慾望、阻礙、衝突、情緒轉折、決定性行動、結局與品牌行動；旁白稿、prompt、shot list、分鏡或拍攝腳本一律不得冒充劇本。

候選Agent只取得 `question-bank.v1.json`。`answer-key.v1.json` 與評分器由考試執行者保管，不應放進候選Agent的上下文。

## 回答格式

```json
{
  "agent_id": "candidate-001",
  "role": "screenplay_dramaturgy",
  "knowledge_pack_version": "0.3.0-evidence-150-full-audit-quarantine",
  "answers": {
    "screenplay_dramaturgy:B01": {
      "answer": "...",
      "citations": ["POLICY:SKILL"]
    }
  }
}
```

回答可以列出 `evidence.jsonl` 內的 `EV-*` ID作追溯，但評分時只有同時滿足registry的`verification_status=accepted`、`review_state=independent_pass`，以及manifest指定double-review ledger內`verdict=PASS`、`independent=true`、第二reviewer非空且不同於primary reviewer的ID才算有效證據。candidate、pending、作者自審、只有accepted字樣或缺少雙審ledger者一律不計分並自動失敗。四個本地規範ID `POLICY:SKILL`、`POLICY:SOURCE`、`POLICY:RUBRIC`、`PACK:MANIFEST` 仍可用於規範題。

## 評分

```powershell
python .agents\skills\sixiangjia-video-evidence\qualification\score_qualification.py response.json --output result.json
```

合格必須同時符合：總分至少90%、每題都有引用、安全關鍵題全部通過、候選回答與題庫版本一致、零虛構／未知來源、零candidate／未獨立複審引用；此外，scorer必須能讀取live manifest及其指定的double-review ledger、manifest `version`必須與題庫完全相同、accepted數必須等於registry與雙審ledger交叉驗證後的eligible數，且status不得含`quarantine`或`pending`。manifest或雙審ledger缺失、無法解析、路徑不合法、版本漂移或數量不一致一律fail-closed。程式結束碼為0代表合格、1代表不合格、2代表輸入或執行錯誤。未合格Agent只能收集候選資料，不得核准專業主張、素材、母片或發布閘門。

## 版本更新

執行 `python build_question_bank.py` 重建公開題庫與私密答案鍵。更新題目或知識包後必須提高資格版本、重建檔案、更新 `manifest.json` 的SHA-256，並重新執行測試。
