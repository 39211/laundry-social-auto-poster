# 第一方需求／服務證據分流（2026-08-31）

## 判決

下一批不應照 queue 順序直接建立新頁。現有資料顯示：`hat-cleaning-check` 有價目與檢查流程的第一方候選證據，但仍缺公開服務範圍與合法素材確認；`luggage-interior-cleaning` 與已 live 的行李箱輪子指南高度相鄰，沒有足夠獨立服務事實，先不拆 URL。這個分流比增加候選數更接近 100 頁的可驗證路徑。

## 證據鏈（候選輸入，不等於 live 或收錄）

| 候選／既有頁 | 已找到的第一方訊號 | 目前判定 | 下一個必要證據 |
|---|---|---|---|
| `guides/hat-cleaning-check.html` | `data/prices.json` 有「帽子 80」、「皮帽子 300」、「精品帽子 130」；`src/contentPlan.ts:175-181` 有安全帽內襯／外套帽沿的材質、可拆結構與除味判斷 | `EVIDENCE_PARTIAL` | 確認店家現行收件範圍、洗標／材質限制與可合法使用的照片或檢查紀錄；未確認前不得進 catalog |
| `guides/luggage-interior-cleaning.html` | `src/generatePublicSite.ts:2172-2210` 的 live 定義已涵蓋輪子、底板、布面、把手、發霉到內襯的限制；`src/contentPlan.ts:189-195` 也只有行李箱整體／輪邊流程 | `DO_NOT_SPLIT` | 若未能證明獨立的內裡服務流程，改強化既有 `luggage-wheel-cleaning`，不建同義 URL |
| `services/business-bulk-laundry.html` | 現有生成內容描述制服、工作衣、毛巾、床組、分類、交接與照片詢問 | `ENHANCE_EXISTING` | 合法商業服務範圍、最低量／交期事實；沒有合法客戶案例就不寫數字或成果 |
| `guides/curtain-cleaning.html`／`guides/carpet-cleaning.html` | 已有各自材質、尺寸、潮濕與不可逆風險段落 | `ENHANCE_EXISTING` | 只補真實拆掛／污漬處理範圍；不把同一服務拆成問題詞薄頁 |

## 19:37 live scope recheck

- 逐頁檢查 sitemap 的 32 個 live URL，帽子／皮帽子／精品帽子／安全帽／帽沿等詞命中 `0/32`；公開價格頁也沒有帽子項目。
- 因此帽子候選由 `EVIDENCE_PARTIAL` 收緊為 `EVIDENCE_INTERNAL_ONLY`：本機價目與內容計畫不能代替公開服務承接證明。完整結果見 `reports/live-hat-scope-audit-2026-08-31.md`。
- 在店家確認服務範圍與可公開素材前，不進 catalog、不加入 sitemap、不送 IndexNow；其他既有頁強化順序不變。

## 閘門與順序

1. 先取得 `hat-cleaning-check` 的服務 profile、素材 provenance 與安全界線；若任一缺失，維持 `EVIDENCE_REQUIRED`。
2. 先強化既有行李箱、B2B、窗簾／地毯頁的答案與語意內鏈，不新增 URL。
3. 新頁只有在 claim-level provenance、非 doorway、單一 resolver、mutation fail-then-restore、圖片標示、production host 與 live 200／canonical／schema 閘門全部通過後，才可部署。
4. 部署前後分開記錄：sitemap／IndexNow 是提交證據；GSC inspection／coverage 才是收錄證據。7 日維持 `PENDING`／`RETEST`，完整 28 日資料後才可 `ADOPT`／`REJECT`。

## 限制

這些價目與內容計畫是本機第一方輸入，不能代替目前店家實際承接範圍或 live 頁面；本報告未修改 source、未建立新頁、未部署、未送出新的 IndexNow。

## 20:40 GSC 近期需求重查（第一方觀測）

- 最新可用 GSC 搜尋成效檔為 `data/insights/gsc/2026-08-27.json`（於 2026-08-30 讀取）：`15` impressions、`0` clicks、平均位置 `17.13`。
- 觀測到的 query 是「娃娃送洗台中」（1 impression、position 24）與「私享家」（4 impressions、position 2.5）；對應頁面包含首頁、絨毛娃娃清洗、床墊／羽絨被、精品乾洗、制服與襯衫西裝指南。
- 與可比較的 2026-08-23 快照相比，impressions `13→15`、clicks `1→0`；這是小樣本訊號，不足以推估搜尋量或排名趨勢，先列為 `PENDING`。
- 今日可行方策：優先把「娃娃送洗台中」的真實服務範圍、材質限制與送洗流程補進既有絨毛娃娃頁的答案與內鏈；不新增同義城市薄頁。7 日判定需同時看到該頁 indexed／impressions 上升且 clicks 不下降，否則 `RETEST`；28 日前不作 `ADOPT`／`REJECT`。

## 20:42 可用 GSC 快照彙總（11 個日檔）

- 以現有 11 個 GSC 日檔的 `top_queries` 聚合：品牌詞「私享家」7 天、20 impressions、0 clicks；「勃肯鞋會臭嗎」2 impressions；「娃娃送洗台中」1 impression；「絨毛娃娃清洗店」1 impression。資料量很小，不能當作市場搜尋量。
- `top_pages` 聚合最高的是首頁 33 impressions／0 clicks，其次勃肯鞋指南 12／0、床墊羽絨被指南 6／0、精品乾洗指南 5／0、絨毛娃娃指南 4／0；白鞋服務頁 3 impressions／1 click，是目前唯一可觀測 click 的非首頁服務頁。
- 因此首批需求優先序採「既有頁面先提升答案與轉換路徑」：勃肯鞋、白鞋、絨毛娃娃與床墊／羽絨被；新增 URL 仍需獨立服務事實與 7／28 日驗證，不用這些小樣本外推 100 頁。
