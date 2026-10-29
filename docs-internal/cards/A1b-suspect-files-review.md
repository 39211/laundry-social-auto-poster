# 任務卡 A1-b(唯讀):五個 SUSPECT 半成品檔該收、該補、還是該丟

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 本卡唯讀
工作目錄:C:\Users\cyc39\AI-Lanes\integ\repo(integration/20261030)
只能新增 `docs-internal/cards/A1b-RESULT.md`。不改程式、不 commit。

## 背景
A1 收斂時(`docs-internal/cards/A1-RESULT.md` 步驟 2 的 SUSPECT 節)有 5 個未追蹤檔被判半成品,留在現役工作樹沒進 git:
1. `scripts/reel-v3/run_manifests.ps1` — 失敗仍 exit 0
2. `test/agyImageFallback.test.ts` — 測的 helper 正式腳本裡沒有
3. `test/ps-agy-aspect.smoke.ps1` — 同上
4. `test/ps-youtube-live-reel.smoke.ps1` — youtube-upload.ps1 沒有被測的兩個 helper
5. `test/youtubeUpload.test.ts` — 同上
現役工作樹在 `C:\Users\cyc39\Documents\New project 5`(只讀那五個檔與相關正式腳本;不要在那裡改任何東西)。

## 要回答(每檔一節)
- 這個檔想做什麼?誰可能寫的(看 git log 相鄰檔案、Vault `04-Tasks`/`06-Handoffs` 搜 agy、youtube live reel、run_manifests)?
- 對應的正式功能現在是什麼狀態(例:YouTube live Reel 上傳現在走哪段程式;AGY 4:5 fallback 正式有沒有實作)?
- 三選一建議:(a) 補完正式 helper 讓測試成立(估幾行、風險);(b) 原樣入 git 當「待辦測試」並在檔頭註明;(c) 搬到 `D:\AI-Lanes-work\_archive\suspect-20261030\` 不入 git。附理由。
- 與 10/26–10/29 發文中斷、YouTube W43「排程 7 實發 0」有沒有關係?(讀 `scripts/youtube-upload.ps1`、`data/youtube-log/`、`data/scheduled-log/` 的 YT 欄位,說清楚 scheduled 與 youtube-log 的口徑差異,B3 週報的 YT 欄位是不是算錯)

## 交付
`docs-internal/cards/A1b-RESULT.md`:五檔表格 + YT 口徑結論 + 建議總指揮下一步。
