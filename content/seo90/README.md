# SEO90：私有預覽與發布驗證候選

本切片已做到來源格式、核准／資產／日期防線、完整文章與日更索引 renderer、第一批真素材 preview。**GO_PREVIEW_ONLY；HOLD_PUBLIC**。W5 已在隔離分支接原 `generatePublicSite.ts`，預設 `public-ready.json` 為空；官網未部署、正式 release writer 尚缺，不得宣稱私享家 `/daily/` 已上線。

架構：[PLAN-30-60-90.md](PLAN-30-60-90.md)。逐日內容：[roadmap-90-days.json](roadmap-90-days.json)。90 筆是規劃，其中只有 6 篇已有私有短版預覽稿（512–565字，未達900中文字元母文門檻）與 24 圖；其餘 84 篇維持 brief。

## 重現

在此 repo 根目錄，以 PowerShell 執行：

```powershell
npm.cmd ci --ignore-scripts
$env:PUBLIC_SITE_BASE_URL='https://sixiangjialaundry.com'
npm.cmd run typecheck
npx.cmd vitest run test/seo90.test.ts test/seo90Integration.test.ts test/publicSite.test.ts test/auditSitemap.test.ts
npx.cmd tsx scripts/seo90-preview.ts PRIVATE_BUNDLE_JSON ASSET_ROOT EMPTY_OUTPUT_ROOT
```

`PRIVATE_BUNDLE_JSON` 需符合 `src/seo90/types.ts` 的 Bundle；輸出目錄必須空白且實際位置不得在 `docs`，包括 Windows junction 別名。PNG 使用 pngjs 完整 decode 與 CRC 檢查；四張圖必須是不同像素內容。

本輪真資料預覽的輸入與輸出留在這個 worktree 外，Obsidian 也有六篇母稿。資料格式測試使用自建暫存合成素材，不讀真店資料、不呼叫社群 API。

## 核准不只是圖片 checksum

網站核准同時綁定：文章完整內容、門市 registry、圖片 bytes SHA 與完整 asset manifest（含 caption／alt／尺寸／provider／path）。規劃日期、CTA、品牌或圖說變動都必須重新核准。社群核准不會轉成網站核准。

`public` 是 renderer 的離線 dry-run 模式，只接受匹配的 website approval 與既存 release journal。**這個套件沒有建立真 release 的權限來源或部署流程**；測試 fixture 的 published 不是真實上線證據。後續由正式整合契約建立並驗證。

## 本輪已確認限制

- PNG 為本切片唯一圖片格式；未宣稱 JPEG/WebP 或影片可直接導入。
- HTML 完整度與字數下限只是機械檢查；素材吸引力、文案適切性與老闆核稿仍分開。
- 影片審查欄位只是 gate，不構成音訊／美術已核准的證據。
- 第二店只有合成身份／品牌拒絕與替換測試，沒有真客戶交機驗收。
- 未來／私有稿不進 `docs`；無核准的店家設定與服務保持阻擋。
- 每次 build 產生新目錄，不接受混寫舊輸出，避免撤回內容殘留。

## 正式接線限制

只有 `content/seo90/public-ready.json` 可以進原 generator；目前為空。公開來源須完整核准與 release，不能由 Obsidian 或社群記錄自動提升權限。未完成網站核准的正文、hold 原因與私有來源不進 docs。

本版只驗證零公開接線與單次合成核准路徑。現有文章路徑 collision、重跑，以及來源移除時的 release reconciliation 會阻擋並保留既有文章；可信 release writer、可重跑／更新／撤稿是下一切片，尚未交付正式每日自動發布。
