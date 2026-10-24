# 首個 100 indexed 頁目標審計 — 2026-09-02

## 結論

首個 100 頁尚未達成；目前可核實的 GSC 快照是 25/32 indexed，live sitemap 是 33 URL。系統與單頁 pilot 已能通過品質／發布邊界檢查，但尚未有足夠的 7／28 日成效證據解除下一批放量 gate。

## 要求與證據

| 目標要求 | 現況 | 直接證據 | 判定 |
|---|---|---|---|
| 官方 Google 索引規則與限制 | 已整理 sitemap、重抓、people-first、spam／doorway、AI 搜尋要求 | `reports/google-indexing-requirements-mapping-2026-08-31.md` | PASS（研究完成） |
| 真實搜尋需求 | 已整理第一方 GSC query、公開結果需求型態與 X 候選案例；本輪再獨立核對 10 個來源並剔除日期錯誤／無法開啟的自述 | `reports/recent-seo-case-synthesis-2026-09-02.md`、`reports/grok-x-demand-verification-2026-09-02.md`、`docs-internal/index-growth-100-keyword-map-2026-09-02.md` | PASS（排序資料，不是流量保證） |
| 品質閘門 | candidate autopilot 僅產生 `DRAFT_ONLY`，禁止寫站、部署、GSC request、IndexNow、新 URL | `src/gscSeoCandidateAutopilot.ts`、`test/gscSeoCandidateAutopilot.test.ts` | PASS（26/26 focused tests） |
| 下一批 overlay 可重現性 | 5 頁檔案、sitemap delta、hash 與解除 gate 條件已封裝；交叉驗證 5/5 hash、候選誤列 live 0 | `docs-internal/index-growth-100-cohort-a-release-package-2026-09-02.json`、`reports/index-growth-cohort-a-package-validation-2026-09-02.md` | READY_FOR_REVIEW |
| 曝光回饋閘門 | exposure review 保留 null、檢查當日 freshness，7／28 日只輸出 PENDING／INCONCLUSIVE | `src/seoExposureReview.ts`、`test/seoExposureReview.test.ts` | PASS（含 stale／missing 測試） |
| 關鍵詞 live 承接 | 12 個新增觀測詞逐頁核對：完整字串 2/12；其餘保留為語意觀測缺口，不直接堆入頁面 | `reports/keyword-live-coverage-2026-09-02.md`、`docs-internal/index-growth-100-keyword-map-2026-09-02.md` | PASS（內容承接稽核，不是曝光證據） |
| 下一個內容變因準備 | 已建立「台中鞋子送洗」單一 treatment 草稿；未改 live、schema 或對照頁 | `docs-internal/keyword-treatment-1-shoe-service-2026-09-02.md` | READY（待 pilot gate） |
| GSC 曝光基線 | 最新快照 9 impressions／0 clicks；6 個頁面有曝光，query rows 空，無法確定歸因 | `reports/gsc-page-exposure-baseline-2026-09-02.md`、`data/insights/gsc/2026-08-29.json` | PASS（基線，不是成效證明） |
| 六頁未索引診斷 | 6/6 live HTTP 200、自指 canonical、無 noindex、正文均 ≥500 字元；較像 crawl／評估等待，不是明顯技術阻擋 | `reports/gsc-discovered-live-diagnostic-2026-09-02.md`、`data/insights/gsc-index/2026-09-01.json` | PASS（仍不等於收錄） |
| 當日候選自動化 gate | `gsc-seo-candidates/2026-09-02.json` 正確輸出 `BLOCKED/current_collection_cycle_missing`，沒有在缺少當日 GSC／inspection 時生成候選或發布 | `output/operations/gsc-seo-candidates/2026-09-02.json` | PASS（安全阻擋） |
| IndexNow 去重狀態 | live sitemap、當日報告與成功提交 state 的 semantic SHA 完全一致；下一次未變更會跳過，不會重送 | `reports/indexnow-state-consistency-2026-09-02.md`、`output/operations/indexing-push-state.json` | PASS |
| 唯一 crawled-not-indexed 頁 | 逢甲收送頁 live 200、自指 canonical、無 noindex；複查確認已有逢甲／宿舍／租屋第一方情境，原因仍未知，不因粗略 token 重疊就改寫 | `reports/gsc-crawled-not-indexed-fengjia-2026-09-02.md` | INCONCLUSIVE（待新鮮 inspection） |
| Pilot 公開可見性 | 三組公開搜尋未返回 `shoe-odor-source.html` 結果，但直接頁 HTTP 200；只作弱負面訊號，不取代 GSC | `reports/public-serp-pilot-check-2026-09-02.md` | INCONCLUSIVE |
| 初始高價值批次 | `shoe-odor-source` 已 live 200；Cohort A 五頁有 hash／canonical／答案面與結構證據，答案面已與隔離第一方建置樹逐頁對照，但獨立客案／素材證據仍缺 | `docs-internal/index-growth-100-evidence-manifest-2026-09-02.json`、`docs-internal/index-growth-100-cohort-a-provenance-2026-09-02.json` | pilot PASS；Cohort A HOLD |
| live 可抓取與提交證據 | sitemap 200／33 URL、pilot 200；live 傳播完成後依「報告落後 live」規則只修正提交一次，IndexNow 接受首頁與鞋包服務頁 2 URL（HTTP 200） | `output/operations/indexing-push-2026-09-02.json`、`reports/indexnow-propagation-2026-09-02.md`、GitHub Actions run `33562731871`、[100-page evidence manifest](../docs-internal/index-growth-100-evidence-manifest-2026-09-02.json) | PASS（提交不等於收錄） |
| 逐 URL live 可解析性 | sitemap 內 33/33 HTTP 200、canonical 自指、noindex 0、正文均 ≥500 字元 | `reports/live-sitemap-url-audit-2026-09-02.md` | PASS（仍非收錄證據） |
| 本機／live mirror 一致性 | 已回填 pilot、補 sitemap 與首頁／鞋包服務內鏈；部署後本機／live URL 集合 33/33 相同；本次 sitemap 日期修正亦已完成傳播 | `reports/live-mirror-drift-2026-09-02.md`、GitHub Actions run `33562731871` | PASS（仍需每次發布前重驗） |
| Google 收錄與曝光 | 最新 GSC 25/32；新 33 URL 尚未有 2026-09-02 fresh inspection；GSC `top_queries`／`top_query_pages` 為空；GA4 2026-09-01 為 3 sessions、organic 0、LINE unmeasured | `data/insights/gsc-index/2026-09-01.json`、`data/insights/gsc/2026-08-29.json`、`data/insights/ga4-traffic/2026-09-01.json` | INCONCLUSIVE |
| 100 頁里程碑 | 25 indexed，距 100 尚差 75；150／200 不應提前規劃 | `docs-internal/index-growth-100-evidence-manifest-2026-09-02.json` | NOT ACHIEVED |

