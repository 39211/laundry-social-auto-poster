# Live claim staleness scan — 2026-08-31

## 結果

本次只做文件層級的一致性檢查，沒有改 `src/`、`scripts/`、排程、發布紀錄，也沒有重新提交 IndexNow。掃描 `reports/`、`docs-internal/`、`data/insights/` 的 Markdown／JSON，尋找可能把 `56`、`24` 或 `new_guides_live` 誤讀成目前 live 的文字。

- 字面命中：37 行。
- 已明確標示為 isolated／historical／not live／candidate／404／未部署等上下文：27 行。
- 另 10 行經人工核對，均不是目前 live 數字：
  - 今日 action log 的 `new_guides_live_today` 實值為 `0`。
  - action log 的 `sitemap_urls=56` 位於 `historical_isolated_indexnow`，且 `counts_as_current_live=false`。
  - completion matrix 的 56 是「隔離輸出」；其他報告中的 56 是驗證規則、歷史標題或未來部署後的預期值。
- JSON 交叉驗證：`data/insights/seo-actions/2026-08-31.json.live_now.sitemap_urls=32`，與 live sitemap `<loc>` 數 `32` 相符；隔離候選 `24` 仍未上線。

## 判讀邊界

這是防止報告誤讀的 lexical／人工分類檢查，不是 Google 收錄證明。Google 最新可用快照仍為 `26 indexed / 6 discovered - currently not indexed`，而 24 個候選頁沒有 GSC URL Inspection 證據。現階段不得把歷史隔離輸出的 56、候選 24 或提交數字當成 live 或 indexed。

## 後續

維持單一 live source of truth（公開 sitemap）與分層欄位；等 23:10／23:15 排程後再依 heartbeat 規則讀取 GA4/GSC freshness。PR #30 的 rewrite、provenance、safety、mutation、host 與 live gate 未清除前，不部署候選頁。
