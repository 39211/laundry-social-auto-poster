# Live content thickness audit（2026-08-31）

## 結論

逐頁重新抓取 live sitemap 的 32 個 URL，全部 HTTP 200；正文（優先取 `<main>`）去除 script／style 後為 1,025–55,889 字元。六個 GSC `Discovered - currently not indexed` 頁面並非空白頁：正文長度為 1,820–3,267 字元，不能把「尚未收錄」直接歸因於內容太短。

因此第一個 100 頁實驗仍應測「問題答案先行＋語意情境內鏈＋第一方證據」，而不是把 sitemap 塞滿或複製城市頁。PR #30 的 24 個候選頁只存在隔離輸出，且 live 404；它們不列入本次 live 厚度分母。

## 方法與總覽

- 來源：`https://sixiangjialaundry.com/sitemap.xml`，抓取時間 2026-08-31 19:22（Asia/Taipei）。
- 量測：HTTP status、`<main>` 可見文字字元數、`h1`／`h2` 數量、頁面是否含 FAQPage／HowTo JSON-LD 與答案標記。
- 32/32 頁有 1 個 h1；所有頁面 HTTP 200。首頁正文 55,889 字元，服務／指南頁的差異以意圖與證據判讀，不用字元數當品質分數。

## 最短正文尾端（先做既有頁強化，不新增同義 URL）

| 路徑 | 正文字元 | h2 | 建議 |
|---|---:|---:|---|
| `/guides/shirt-suit-dry-cleaning.html` | 1,025 | 5 | 補洗標／不可逆風險的第一方判斷，保留現有 URL |
| `/guides/leather-jacket-care.html` | 1,243 | 5 | 補皮革受潮、掉色與交件檢查；不寫保證恢復 |
| `/guides/luxury-bag-mold.html` | 1,253 | 5 | 先行答案與安全界線優先；不把品牌描述當答案 |
| `/guides/down-jacket-cleaning.html` | 1,258 | 5 | 補填充物／洗標／乾燥條件，避免泛化清潔偏方 |
| `/guides/school-uniform-care.html` | 1,274 | 5 | 補制服污漬分流與收件前照片流程 |
| `/guides/white-shoe-yellowing.html` | 1,359 | 6 | 維持白鞋黃化意圖，作價格頁的語意內鏈目標 |
| `/guides/bedding-storage-check.html` | 1,390 | 6 | 補收納前檢查清單；不虛構案例照片 |
| `/guides/dry-cleaning-guide.html` | 1,397 | 5 | 補乾洗適用／不適用材質的判斷表 |

## 六個 discovered-not-indexed 頁面

| 路徑 | 正文字元 | 目前判讀 |
|---|---:|---|
| `/services/business-bulk-laundry.html` | 2,116 | 內容不薄；需合法 B2B 服務事實與正文情境內鏈 |
| `/services/taichung-laundry-price-list.html` | 1,820 | 六頁中最短；先補估價因素與兩條已確認正文連結 |
| `/guides/taichung-laundry-service-search.html` | 2,088 | hub 意圖已存在；避免變成關鍵字目錄或城市 doorway |
| `/services/taichung-citywide-laundry-pickup.html` | 2,609 | 內容不薄；維持收送範圍／限制與搜尋指南分流 |
| `/services/fabric-storage.html` | 2,823 | 有檢查流程；沒有第一方照片前不宣稱案例成果 |
| `/services/taichung-xitun-laundry.html` | 3,267 | 內容不薄；保留西屯到店事實，不複製搜尋指南 |

## 量測限制與下一步

- 字元數、HTTP 200、FAQ／HowTo 標記都不是 Google 收錄證明；GSC 目前仍是 26 indexed／6 discovered 的過期快照。
- 今日唯一可執行的內容順序：先處理上述短尾既有頁的答案／證據，再在已確認的三個正文缺口補鏈；不新增大量 URL。
- 新候選頁要等 PR #30 完成 provenance、mutation、safety、production-host 與 live-closure 閘門，通過獨立複審後才可部署；部署後才重新量測 sitemap／canonical／schema 並提交一次 IndexNow。
- 7 日只判 crawl／inspection 與 impressions／clicks 的 `PENDING` 或 `RETEST`；資料完整滿 28 日才可 `ADOPT`／`REJECT`。本報告不把厚度改善寫成收錄增加。

## 20:45 本機 HTML 與 live sitemap 分母核對

- 本機 `docs/` 有 `154` 個 HTML，但以 live sitemap 的 32 個 URL 反查，32/32 都有對應本機檔；另有 `122` 個本機 HTML 未列入 live sitemap，其中 `117` 個是 `posts/` 貼文頁。
- 這個差異是「本機產物」與「已部署且提交的索引候選」兩個分母，不能把 154 當作已上線頁數，也不能把貼文頁直接加回 sitemap 來湊 100。
- 今日索引實驗分母固定為 live sitemap `32` 與 GSC `26 indexed／6 discovered`；只有通過品質、非 doorway、live 200、canonical／schema 與提交後 GSC 驗證的頁，才可增加分母。

## 20:47 本機 public-site audit（範圍標記）

- 執行 `npm.cmd run audit-public-site`：本機 HTML `154`、JSON `143`、broken URLs `0`、missing alt `0`、non-image content types `0`、NAP profile match `yes`。
- 這是本機 public-site 產物品質檢查，不是 live deploy／GSC 收錄證據；仍以 live sitemap 32 與 GSC 26 indexed 作索引分母。

## 20:46 live page recheck

- 逐頁重新抓取 sitemap 32 URLs：HTTP 200、self-canonical、JSON-LD 與 `dateModified` 均為 `32/32`；noindex `0/32`。
- 這確認 live 技術條件未退化，但沒有增加收錄數或解除 PR30 的 release gates。
