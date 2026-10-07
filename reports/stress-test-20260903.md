# 私享家壓力／對抗測試報告（2026-09-03）

範圍：已合併的 PR #32 / #33 / #34、`447f1cee` 搜尋知識漏斗、以及 `6950bc90` / `365f7404` / `c7a46da0` 的 indexing fail-closed 閘門。  
約束：全程 dry-run、不上網、不碰 `.env` 真密鑰、不為了讓測試變綠去改產品語意。

## 命令

環境變數（與 CI 相同的 placeholder，另加 dry-run）：

```bash
export PUBLIC_SITE_BASE_URL="https://example.invalid"
export PUBLIC_IMAGE_BASE_URL="https://example.invalid"
export DRY_RUN="true"
```

| 步驟 | 命令 |
|---|---|
| 安裝 | `npm ci` |
| Typecheck | `npx tsc --noEmit` |
| 全套件 | `npx vitest run` |
| 新壓力測試 | `npx vitest run test/stressFailClosedGates.test.ts test/stressSearchAnalytics.test.ts test/stressRotationAndVolume.test.ts` |
| 新程式碼聚焦 | `npx vitest run test/indexGrowthPages.test.ts test/publishPages.test.ts test/ga4Report.test.ts test/auditSitemap.test.ts test/publicSite.test.ts` |

沒有執行任何 `--live` / `publish` / `deploy`，也沒有打 Meta / GSC / GA4 collect / LINE / IndexNow。GA4 測試全部走 stub `fetchImpl`。

## Baseline

| 檢查 | 結果 | 耗時 |
|---|---|---|
| `npm ci` | 成功（62 packages） | ~2s |
| `npx tsc --noEmit` | **PASS** exit 0 | 3.415s（後續重跑 3.036s） |
| `npx vitest run` #1（無 `python` symlink） | **18 failed / 730 passed / 17 skipped**（765） | 91.388s（vitest 報 90.92s） |
| 新壓力測試（42 cases） | **42 passed** | 4.62s |

Baseline #1 的 18 個失敗**全部是 Linux 上跑 Windows-only 測試**，與本次新程式碼無關：

- `python` ENOENT：`calendarTamperGuard`、`dailyProgress`、`leadtimeDefaultDate`、`lineAttribution`、`nightlyChecks`
- `powershell.exe` ENOENT：`visualQa` 的 `extract-reel-frames` live canary

CI 跑在 `windows-latest`，那些案例在 CI 上應為綠。這台 Linux 環境不是產品回歸紅。

新壓力測試 5 次重跑：5/5 PASS，每次 5.00–5.07s，**無 flaky**。

全套件與聚焦套件的第 2–5 次見下方 Flakiness 表：數字每次相同，不是 flaky。

## Findings

編號越大不代表越嚴重。每條都寫 **SEVERITY / 觸發輸入 / 期望 / 實際 / 是否修**。

### F1 — HIGH — `validatePublishableImages` 接受 1-byte 非 PNG

- **輸入**：日曆兩槽都有檔，檔案是 `Buffer.from([0x00])`，`data/image-sources` 蓋了 `gpt-image-2` + topic。
- **期望**：發佈閘門拒絕「不是圖」的位元組。
- **實際**：`listMissingCalendarImages` 只擋 `size === 0`；有 stamp 就過。`validatePublishableImages` resolve。
- **證據**：`test/stressFailClosedGates.test.ts`「documents fail-open: a one-byte non-PNG…」
- **為何不修**：把「可發佈」從「有檔 + 有 stamp」改成「必須是合法 PNG/尺寸」是產品政策，不是測試修正。空檔已經 fail-closed；再往下加 magic/IHDR 應由 owner 決定最小寬高。

這是最糟的一條。Live Meta 路徑走這個函式。垃圾檔加上 stamp 就能通過「可發佈圖」閘門。

### F2 — HIGH — 公開頁寬高在讀不到 PNG 時填 1080×1350

- **輸入**：`docs/` 裡沒有對應 PNG，或檔頭不是 IHDR。
- **期望**：產站時拒絕，或至少不要寫假尺寸。
- **實際**：`src/generatePublicSite.ts` 的 `imagePixelSize()` 回落到 `POST_IMAGE_FALLBACK_SIZE = {1080,1350}` / `{1672,941}`。HTML `width`/`height` 與 schema 會帶這組數字。
- **對照**：MP4 duration 讀不到會省略欄位，註解寫「inventing a number would be worse」。圖片尺寸做了相反的事。
- **為何不修**：這是刻意 fallback（註解寫「source file is unavailable」）。改成 fail-closed 會讓 sparse checkout / 缺歷史圖的產站變紅，屬政策。

