# dot SEO 修補驗證（2026-11-10）

## 執行環境與範圍

Linux 雲端隔離 worktree，Node 24.22.1。base release/sxj-live-2026-10 = f6a3c83042cab52a14bf3bb0d011f2d564b1b561。未改主分支、排程、正式網站或社群。

測試以空白環境執行，只提供 PATH、HOME=/tmp、PUBLIC_SITE_BASE_URL=https://example.invalid、PUBLIC_IMAGE_BASE_URL=https://example.invalid、DRY_RUN=true。repo 的標準 CI 是 Windows / Node 22，所以本機全套不能替代 exact-head CI。

## 已通過

- TypeScript `node node_modules/typescript/bin/tsc --noEmit`：exit 0。
- 新主題規則 24/24、真實 30 篇文章 render + 外套錯誤關鍵字負例 31/31、首頁日期 helper 18/18，合計 73/73。
- generator 整合新增 2/2：首頁/schema/sitemap 同日期且翌日重建不變；editorial 欄位不改原始已核准 social source。
- 30 篇實際 HTML 生成：30/30 維持 index,follow；最短 1,629 可見字。原 1,200 字門檻未改。
- Red/green：只將原基底 generator 加上測試所需 export，再跑同一 31 項 render 測試，31 failed / 0 passed；最終候選 31 passed。
- `git diff --check`：通過。
- 獨立只讀 code review：先提出 schema 更新日期與 public editorial surface 殘留舊標題兩項問題；均修正後再審，沒有剩餘 Critical/Important finding。reviewer 獨立重跑 49 項日期與 render 測試全數通過。

## 實跑完整 Vitest，不是全套綠燈

命令：`node node_modules/vitest/vitest.mjs run --maxWorkers=2 --no-color --reporter=json`。

- 基底：2,041 total，1,945 passed，43 failed，53 pending/skipped，exit 1。
- 最終候選：2,116 total，2,020 passed，43 failed，53 pending/skipped，exit 1。
- 兩者失敗名稱集合完全相同；新增 75 項全部通過。這證明未新增失敗名稱，不把每個既有失敗的根因一概歸咎作業系統。
- 觀察包含 PowerShell/Windows 相依、tsx IPC socket EPERM、外部 fetch 失敗、既有公開資料 fixture 漂移等；未刪測試、未提高 timeout、未放寬索引閘門。
- 舊固定 render SHA 測試因授權的文章重寫而精準重釘，仍驗整份 HTML；舊版 SHA f0e6d5130aa03c57f3d4ffa3bbec8c560cb9a97b6d692f0dba28aa2aef911f9c，新版 SHA 8a4bf665869a5148aae64f9ec3fdb011cbe493fc9a0073c0be9288ed6859c316。其他 publication-link 測試保留。

### 基底與候選共同失敗的測試

- AEO325 final page copy updates lastmod for managed target URLs without pinning sitemap URL sets
- approvePost fingerprints T8 non-forced approval reaches the publish fetch
- tamper rebuild path CLI --inspect-calendar exits 2 and prints shouldRebuild for a forged calendar
- daily generation planned object PowerShell 5.1 resolves the production lookup for 2026-10-08
- daily generation planned object PowerShell 5.1 resolves the production lookup for 2026-10-23
- daily generation planned object PowerShell 5.1 resolves the production lookup for 2026-11-06
- daily generation planned object keeps the old plan ahead of an overlapping extension row
- daily generation planned object returns empty when the extension is missing
- daily generation planned object returns empty when the extension is malformed
- daily generation planned object returns empty when both plan reads fail
- image route is GPT Codex only R5 Get-LaundryCodexModel defaults, honors override, and trims blank
- W-LEADTIME D+3 generation default daily-generate defaults to Taipei now+3 and honors -Date
- W-LEADTIME D+3 generation default reverting daily-generate default to today yields today, proving AddDays(3) is the discriminator
- W-LEADTIME D+3 generation default produce-next-reel defaults to now+3 and honors -Date
- W-LEADTIME D+3 generation default reverting produce-next-reel default to today still honors -Date, proving AddDays(3) is the discriminator
- W-LEADTIME D+3 generation default approve / catchup / sentinel still target today, not D+3
- W-LEADTIME D+3 generation default changed PowerShell scripts still parse
- catch-up public-site repush failure stays in-section fragment: failed flag still posts then exits 2
- catch-up public-site repush failure stays in-section fragment: clear flag exits 0
- line-attribution-report.ps1 rolls fixture CSV into link_source x count x wow
- line-attribution-report.ps1 prints the no-data tutorial and does not fail when exports are missing
- line-attribution-report.ps1 mutation 3: a misaligned CSV (no link_source / Event count) fails
- R3 media guard CLI returns exit 3 and writes the lock message to stderr for a locked slot
- R3 media guard CLI returns exit 0 and MEDIA_GUARD ok for an unlocked slot
- R3 media guard CLI accepts the explicit CLI override only when its reason is present
- R3 media guard CLI accepts MEDIA_GUARD_OVERRIDE_REASON for PowerShell callers
- R3 media guard CLI treats --force-regen-scheduled without --reason as no override
- REGENGUARD-R2 restore and heal F1 --restore passes the explicit override and audits the restore operation
- REGENGUARD-R2 restore and heal F3 --heal keeps exit 0 and repairs the next plan half after a media-locked stop
- REGENGUARD-R2 restore and heal R3 --heal override requires --slot before either plan half changes
- REGENGUARD-R2 restore and heal R4 M7 environment override requires --slot before either plan half changes
- REGENGUARD-R2 restore and heal R4 M8 legacy slot 3 heal is a no-op for a scheduled Reel date without an A/B plan
- REGENGUARD-R2 restore and heal R3 --heal override with --slot 2 leaves slot 3 bytes, calendar row and audit untouched
- REGENGUARD-R2 restore and heal R3 heal rethrows a missing sidecar instead of reporting media-locked
- REGENGUARD-R2 PowerShell root and missing videos R3 'generate-missing-images.ps1' passes the spaced fake root to media-guard under a failing npm.cmd
- REGENGUARD-R2 PowerShell root and missing videos R3 'regenerate-boutique-images.ps1' passes the spaced fake root to media-guard under a failing npm.cmd
- REGENGUARD-R2 shared override parser and plan scope R6 mediaGuardCli accepts a whitespace USERNAME as unknown
- REGENGUARD-R2 shared override parser and plan scope R6 --plan never forwards the 'explicit flag' override into its multi-date schedule
- REGENGUARD-R2 shared override parser and plan scope R6 --plan never forwards the 'environment' override into its multi-date schedule
- reelSubtitlesCli end to end writes a portrait ASS file from a narration file and real durations
- generatePublicSite keeps checked-in public feeds, calendars, HTML, and image metadata consistent
- seo overrides and URL path normalization seo override files should be byte-identical after generation
- carousel CLI surface visualQaCli accepts --carousel emit-prompt for a file list

## 未完成／限制

- Chromium 手機 screenshot 曾實際啟動；一般權限與一次允許的 sandbox escalation 都因 socket EPERM 中止。沒有手機視覺驗收、Lighthouse、INP、LCP 或 CLS 通過證據。
- 尚未部署，未驗證正式站改版後的 CDN/HTML。不得稱線上已改善。
- GSC 搜尋效能及 Google 索引狀態沒有可用證據，不保證排名／CTR 改善。
- GitHub exact-head CI 在 PR 建立後另行查驗，任何 pending/skipped 都不算 passed。
