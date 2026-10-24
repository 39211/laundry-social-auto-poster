# Index-growth-100 需求證據（2026-08-31）

本檔是公開 SERP 的需求訊號，不是關鍵字月搜量；沒有把搜尋結果數量誤報成流量或收錄保證。候選頁仍須通過 PR 的 provenance、safety、resolver 與 production gate。

## 第一方 GSC 訊號（可量測基線）

目前可用的 `data/insights/gsc/*.json`（2026-08-14 至 2026-08-27，共 11 個檔案）合計 63 次 impressions、1 次 click；可辨識的非品牌查詢只有 `勃肯鞋會臭嗎`、`娃娃送洗台中`、`絨毛娃娃清洗店`。這是很小的樣本，不代表市場搜尋量；它只用來決定第一批內容的驗證順序。2026-08-24 至 2026-08-26 沒有可用檔案，不能補寫成 0。

| 第一方查詢 | 目前觀測 | 下一個可驗證內容方向 |
|---|---:|---|
| `勃肯鞋會臭嗎` | 2 impressions、0 click（2026-08-23） | 鞋材／異味成因與送洗前判斷；對應 `shoe-odor-source` |
| `娃娃送洗台中` | 1 impression、0 click（2026-08-27） | 娃娃送洗流程與收送判斷；維持既有 `plush-doll-cleaning` 內鏈 |
| `絨毛娃娃清洗店` | 1 impression、0 click（2026-08-23） | 比較清潔風險與可交件條件；不建立城市複製頁 |

優先順序採「已出現的第一方意圖 → 公開 SERP 的材質／決策需求 → B2B 情境」；每一批發布後以 7／28 日 GSC query、landing sessions 與 LINE click 驗證，沒有達到規則就保持 `PENDING`，不以頁數取代需求證據。

## 可重複的搜尋意圖訊號

| 公開查詢 | SERP 出現的需求／競品訊號 | 對應候選方向 | 建議驗收證據 |
|---|---|---|---|
| `台中 西屯 洗衣 價格 洗鞋 送洗` | 搜尋結果同時出現台中在地洗鞋、到府收送、服務分類與價格型內容 | 西屯洗衣、價格、收送 | 真實服務區域、估價因素、收送限制；不做只換地名的複製頁 |
| `麂皮鞋 清潔`、`帆布鞋 泥巴`、`皮鞋 水痕` | 洗衣／洗鞋業者依材質與污漬拆分處理，而非一篇泛鞋清潔文 | `suede-shoe-care`、`canvas-shoe-mud-care`、`leather-shoe-water-marks` | 材質判斷、不可逆風險、店內檢查步驟、第一手案例或照片 |
| `包包 發霉`、`包包 清潔 還是 維修` | 結果同時包含防霉、清潔、補色與「能否救回」決策需求 | `bag-clean-vs-repair`、`bag-lining-care`、`rainy-bag-care` | 先判斷污染範圍與結構，再說可處理／不可保證；不能只塞品牌描述 |
| `企業 制服 大量 洗衣 台中` | B2B 結果按制服、飯店床單、餐飲油污、毛巾等作業情境拆分 | `business-bulk-laundry`、企業大量洗衣 | 最小批量、交期、分類、回收交件與材質限制；需要合法商業案例才可寫案例數字 |
| `羊毛大衣 乾洗 縮水`、`羊毛衣 縮水` | 官方／教育內容反覆提醒羊毛遇水、熱與烘乾有縮水風險 | `wool-coat-dry-clean`、`wool-knit-shrink-risk` | 以洗標與材質為先；寫清「可能淡化／無法保證恢復」，避免危險偏方 |
| `衣服 發霉 怎麼辦`、`衣物 收納 發霉` | 結果混合防潮、完全乾燥、收納與專業處理；不是單純「拿去曬」 | `clothing-mold-airing`、`post-wash-drying-before-storage` | 隔離、通風、手套／口罩與避免孢子擴散；未完成安全改寫維持 draft |

## 來源與限制

- 羊毛縮水的物理原因與乾洗／低熱建議，可由台灣國立科普內容與家電官方文章交叉核對：<https://scitechvista.nat.gov.tw/Article/C000008/detail?ID=b82e690b-f754-4681-98ed-8ca160208ee0>、<https://www.electrolux.com.tw/blog/how-to-wash-woolen-clothes/>。
- 在地與 B2B 情境的 SERP 例子：<https://rebirth407.com/>、<https://daweiwash.com/industries/corporate-uniform/>、<https://daweiwash.com/>。
- SERP 出現不等於有可量化搜尋量；要以 GSC impressions／queries、GA4 landing sessions 與 LINE click 的 7／28 日資料驗證。