### F3 — MEDIUM — 損毀的 `ab-test-plan.json` 變成空計畫

- **輸入**：`{not-json` 或 `{"date":"2026-09-01"}`（非陣列）。
- **期望**：拒絕載入，或至少讓呼叫端知道計畫不可用。
- **實際**：`loadAbTestPlan` / `contentPlan.ts` 的 `loadAbTestPlanSync` catch 後回 `[]`。
- **證據**：`test/stressRotationAndVolume.test.ts`「documents fail-open: corrupt or non-array…」
- **為何不修**：缺檔在現況語意是「沒有 A/B 計畫」，不是錯誤。把 parse 失敗改成 throw 會改變沒有計畫時的降級路徑。

### F4 — MEDIUM — 本機沒有 `docs/knowledge` 或 `docs/scripts` 時，publish 仍成功

- **輸入**：最小 git repo，只有 `index.html` + sitemap + 當日 png，沒有 knowledge hub / analytics script。
- **期望**：PR #33 之後這兩個是必須鏡像的公開面，缺了應 fail-closed。
- **實際**：`existingPublishPaths()` 默默拿掉不存在的路徑，`publishPagesAssets` 成功。遠端舊 hub / 舊 script 會留著。
- **證據**：同檔「documents fail-open: missing knowledge/ or scripts/…」
- **為何不修**：現有 `publishPages` 測試夾具有的沒寫 knowledge。強制存在會改發佈契約。

### F5 — MEDIUM — `YYYY-MM-DD` 字串通過，日曆可以不存在

- **輸入**：`content_lastmod: "2026-02-29"`（2026 不是閏年），`today: "2026-03-01"`。
- **期望**：拒絕不可能的日期。
- **實際**：`LASTMOD_PATTERN = /^\d{4}-\d{2}-\d{2}$/`，沒有 `volatile-lastmod`。
- **證據**：同檔「documents fail-open: impossible calendar lastmods…」
- **為何不修**：加真實日曆驗證會連帶打到所有 lastmod/today 呼叫點，屬政策。

### F6 — MEDIUM — 空 catalog 通過驗證

- **輸入**：`validateIndexGrowthPages([], { today: "2026-09-03" })`。
- **期望**：至少要求一份 accepted 頁，或要求「不得低於現況 24 頁」。
- **實際**：`ok: true`，`resolveAcceptedIndexGrowthPages` 回 `[]`。有人清空 catalog 仍能產站（只剩 legacy 頁）。
- **為何不修**：最低頁數是產品數量政策，不是 gate bug。

### F7 — MEDIUM — 缺 `hub_group` 落到 `decisions`

- **輸入**：accepted 頁刪掉 `hub_group`，或未知 slug。
- **期望**：驗證失敗。
- **實際**：`hubGroupFor()` 回 `"decisions"`；validator 不檢查這個欄位。
- **為何不修**：fallback 讓舊頁不必標 group。改成必填會動 catalog 契約。

### F8 — MEDIUM — GA4 Data API `limit: 100` 且不分頁

- **輸入**：stub 攔截 `runReport` body。
- **期望**：來源列超過 100 時要分頁或 fail-closed，不能默默截斷。
- **實際**：request 固定 `limit: 100`，沒有 `pageToken`。超過 100 個 `customEvent:source` 會少算。
- **證據**：`test/stressSearchAnalytics.test.ts`
- **為何不修**：改 limit / 分頁是量測政策；目前 funnel 事件種類只有 9 個，事件名那一側還安全。風險在 per-source breakdown。

### F9 — MEDIUM — `ga4-report` CLI 預設日期用 UTC

- **輸入**：`2026-08-31T16:30:00.000Z`。
- **期望**：Asia/Taipei → `2026-09-01`。
- **實際**：`src/ga4Report.ts` `main()` 用 `new Date().toISOString().slice(0, 10)` → `2026-08-31`。
- **為何不修**：改 CLI 預設日期會讓既有排程對「哪一天」的假設位移。應單獨開修，不要夾在壓力測試 PR。

### F10 — LOW — `click_line_cta` 只看 pathname

- **輸入**：`//evil.example/go/line.html`（protocol-relative）。
- **期望**：只對本站 `/go/line.html` 送事件。
- **實際**：`new URL` 解出外國 origin，但 `pathname.endsWith("/go/line.html")` 仍成立。假 LINE 點擊會進漏斗。
- **為何不修**：這是量測誤計，不是發佈閘門。修的話要一併想相對路徑與自訂 domain。

### F11 — LOW — `generatePublicSite` 在 import 時用 `new Date()` 當 catalog today

