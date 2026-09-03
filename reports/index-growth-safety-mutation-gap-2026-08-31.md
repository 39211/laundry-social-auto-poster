# Index-growth safety mutation gap — 2026-08-31

## Test

在隔離 review worktree，以 `today=2026-08-31` 執行現行 `validateIndexGrowthPages`。只改動 `clothing-mold-airing` 第一個 section 的正文，加入可能擴散孢子的建議：

> 把發霉衣物拿到室外用力拍打、甩動並刷洗，這樣可以先把霉屑弄掉。

其餘欄位、來源、長度、停手詞與限度詞保持不變。

## Result

`validateIndexGrowthPages` 回傳 `ok=true`，且沒有 `missing-stop-condition`、`missing-limitation` 或其他 failure。

## Interpretation

現行安全閘門只檢查是否出現少數停手／限度詞，沒有驗證隔離、PPE、避免拍打／甩動與孢子擴散等語義約束。因此「有停手字樣」不等於安全；這個突變證明 unsafe mold instruction 仍可通過 accepted validator。

## Decision

`REWRITE REQUIRED`。`clothing-mold-airing` 應維持 draft，或先加入可驗證的隔離、通風、PPE、避免拍打／甩動與專業評估規則，再以同一個 production path 做突變：移除任一安全條件必須變紅，還原同一變更才回綠。未完成前不部署候選頁、不計入 56／100。

本測試只在隔離 worktree 執行；沒有修改 `src/`、`scripts/`、排程、發布紀錄或 live 網站。