## 今日判定

- 需求研究：`PASS（訊號已收集）`。
- 內容是否應發布：`PENDING`，因 PR #30 的獨立審查仍為 `REWRITE`，且候選 URL 尚未 live。
- 不能做的推論：不能由 SERP 出現、IndexNow 200、HTTP 200 或 sitemap 56 推論 Google 已收錄或 AI 已引用。

## 17:33 GSC 檔案重算

- 逐檔讀取目前可用的 11 個日檔，`totals.impressions` 加總為 `63`、`totals.clicks` 加總為 `1`；這個數字取代本檔先前誤沿用的 79，並已同步到 heartbeat 報告與 evidence manifest。
- 2026-08-24、08-25、08-26 沒有日檔；這三天維持缺值，不推定為 0，也不把缺檔造成的差異解讀成流量下降。

## 19:33 查詢層重算

- 重新逐檔讀取 11 個 GSC 日檔的 `top_queries`：共有 10 筆查詢列、4 個不重複查詢；品牌查詢 `私享家` 佔 20 impressions（7 個檔案），非品牌仍只有 3 個查詢。
- 非品牌查詢保持：`勃肯鞋會臭嗎` 2 impressions／平均位置 21、`絨毛娃娃清洗店` 1 impression／平均位置 14、`娃娃送洗台中` 1 impression／平均位置 24；合計 4 impressions、0 clicks。
- 日檔 `totals` 仍是 63 impressions／1 click；缺檔日（2026-08-24～26）不補 0。查詢列用來排序既有鞋／娃娃頁的答案與內鏈，不足以支持帽子或行李箱新 URL。
- 這是 first-party query evidence，不是市場搜尋量或 Google 收錄證明；帽子候選仍需服務範圍／素材，行李箱內裡維持 `DO_NOT_SPLIT`。

## 16:21 需求→既有頁核對

- 最新可用的第一方 GSC 日檔仍是 2026-08-27：`娃娃送洗台中` 1 impression、0 click、平均位置 24；同日整站 15 impressions、0 clicks。
- live `guides/plush-doll-cleaning.html` HTTP 200，title 為「台中絨毛娃娃清洗店？先看填充與五官」，正文已明列填充、五官、配件與送洗前照片詢問；因此目前更適合做「既有頁意圖／內鏈／snippet」實驗，而不是再建立城市複製頁。
- GSC index snapshot 的 26 indexed／6 discovered 仍是 2026-08-30 產出的 stale 快照；本次核對不把缺少的 2026-08-24～26 檔案填成 0，也不把一次 impression 當成市場搜尋量。

## 可量測優先序（不是市場規模估計）

在可用的 2026-08-18～27 日檔中，第一方非品牌訊號很少，應用來排「先驗證哪一頁」，不能用來宣稱需求排名：

| 既有頁／訊號 | 可用檔案累計 | 判讀與下一步 |
|---|---:|---|
| `services/white-shoe-cleaning.html` | 3 impressions、1 click（其中一次平均位置 3） | 目前唯一有非零 click 的服務頁；先固定內容，只觀察 snippet／內鏈變因，不能把單一 click 當成穩定趨勢。 |
| `guides/birkenstock-care.html`／`勃肯鞋會臭嗎` | 頁面 12 impressions；查詢 2 impressions、0 click | 材質＋異味意圖已有重複曝光；可作第一個 query-to-page 內鏈實驗，不新增城市複製頁。 |
| `guides/plush-doll-cleaning.html`／`娃娃送洗台中` | 頁面 4 impressions；查詢 1 impression、0 click | 頁面主題已對題但位置 24～41；先改善可抽取答案與 CTA 脈絡，再決定是否建立新頁。 |

**固定判定：** 以實驗部署日為基線，7 日只在 crawl／inspection 且 impressions 或 clicks 有改善時 `ADOPT`；只有 crawl 前進為 `RETEST`；資料不足為 `PENDING`。28 日仍無改善且 GSC／GA4 完整才可 `REJECT`，缺資料則 `INCONCLUSIVE`。
