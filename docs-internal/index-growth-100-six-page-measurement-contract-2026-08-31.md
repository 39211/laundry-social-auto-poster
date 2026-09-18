# 六頁 snippet 實驗量測契約 — 2026-08-31

## 目的

把「答案先行 snippet＋一條情境內鏈」當成可重複的單一主變因，讓六個既有 `discovered-not-indexed` 頁的結果能以 GSC／GA4 正確判讀；不把 HTTP 200、IndexNow 200 或摘要顯示誤當成收錄。

## 可用資料與缺值規則

| 系統 | 目前檔案／欄位 | 本實驗可用欄位 | 缺值處理 |
|---|---|---|---|
| GSC | `data/insights/gsc/YYYY-MM-DD.json` | `top_pages[].keys`、`clicks`、`impressions`、`ctr`、`position`；總表同名欄位 | 頁面未出現在 `top_pages` 就是 `null`，不可改寫成 0；GSC OAuth 失效標 `blocked/unmeasured` |
| GSC index | `data/insights/gsc-index/YYYY-MM-DD.json` | `indexed_count`、狀態分類與 URL inspection 時間 | 沒有新快照就維持上一個已標日期，不能宣稱變化 |
| GA4 | `data/insights/ga4-traffic/YYYY-MM-DD.json` | `by_source[].sessions`、`engaged_sessions`、`traffic_class`、`ai_landing_pages`（若有） | 沒有根層 `engaged_sessions` 或 `line_click` 時，分別由來源列彙總／保留 `null`；沒有 page dimension 就不推算六頁流量 |

目前可用基線（2026-08-30 GA4、2026-08-27 GSC）中，六頁沒有穩定的 GSC `top_pages` row，GA4 也沒有可用的頁面維度；因此 Day 0 六頁 page-level clicks／impressions／sessions 都是 `null`，不是 0。

## 實驗設計

1. **Treatment**：先只套用 `services/taichung-citywide-laundry-pickup.html` 的答案先行三面摘要；該頁既有正文與內鏈不變。
2. **Controls**：`business-bulk-laundry`、`taichung-laundry-price-list`、`taichung-xitun-laundry`、`taichung-laundry-service-search`、`fabric-storage` 維持原 HTML；不可同日修改 body、title、schema、canonical 或圖片。
3. **第二變因延後**：情境內鏈修正須另開變更日；若同時改摘要與內鏈，結果標為 `INCONCLUSIVE`。
4. **部署前**：隔離輸出驗三面同步、answer-first、bytes、HTML escape、canonical／JSON-LD／robots 與 remote target 200；PR30 provenance、revision/hash、resolver、safety、exact-host、whole-path mutation 與獨立複審全部通過才可 deploy。

## 判定規則

- **Day 0**：保存 treatment／control HTML 雜湊、live sitemap `lastmod`、GSC index snapshot 日期與 GA4 schema；記錄所有缺值為 `null`。
- **7 日**：若有新 GSC snapshot，檢查 treatment 是否由 discovered 轉 indexed、是否出現 impressions／clicks／CTR；沒有新資料則 `PENDING`。GA4 只報告實際存在的 sessions／engaged sessions／AI referral，LINE click 缺欄位仍 `null`。
- **28 日**：資料完整且同一變因未被污染時，依預先門檻判 `ADOPT`、`RETEST` 或 `REJECT`；任何 OAuth、page dimension 或 crawl evidence 缺失都判 `INCONCLUSIVE`，不以小樣本補值。

## 目前狀態

`READY_FOR_AUTHORIZED_SOURCE_PATCH`，但不是 release approval。六頁候選摘要的表面 dry-run 已通過，source 尚未修改；live sitemap 仍 32，24 個新候選仍未部署。這份契約的用途是讓後續 7／28 日結果可歸因，不能保證 Google 會採用摘要或增加收錄。
