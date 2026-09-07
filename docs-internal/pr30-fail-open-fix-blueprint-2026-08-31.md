# PR #30 fail-open 修復藍圖（2026-08-31）

## 目的與邊界

這份文件把隔離 mutation probe 的結果轉成可實作契約；不是合併、部署或關閉測試的授權。現行 PR #30 head `ba6ab5a85524c3a5e4fa4c0848c89be7b944881d` 的 CI 雖綠，release 仍必須保持 `REWRITE_REQUIRED`。

## 實際缺口與最小修復

| 實際位置／符號 | 現況（probe 已證實） | 最小修復契約 | 必須變紅的 mutation |
|---|---|---|---|
| `validateIndexGrowthPages` 的 `page.publish_state ?? "accepted"` | 缺少 `publish_state` 時 validator 仍通過 | 先以單一 normalizer 拒絕缺省／未知狀態；accepted、draft、rejected、merge 的投影與 count 共用同一結果 | 移除或改未知 `publish_state` |
| `resolveAcceptedIndexGrowthPages` 先自行 `filter(page.publish_state === "accepted")` | validator 與 resolver count 可靜默分歧（23 vs 24） | validator 回傳 accepted projection；resolver 只消費該 projection，不得另行推導 accepted 集合 | 移除一頁狀態後，validator、resolver、sitemap count 同時 fail |
| `requireSourceRefs`／`INDEX_GROWTH_SOURCE_REGISTRY` | 只檢查 registry key 存在；`origin`／`note` 空白仍 pass | registry record 必須有非空 origin、locator、摘要與 frozen content hash；每個 claim／step／section／FAQ 逐一綁定並核對 | 清空一筆 registry provenance |
| `content_revision` 只驗 `YYYY-MM-DD#N` | 任意 revision 與正文改寫仍 pass | 將 revision 綁定到同一頁的 canonical content projection hash（或等價不可變 digest）；輸出前精確比對 | 任意 revision、section body、title/answer 改寫 |
| stop／limitation lexical checks | 發霉頁加入拍打／甩動／刷洗仍 pass | 對高風險主題建立結構化 safety contract；在渲染後 HTML 檢查禁止動作、隔離／PPE、不可擴散與清潔／修復界線 | `clothing-mold-airing` 加入危險指令 |
| generator host gate | 錯誤 host 可在 generator 早期拒絕，但未證明 `publishPages` 每條 path 都套用 | `publishPages` entrypoint 在讀資料／clone／write 前共用 exact production host assertion | 將 production host 改為 `evil.example` |

## 驗收順序（不可只測 helper）

1. 以完整 24 頁 catalog 建立 baseline：validator、resolver、HTML projection、sitemap projection 全部綠。
2. 逐案只套用一個 mutation，且從同一 production path 執行：
   - citation／答案改寫或移除 → `citation-fallback`／`citation-lead` fail；
   - source registry 空白或 claim 改綁 → provenance failure；
   - 任意 revision 或正文 hash 改變 → `revision/content-hash` failure；
   - mold 危險動作 → safety failure；
   - publish state 移除／未知 → state failure 且 resolver count 不得靜默變化；
   - publish host 錯誤 → 在任何資料讀取／寫入前拒絕。
3. 還原同一 mutation，必須回到與 baseline 相同的綠燈與 count；保存 failure code、頁 slug、projection hash。
4. 再跑 focused/full/typecheck、隔離 HTML／SEO-only overlay、live 200／canonical／noindex／JSON-LD／sitemap audit；最後才可取得獨立複審。

## Release 判定

目前六組中只有 citation 缺失能穩定變紅；其餘 mutation 曾 fail-open。未完成整體 fail-then-restore、production host coverage、provenance hash 與獨立複審前：

- 不把 24 頁算入 live 56 或 indexed 100；
- 不更新 live sitemap、不送新的 IndexNow、不合併 PR #30；
- 不以 CI 綠燈或 HTTP 200 代替 Google 收錄證據。

