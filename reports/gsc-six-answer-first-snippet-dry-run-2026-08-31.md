# GSC 六頁答案先行 snippet dry-run — 2026-08-31

## 範圍

以六個 live `Discovered - currently not indexed` 頁面已有的答案／正文事實，僅在記憶體組成候選 meta／OG／Twitter description。沒有寫回 HTML、沒有改 source、沒有部署，也沒有重送 IndexNow。

## 候選文案與表面閘門

| 頁面 | 候選答案先行文案 | 字元 | UTF-8 bytes | 品牌先行 | 危險承諾 |
|---|---|---:|---:|---:|---:|
| `taichung-citywide-laundry-pickup` | 台中全市可預約免費洗衣收送，沒有最低消費門檻；清潔與洗護費另依物件狀態判斷，先用 LINE 傳照片詢問。 | 52 | 144 | 否 | 0 |
| `business-bulk-laundry` | 台中店家、公司或工作室的大量制服、工作衣、毛巾與床組，可先用 LINE 提供品項、數量與照片；清潔與洗護費依實際物件判斷。 | 61 | 171 | 否 | 0 |
| `taichung-laundry-price-list` | 台中洗衣洗鞋洗包參考價約 $70 到 $2500；水洗、乾洗、柔洗與特殊材質另行判斷，參考價不是固定價。 | 52 | 134 | 否 | 0 |
| `taichung-xitun-laundry` | 台中西屯洗衣店可處理衣物、鞋包、白鞋與布品收納，先依材質、痕跡位置與狀態判斷，再用 LINE 傳照片詢問。 | 53 | 147 | 否 | 0 |
| `taichung-laundry-service-search` | 找台中洗衣、洗鞋、洗包或免費收送，先按物件、問題、材質與收送需求分流，再到對應服務頁確認處理界線。 | 49 | 147 | 否 | 0 |
| `fabric-storage` | 布品收納前先確認是否乾燥、有無汗味、悶味、黃痕或局部髒污，再決定清潔後收納；特殊材質仍需逐件檢查。 | 49 | 147 | 否 | 0 |

## 實驗契約

1. 只把同一頁的三個 snippet surface（meta、Open Graph、Twitter）同步成該頁候選文案；title、answer box、canonical、JSON-LD、robots、內鏈與 control pages 不同時改。
2. 先在隔離輸出驗證原文事實、HTML escape、三面同步、字數／bytes 與危險承諾；再由授權 PR 執行 source patch、focused/full/typecheck、live recheck。
3. `fabric-storage` 的文案只描述檢查流程，不宣稱客案成果；任何第一手照片或案例必須另有日期、物件與 claim-level provenance。
4. 部署後 Day 0 記錄變更雜湊；7 日只觀察 GSC crawl／impressions／clicks，28 日且 GA4/GSC 欄位完整才可依預先規則判 `ADOPT`、`RETEST` 或 `REJECT`。缺值保持 `PENDING`／`INCONCLUSIVE`。

## 判定

表面 snippet gate `PASS_FOR_DRY_RUN`，實際 release 仍 `NOT_READY`：PR #30 的 provenance、revision/hash、resolver、semantic safety、exact host、whole-path mutation、獨立複審與 live deployment 尚未完成。這個 dry-run 不證明 Google 會採用摘要，也不證明收錄會增加。
