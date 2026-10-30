# A9 r2 最終唯讀複審

2026-10-30；checker：本工作階段的 GPT strict-reviewer，task `a9_r2_review`。主代理將 checker 回覆落盤；checker 本身未寫檔、未另跑測試。這是同家族複審，不是跨家族確認。

## Verdict

**Cannot ship（正式啟用）；source candidate 未發現新增必修程式缺陷。** r2 第 14 項文件內容已完成，兩種 mutation 證據已補齊。r2 第 13 項原生全綠驗收尚未達成。

審查版本 `scripts/backfill-publish.ps1` SHA-256：`2e84240e0dc81a3c9c2007fca4c5b184f50ffd4bf833b08b0fba84e60b4f0c4e`。

## 最終核對

- RESULT 已移除 r1 的 43-case、七筆 pass、非原子 exclusive write 舊結論；r1 另存歷史快照。新版報告與實作、最終測試及日期命中欄位一致。
- 行為證據為 108 通過／0 失敗／1 BLOCKED，exit 2。唯一 BLOCKED 是 taskkill 整棵程序樹終止；沒有把程序自然退出冒充殺樹成功。
- 原生 smoke 在 File.Replace preflight 因 Access denied 而 BLOCKED／exit 2；原生 CIM 為 HRESULT 0x80041003。測試替身只改 temporary copy，正式腳本仍使用指定三參數 File.Replace。
- 日期 guard 變異：105 cases／47 failures，預期 exit 1。週 regex 變異：105 cases／2 failures，只有本週／這週紅燈，預期 exit 1。兩份證據均記錄正式 source SHA 前後相同。
- 三支 PS1 的 hash 與 r2-script-checks.json 相同，parser errors=0、non-ASCII bytes=0。seed 七筆 pending，runtime／舊 queue 均不存在，根 .gitignore 已恢復，git diff --check 通過。
- 每日 guard 與 claim 在同一 queue critical section；Stop-before-claim、Stop-during-attempt、skip／already-done 推進與完成時 claim 核對有保護。先前 taskkill stderr 跳過 -1、smoke wrapper 遺失 exit code、JSON array fixture 問題已修正。
- 已讀真 A7 簽名／回傳型別及下游 caption 傳遞；RESULT 有正確記錄。沒有取得正式共用 mutex 或執行發布。
- 驗證 helper 既有來源唯讀、固定 DryRun／不可執行 npm 名稱；僅寫本證據目錄與自建 UUID temp。清理前驗父目錄、前綴、symlink／junction，未見越界。

## 仍受阻的正式門檻

1. 原生 File.Replace、taskkill 殺樹及 ScheduledTasks CIM 的接受性尚未通過；必須在可執行原生 API 的環境補證，不能用 shim 代替。
2. 七筆真資料全部 skip，符合 r2 精確排除規則，但尚未具備七篇全補的業務條件。實測命中欄位是 local_image_path、carousel 內同名欄位、local_video_path、video_prompt、video_candidate.grok_motion_prompt、media_package.effective_date。規則／資料決定交總指揮與店主，本輪不放寬。

Checker 最後唯一文件收尾是本報告路徑尚未存在；主代理已保存本檔，並在交付前核對引用。沒有新增程式修正要求。完成此文件引用後，本輪程式與文件審查可收卷；正式註冊／啟用仍不放行。