## 本輪驗證

- `npm.cmd exec -- vitest run test/gscSeoCandidateAutopilot.test.ts test/seoExposureReview.test.ts test/indexingPush.test.ts test/auditSitemap.test.ts`：4 files／26 tests PASS。
- `npm.cmd exec -- tsc --noEmit`：PASS。
- 5 個 Cohort A 候選檔案與 provenance 的 SHA-256／bytes：5/5 PASS。
- live：sitemap 200、pilot 200、5 個候選目前 404；沒有把離線候選誤列為 live 或 indexed。

## 下一個可執行動作

1. 等今日 23:10 GA4、23:15 GSC 排程完成後，只讀新鮮檔案；缺檔或失敗才依 runbook 補一次。
2. 每次下一次 `publish-pages` 前重驗本機／live mirror URL 集合與 pilot hash，避免 pilot 被覆蓋掉。
3. 在 2026-09-09 做 pilot 第 7 天抓取／canonical 檢查；在 2026-09-30 做第 28 天非品牌 GSC、GA4 organic、LINE 三者交叉判定。
4. 只有 pilot `ADOPT` 才部署 Cohort A 五頁；部署前重跑 provenance、素材與 guide link closure，並同批確認 5 個 404 目標變成 live 200。
5. 關鍵詞維持有限白名單；7／28 日沒有曝光或互動時替換詞，不以詞數或 sitemap 大小宣稱進展。

## 尚未完成／風險

- Google 商家檔案的名稱、類別、服務、照片與評論仍需在外部 UI 取得實際變更證據；本審計沒有假設已修改。
- GSC URL Inspection 的新鮮結果尚未產生，不能把 33 live URL 推算成 33 indexed。
- Cohort A 的 claim／素材 provenance 仍標記 `PENDING_RECHECK`，因此目前不部署。
