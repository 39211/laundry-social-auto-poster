# Index-growth provenance record integrity gap — 2026-08-31

## Isolated mutation

在完整 24 頁 catalog 上，把 `INDEX_GROWTH_SOURCE_REGISTRY["svc:shoe-bag-care"]` 的 `origin` 與 `note` 暫時改成空字串，其他頁面內容與 source ref ID 不變；以 `today=2026-08-31` 執行現行 validator，測試結束後還原 registry object。

## Result

- `validateIndexGrowthPages`: `ok=true`
- source-related failures: `[]`

## Interpretation

目前 gate 只確認 source ref key 存在，沒有驗證 registry record 的 origin、locator、摘要、內容雜湊或可讀性。即使來源位置消失，整批仍可進 accepted；這與 claim-level immutable provenance 要求不符。

## Decision

`REWRITE REQUIRED`。每個 claim 的來源必須綁定可驗證 locator、摘要與 immutable hash；移除任一欄位的真 mutation 必須 fail，還原後才回綠。未修正前，不把 `ok=true` 當成可部署品質證明，也不計入 live 56／100。

本測試只在隔離 worktree 執行；沒有修改 `src/`、`scripts/`、排程、發布紀錄或 live 網站。
