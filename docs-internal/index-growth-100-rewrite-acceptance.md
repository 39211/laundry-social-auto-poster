# Index-growth-100 PR rewrite acceptance (2026-08-31)

這份文件只定義 PR #30 的修正與驗收，不代表候選頁已部署或已被 Google 收錄。當前 live sitemap 仍為 32 URL；GSC 為 26 indexed、6 discovered/not indexed。

## 必修項目（對應獨立審查）

1. **生產 host gate**
   - `publishPages` 及所有 production entrypoint 必須拒絕非明確 `https://sixiangjialaundry.com` 的 host／origin。
   - 測試需證明：預覽／fixture／其他 host 不會寫入 production Pages；合法 production host 才能繼續。

2. **單一 accepted resolver**
   - accepted URL、projection、count、sitemap、HTML 輸出都必須來自同一個 resolver。
   - 禁止另外以 registry key 或手寫數字推導 `accepted_count`；測試須驗證 resolver 變更會同步反映所有投影。

3. **不可變 claim-level provenance**
   - 每一頁的每個主要 claim 都要有自己的來源 locator、摘要與內容雜湊；不能把相同 registry reference 複製到所有 claims。
   - registry key 存在本身不算 provenance；缺來源、缺 locator 或 hash 不得進 accepted 集合。

4. **revision／production hash enforcement**
   - `revision` 必須由內容與發布批次的實際資料產生，不能全頁固定 `2026-08-30#1`。
   - production validator 必須檢查 cohort／content hash；測試要證明內容改動、revision 改動、hash 不匹配各自會 fail。

5. **安全內容與真 mutation gate**
   - `clothing-mold-airing` 先維持 draft 或重寫為隔離、PPE、防止孢子擴散的安全流程；未通過安全審查不得 accepted。
   - mutation 必須實際移除生產 gate、resolver、provenance 或 safety 條件之一而變紅，還原同一變更後回綠；只測 helper hash 不足。

## 上線前固定閘門

- focused tests、full tests、`tsc --noEmit`、`git diff --check` 全部通過。
- 在隔離輸出根目錄產生靜態 HTML；只允許 HTML／SEO 檔 overlay，禁止把約 646 MB 資產樹灌入 Pages。
- overlay 前後各讀一次 sitemap，逐 URL 驗證 HTTP 200、canonical、JSON-LD、正文厚度與非 doorway 內鏈。
- live sitemap 必須從 32 變為 56 且只包含 accepted 24；任何 404、future-dated URL、draft、重複 canonical 都停止發布。
- live recheck 通過後才可做一次 IndexNow；IndexNow 200 只記為提交證據，不計入 indexed。

## Google 官方政策對照

- Google Search Essentials 的技術最低要求包含可抓取、HTTP 200 與可索引內容；即使符合最低要求，也不保證 Google 會抓取、收錄或展示。<https://developers.google.com/search/docs/essentials/technical>
- Doorway abuse 禁止以相似城市／地區頁把使用者導向同一目的地；因此每頁必須有不同且可驗證的服務情境、處理界線與正文價值，而不是只換地名。<https://developers.google.com/search/docs/essentials/spam-policies>
- Google 對 scaled content abuse 的正式政策依據是 Spam Policies：重點在大量頁面是否為操縱排名、缺乏原創且對人有用的價值，而不取決於是否使用 AI。候選頁必須有第一手流程、素材判斷、風險與來源，不得以數量作為通過理由。<https://developers.google.com/search/docs/essentials/spam-policies>
- Google 的 Generative AI Search guide 說明：既有 SEO 與可索引性仍是基礎，且不需要靠「AEO／GEO hacks」、不必要的 `llms.txt`、內容切塊或大量查詢變體頁；因此本案以可驗證的 people-first 內容與 Search Console 觀測為準。<https://developers.google.com/search/docs/fundamentals/ai-optimization-guide>

## 2026-08-31 官方規則複核

- 今日重新核對 Google 技術最低要求：Googlebot 不得被封鎖、頁面須回 HTTP 200、內容須可索引；符合最低要求仍不代表一定會抓取、收錄或展示，特定 URL 的判定仍以 Search Console URL Inspection 為準。<https://developers.google.com/search/docs/essentials/technical>
- 今日重新核對 Spam Policies：以多個城市／地區相似頁把使用者導向同一目的地屬 doorway abuse；羅列城市或地區來堆疊關鍵字也屬風險。因此 100 頁計畫維持「不同服務情境 + 可驗證流程 + 明確處理界線」的逐頁驗收，不用地名替換批量擴頁。<https://developers.google.com/search/docs/essentials/spam-policies>
- 今日重新核對 Generative AI Search guide：生成式搜尋仍以 Search index 與既有 SEO/可索引性為基礎，重點是對人有用、非商品化的內容與技術可抓取性；本複核沒有改變 PR #30 的上線決定，也沒有把提交、IndexNow 或 HTTP 200 誤記為已收錄。<https://developers.google.com/search/docs/fundamentals/ai-optimization-guide>

## 7／28 日判定

- **7 日**：以部署日 GSC snapshot 為基線；若 crawl／inspection 前進且 indexed 或 impressions 增加，`ADOPT`；只有 crawl 前進、indexed 未變，`RETEST`；資料不足維持 `PENDING`。
- **28 日**：若完成上述閘門後仍無 crawl、indexed 或 impressions 改善，才可 `REJECT`；若 GSC／GA4 缺資料或 OAuth 阻斷，標示 `INCONCLUSIVE`，不得填 0。

## 當前狀態

- PR #29、#30：OPEN；PR #30 CI `typecheck-and-test` 綠燈。
- Luna code review：`REWRITE`，尚未符合上述五項。
- live：32 sitemap URL；候選新頁目前仍為 404。
- 需要的下一個授權：只在 PR 分支修改上述實作與測試，完成獨立複審後才可 HTML／SEO-only 部署。
