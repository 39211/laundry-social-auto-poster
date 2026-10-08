# Index-growth accepted 24 safety language scan（2026-08-31）

## 範圍

只讀掃描 PR #30 accepted 24 頁隔離 HTML 的可見文字（移除 script/style/noscript 與 HTML tag），檢查停手／限制語句、已知危險指令模式及案例暗示。此為 lexical screen，不是語意安全核准。

## 結果

| Check | Result | 判讀 |
|---|---:|---|
| 明確停手條件（不要／不建議／不保證等） | 24/24 | 表面安全訊號存在 |
| 清潔限制（只能淡化／無法／不是清潔等） | 24/24 | 有界線句，但不證明 claim provenance |
| 危險指令 pattern（用力抖、刷掉霉、拍散霉、整件漂白等） | 0/24 | 未命中已知危險字串；不等於完整語意安全 |
| 清潔前／清潔後／案例／恢復提示 | 17/24 | **REVIEW**：共用未核實素材可能造成案例誤導 |

## 判讀與 release

詞彙掃描不能證明衣物發霉內容在所有欄位、所有改寫下都安全；先前 mutation probe 已證實把 `clothing-mold-airing` answer 改成戶外抖／刷仍會 `ok=true`。因此本報告只作輔助證據，release 仍 `REWRITE_REQUIRED`，必須通過語意 safety mutation、provenance、snippet、live link closure 與獨立複審後才可部署。

