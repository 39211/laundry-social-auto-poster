# 既有頁 snippet 實驗 brief（2026-08-31）

## 目的

把目前已有 first-party GSC 訊號的三個 live URL 分成一個 treatment 與兩個 controls，測「答案先行的 meta description」是否比品牌／地址先行更能承接問題型查詢。這不是新頁發布，也不把 snippet 變化當成收錄保證。

## Live 基線

| URL | GSC 可用訊號 | answer box（live） | meta description 判讀 | 組別 |
|---|---:|---|---|---|
| `/services/white-shoe-cleaning.html` | 3 impressions／1 click | `台中西屯白鞋清潔不建議直接漂白或硬刷，應先看鞋面材質、膠邊氧化、縫線卡灰、鞋墊與內裡味道，再判斷可清潔程度。` | 品牌／地址先行 | treatment |
| `/guides/birkenstock-care.html` | 12 page impressions；`勃肯鞋會臭嗎` 2 impressions | `勃肯鞋會臭，多半是軟木鞋床吸汗，不是鞋面；整雙泡水會更糟。` | 問題答案先行 | control |
| `/guides/plush-doll-cleaning.html` | 4 page impressions；`娃娃送洗台中` 1 impression、`絨毛娃娃清洗店` 1 impression | `娃娃可以洗，但不能亂洗；怕的是脫水結塊與五官脫落，要先固定再手洗。` | 問題／服務範圍先行 | control |

## 唯一變因（待取得 source 授權）

只調整白鞋頁的 `<meta name="description">` 順序，保留既有服務事實與限制。候選文字完全由 live answer／既有正文重組：

> 白鞋泛黃、鞋邊泛灰或內裡有味道，先看材質、膠邊氧化、縫線、鞋墊與內裡，再判斷可清潔程度。私享家洗衣店台中西屯可到府收送。

不改 answer box、title、canonical、schema、robots、GA4 事件或兩個 control URL；不增加新 URL。若要補正文內鏈，另立實驗，不與 meta treatment 同時改動。

## 驗收與判定

1. 隔離輸出先確認白鞋 meta、answer box、canonical、JSON-LD、正文厚度與既有目標 HTTP 200；control URL hash／HTML 不變。
2. 部署後記錄變更時間，7 日只判 GSC crawl／inspection 與 impressions／clicks 的 `PENDING` 或 `RETEST`；不能只看 snippet 顯示。
3. 28 日且 GSC／GA4 完整時，treatment 相對 control 若 impressions 或 clicks 改善且無品質回退才可 `ADOPT`；無改善才可 `REJECT`，資料缺失為 `INCONCLUSIVE`。

## 目前狀態

`READY_FOR_AUTHORIZED_SOURCE_PATCH`。本 brief 只完成 live evidence 與實驗設計；目前未修改 source、未部署、未提交 IndexNow。提交、HTTP 200、IndexNow 200 都不等於 Google 已收錄。

## 19:42 isolated dry-run

將候選 meta 文案套用到記憶體字串（未寫回 HTML）後，結果為：60 字元／180 UTF-8 bytes、答案開頭 `白鞋泛黃`、品牌不先行、含材質與可清潔限制、含既有台中西屯收送事實、未出現「保證／一定／完全恢復／全新」等承諾。這只證明文案符合表面閘門，不代表部署或收錄；source patch 仍需授權與完整 HTML／SEO audit。