- **輸入**：模組載入當下的牆鐘。
- **期望**：today 由呼叫端傳入，測試與產站可重現。
- **實際**：`resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: getZonedDateParts(new Date(), "Asia/Taipei").date })` 在 import 執行。Catalog lastmod 若「晚於載入日」會讓整個模組載入炸掉（fail-closed，方向對，但時鐘耦合）。
- **為何不修**：現況 catalog lastmod 是 2026-08-30，今天是 2026-09-03，不會炸。改成延遲解析會動所有 import 這個模組的測試。

### F12 — LOW — 相似度比對是 O(n²)

- **輸入**：120 筆 hostile accepted 列；另 80 段 diagnostic 兩兩 Jaccard。
- **實際**：120 筆驗證 3.5s 內結束且 **fail-closed**（沒有默默接受）；80×79/2 次比對 436ms，沒有丟 pair。
- **結論**：沒有爆記憶體、沒有靜默丟頁。若 catalog 長到數百頁，這段會先變慢，再來才是正確性問題。
- **為何不修**：目前 24 accepted 頁，不是現在的缺陷。

### F13 — LOW — 模組級 `pngSizeCache` / `activeDocsRoot`

- **輸入**：同一 process 並行跑兩個 `generatePublicSite`。
- **風險**：vitest 預設檔案平行，理論上會搶 cache。
- **實際**：新測試 5 次與聚焦套件都沒看到因此造成的 flaky。標成風險，不是已重現的 bug。
- **為何不修**：沒有失敗證據就改共用狀態，範圍太大。

## 守住的閘門

這些在對抗輸入下**有拒絕或正確降級**，不是 fail-open：

| 閘門 | 對抗輸入 | 結果 |
|---|---|---|
| `publish_state` | 缺欄、`ACCEPTED`、`published`、`" accepted"` | fail-closed |
| 重複 slug | 兩筆 accepted 同 slug | fail-closed，不投影 |
| provenance | 空 `source_refs` | `missing-source-refs` |
| validator today | 不傳 today | `volatile-lastmod` |
| 未來 lastmod | 2026-08-31 台北下午、lastmod 09-01 | 拒絕；跨過 16:00Z 後接受當天 |
| citation 長度 | 超長中文、emoji 以 code point 計 | 超長拒絕；emoji 不算 UTF-16 長度 |
| 敵對字串 | `\uFFFD`、`<script>`、`\0` | 不 throw，仍因其他欄位 fail-closed |
| sitemap | 缺檔、空白、未來 lastmod | 拒絕 |
| asset allowlist | `../.env`、`%2F`、`.svg`、反斜線 | 拒絕，不 decode 成安全路徑 |
| 2000+ 參照圖 | 2001 個 allowlisted png | 拒絕，不靜默丟 |
| 空圖檔 / 錯 source | `size===0` 或 source≠`gpt-image-2` | 拒絕 |
| 搜尋漏斗事件 | 刪 `click_service_from_answer`、掺 `line_click`/`generate_lead` | 拒絕 |
| GA4 缺設定 | 空 env | throw；ledger 寫 `unmeasured` 而不是 0 |
| 未知 GA4 事件 | `generate_lead` / `purchase` 列 | 不計入 totals |
| PR #34 過期 Reel | 日曆 `media_type=reel` 但沒有 mp4 | 公開 feed 變成 image，`video_url=""` |
| 中午輪替（08-27 起 14+ 天） | 已提交的 `data/ab-test-plan.json` | 開頭六天六種鞋；14 天內 noon concept 不重複；鞋段之後相鄰 noon 不同 object family |
| 100 日 `buildDailyContent` | 2026-07-11 起 100 天 | 不丟日期；任一 14 日窗 slot-1 topic 不重複 |
| 150 張參照圖 | 單 HTML 150 個 allowlisted src | 收集齊，不丟 |

## 輪替 14 天（實際檢查的不變量）

來源是 #15 / #17 寫進 `data/ab-test-plan.json` 的規則，不是口頭記憶：

1. **鞋打頭**：2026-08-27…09-01 的 noon 是六個不同鞋 concept。
2. **十四日不重播同一 noon concept**：從 08-27 起到計畫結尾，沒有碰撞。
3. **開頭鞋段之後，相鄰 noon 不得同 object family**：09-02 起沒有相鄰碰撞。
4. Playbook slot-1 跨 08-31 / 09-01：14 天 topic 互不重複。

`generateAbTestPlan(40)` 每天 noon≠evening。這條產生器**不會**重跑 #17 的「每三天一雙鞋」求解器；那份不變量只存在已提交的 JSON。

## 量壓

