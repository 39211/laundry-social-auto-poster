# 私享家搜尋詞白名單與替換規則 — 2026-09-02

## 判決

「關鍵詞太少」不能用無限增加同義詞解決。本站先用有限的 24 個服務／問題詞做觀測白名單，全部映射到既有服務頁或 `shoe-odor-source` pilot；只有 GSC 非品牌曝光或實際 GA4／LINE 訊號出現，才保留或替換，暫不因詞數增加新 URL。

## 證據層級

- `GSC_OBSERVED`：目前日檔實際出現過的非品牌詞：`娃娃送洗台中`、`喜鞋店`、`干洗的衣服可以水洗嗎`。另有歷史 pilot 優先訊號 `勃肯鞋會臭嗎`。
- `PUBLIC_DEMAND_SHAPE`：公開結果反覆出現的服務／問題型態；只能排序，不代表月搜尋量、排名或收錄保證。
- `HYPOTHESIS`：尚未在第一方 GSC 出現，只做內容對照，不作成功宣稱。

## 24 詞白名單（不新增頁面）

| 意圖群 | 觀測詞 | 證據層級 | 目前承接頁 |
|---|---|---|---|
| 鞋／異味 | 鞋子臭、鞋內悶味、鞋子除臭、台中洗鞋除臭 | `HYPOTHESIS`（pilot surface） | `guides/shoe-odor-source.html` |
| 鞋／材質 | 麂皮鞋清潔、帆布鞋沾泥、皮鞋水痕、鞋子可以丟洗衣機嗎 | `PUBLIC_DEMAND_SHAPE` | Cohort A 候選；目前不 live |
| 鞋／在地服務 | 台中洗鞋、西屯洗鞋、逢甲洗鞋、鞋子送洗 | `PUBLIC_DEMAND_SHAPE`／既有頁 | `services/shoe-bag-care.html`、`local/qinghai-road-shoe-cleaning.html` |
| 包／清潔 | 台中洗包、包包送洗、精品包清潔、真皮包清潔 | `PUBLIC_DEMAND_SHAPE` | `services/shoe-bag-care.html`、既有包類指南 |
| 包／問題 | 包包發霉、包包染色、包包原子筆、包包內裡髒 | `PUBLIC_DEMAND_SHAPE`／既有內容 | 既有包類指南；不拆同義 URL |
| 衣物／收送 | 西屯洗衣店、台中免費洗衣收送、棉被清洗、羽絨衣送洗 | `PUBLIC_DEMAND_SHAPE` | `services/taichung-xitun-laundry.html`、`services/taichung-citywide-laundry-pickup.html`、既有寢具指南 |

核心白名單共 24 詞。另行保留 GSC telemetry（不計入核心白名單）：「娃娃送洗台中」、「喜鞋店」、「干洗的衣服可以水洗嗎」與歷史 pilot 詞「勃肯鞋會臭嗎」；這些詞只用來觀察實際曝光，不自動建立新頁。

## 第二來源觀測池（12 詞，不增加 URL）

本池來自可直接開啟的台中洗鞋／洗衣公開頁與近兩週公開服務內容，只作 GSC query 分群與既有頁對照，不代表搜尋量或排名保證；不因加入觀測池而改寫 HTML `keywords`、JSON-LD 或新增城市頁。

| 詞 | 證據層級 | 既有承接頁 |
|---|---|---|
| 台中鞋子送洗 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/shoe-bag-care.html`、`local/qinghai-road-shoe-cleaning.html` |
| 運動鞋清洗 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/shoe-bag-care.html` |
| 白鞋清潔台中 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/white-shoe-cleaning.html` |
| 西屯洗包 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/shoe-bag-care.html` |
| 台中包包送洗 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/shoe-bag-care.html` |
| 精品包送洗 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/shoe-bag-care.html`、既有包類指南 |
| 台中床被送洗 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/taichung-citywide-laundry-pickup.html`、既有寢具指南 |
| 羽絨被送洗台中 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/taichung-citywide-laundry-pickup.html`、`guides/bedding-duvet-cleaning.html` |
| 西裝乾洗台中 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `guides/shirt-suit-dry-cleaning.html`、價目頁 |
| 台中洗衣收送 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/taichung-citywide-laundry-pickup.html` |
| 企業制服送洗 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/business-bulk-laundry.html` |
| 台中到府洗衣 | `PUBLIC_DEMAND_SHAPE_VERIFIED` | `services/taichung-citywide-laundry-pickup.html` |

觀測池來源與核對結果記錄於 `reports/grok-x-demand-verification-2026-09-02.md`。來源頁只證明服務／問題型態存在；第 7／28 天仍以本站 GSC 非品牌曝光、GA4 自然搜尋與 LINE click 決定 KEEP／RETEST／REPLACE。

## 量測與替換

1. 每日只讀 GSC `top_queries`、GA4 organic／AI sessions 與 LINE click；缺欄位保留 `null`。
2. 第 7 天只看是否開始出現非品牌 impressions、crawl／coverage；沒有新資料維持 `PENDING`。
3. 第 28 天若詞有非品牌曝光且帶來 GA4 organic 或 LINE click，標記 `KEEP`；只有曝光沒有互動標記 `RETEST`；完整 28 日仍零曝光且頁面已被檢索，標記 `REPLACE`，以另一個已證明的同一意圖詞替換，不新增同義頁。
4. 任何詞若只在競品或公開結果出現、未在 GSC 出現，不得寫成「有搜尋量」或直接擴成城市門頁。

### 最新資料可用性

`data/insights/gsc/2026-08-29.json`（於 2026-09-01 取得）目前 `top_queries=[]`、`top_query_pages=[]`；因此本批新增詞仍是公開需求型態觀測，不得宣稱已在本站 GSC 出現。下一個 2026-09-02 收集週期完成前，維持 `PENDING`，不以空陣列當成零搜尋量。

## 目前狀態

`PENDING`。最新 GSC／GA4 檔案仍停在 2026-09-01，pilot 觀測第 7 天為 2026-09-09、第 28 天為 2026-09-30；第一個 100 indexed 里程碑與 150／200 規劃均未宣稱完成。