| 路徑 | 規模 | 結果 |
|---|---|---|
| `buildDailyContent` | 100 天 | 134ms 級，不丟、14 日窗不重複 |
| `validateIndexGrowthPages` | 120 hostile accepted | 3.5s，fail-closed |
| 3-gram Jaccard | 80×79/2 | 436ms，不丟 pair |
| `collectReferencedPublicAssetPaths` | 150 | 全數回收 |
| `publishPagesAssets` | 2001 參照圖 | fail-closed（預算 2000） |
| `generatePublicSite`（去 video） | 1 日核准 Reel、無 mp4 | 98ms 級完成，video 被剝掉 |

沒有 OOM，沒有靜默少頁。最接近「會痛」的是 catalog 相似度 O(n²)，見 F12。

## Flakiness

### 新壓力測試

| 次 | exit | 耗時 | 結果 |
|---|---|---|---|
| 1 | 0 | 5.065s | 42/42 |
| 2 | 0 | 5.001s | 42/42 |
| 3 | 0 | 5.043s | 42/42 |
| 4 | 0 | 5.031s | 42/42 |
| 5 | 0 | 5.052s | 42/42 |

無日期相依測試會在「今天」變紅：新案例的 today / now 都是固定字串或注入的 `Date`。  
`generatePublicSite` 模組 import 仍讀牆鐘（F11），但現況 catalog 不會因此紅。

依牆鐘或網路的**既有**測試：

- `publicSite` 的 checked-in metadata 案例讀 repo 檔，不打網。
- `publishPages` 的 git 案例是本機 git，不是遠端 API。
- `ga4Report` / `auditSitemap` live 分支出 stub `fetchImpl`。
- `visualQa` 抽幀案例要 `powershell.exe` + ffmpeg，Linux 上紅、Windows CI 上才有意義。

### 全套件

| 次 | 環境 | 結果 | 耗時 |
|---|---|---|---|
| 1 | 尚無新測試、無 `python` | 18 failed / 730 passed / 17 skipped（765） | 91.388s |
| 2 | 含 42 新案、`python`→python3 | 10 failed / 780 passed / 17 skipped（807） | 93.658s |
| 3 | 同上 | 10 / 780 / 17 | 96.682s |
| 4 | 同上 | 10 / 780 / 17 | 98.841s |
| 5 | 同上 | 10 / 780 / 17 | 106.341s |

第 2–5 次失敗集合完全相同，每次都是這 10 條 PowerShell 案例：

- `calendarTamperGuard`（1）
- `leadtimeDefaultDate`（5）
- `lineAttribution`（3）
- `visualQa` extract-reel-frames（1）

`python` symlink 讓 `nightlyChecks` / `dailyProgress` 從紅轉綠；剩下的要 `powershell.exe`。**不是 nondeterministic。**

### 新程式碼聚焦套件（indexGrowth / publishPages / ga4 / auditSitemap / publicSite）

| 次 | exit | 結果 | 耗時 |
|---|---|---|---|
| 1 | 0 | 88/88 | 93.839s |
| 2 | 0 | 88/88 | 93.244s |
| 3 | 0 | 88/88 | 97.039s |
| 4 | 0 | 88/88 | 91.980s |
| 5 | 0 | 88/88 | 102.258s |

5/5 綠，無 flaky。

## 選擇不修的總表

沒有任何產品 commit。理由：

1. **F1 / F2**：改「什麼算一張可發佈的圖」是政策。
2. **F3 / F4 / F6 / F7**：改缺檔／空 catalog／缺 group 的降級路徑，會動現有夾具與日常產線。
3. **F5 / F8 / F9 / F10**：日曆嚴格度、GA4 分頁、CLI 時區、事件 origin 都該獨立開修，不該塞進壓力測試 PR。
4. **F11–F13**：沒有造成這次紅燈的現場失敗。

建議 owner 下一步（不在這份 PR）：

1. `validatePublishableImages` 加 PNG IHDR + 非零寬高（修 F1）。
2. `imagePixelSize` 對已核准貼文改成「讀不到就 fail」，不要填 1080×1350（修 F2）。
3. `ga4-report` 預設日期改 `getZonedDateParts(..., "Asia/Taipei")`（修 F9）。
4. `existingPublishPaths` 對 `docs/knowledge` 與 `docs/scripts` 改必存在（修 F4）。

## 套件現況（寫報告時已跑過的）

- Typecheck：**綠**
- 新壓力測試：**綠**（42/42，5 次）
- 全套件在這台 Linux：**不是綠**（10 個 PowerShell ENOENT；加 python 前是 18）。不是這次新程式碼造成，也不是 flaky。
- 新程式碼聚焦 88 案：5/5 綠。
- CI（`windows-latest`）預期：既有套件 + 新 42 案應為綠，前提是 runner 有 git / ffmpeg / Windows PowerShell（workflow 已裝 ffmpeg）。
