# SEO90 下一版 release 獨立驗收

這個入口實際呼叫既有 `generatePublicSite`，每組使用新的 Windows tempdir 與合成核准資料。它不會修改此 repo 的 `docs/`、真六稿、正式核准紀錄或社群發布紀錄。會讀取 repo 的公開 business-profile 作為建立網站的設定。

在 repo 根執行（需已安裝專案依賴）：

```powershell
./node_modules/.bin/tsx.cmd acceptance/seo90ReleaseGate.ts --report release-owner-review-01.json
./node_modules/.bin/tsc.cmd --noEmit -p acceptance/tsconfig.json
```

報告写到隔離 worktree 上一層 `evidence/`。既有報告不可覆寫，重跑請用新的檔名。完整 stdout/stderr 也應保存，並保留實際退出碼。

退出碼：0＝這六項契約過；1＝產品還缺功能；2＝驗收程式/前置條件出錯。它刻意不混入預設單元測試，避免把未完成的下一版需求假裝成當前版本的回歸缺陷。97項既有測試通過，仍不能推論這六項已過。

| 契約 | 要驗的實際輸出 |
|---|---|
| R0 初次核准發布 | 文章、daily連結、sitemap、四圖都存在；無關檔案完整 |
| R1 同版重跑 | 不拋錯，整個公開樹bytes不變 |
| R2 已核准更新 | 同網址文章、daily、服務頁反映新內容；Article與sitemap修改日期正確、原始發布日期保留；無關檔案完整 |
| R3 撤回自有發布 | 第二篇核准文章及其四圖、daily/服務頁連結、非目標sitemap網址與服務核心內容保留；第一篇與獨有圖片及引用移除 |
| R4 未再核准的改稿 | 既有公開樹bytes保持；拒絕新稿不應破壞已公開版本 |
| R5 撤回最後一篇 | 自有文章/圖/daily索引移除，其他sitemap網址與服務核心保留；頁面不留下失效daily導覽 |

初次核准、更新及不合格改稿先經既有 eligibility 正反驗證，不能用本來就不合格的 fixture 製造假失敗。合成時鐘固定為2026-09-26，絕不表示現實中的未來稿已獲准。報告含被驗來源SHA與實際執行時間。

目前基線：2/6，R0、R4過；R1/R2/R3因既有碰撞守衛拒絕，R5因缺少release reconciliation而拒絕。R3是撤回兩篇中的一篇，R5是撤回最後一篇，兩種邊界都要完成。這表示防線有保住舊公開樹，還不能交付重跑/更新/撤回功能。禁止只移除守衛讓測試綠；下一版需有可核對的自有產物與版本狀態，再安全更新/撤回。

不涵蓋：斷電復原、同時兩位writer、跨文章共享圖片、正式部署及真核准。六項全過也只叫`GO_CONTRACT_ONLY`，不能宣稱可賣、Google/AI收錄或正式發布已驗。

清理前核對每個tempdir的實際絕對位置與本次所有權；預期報告`remainingTempRoots=0`。所有網路fetch被拒，API_KEY環境變數不帶入generator。

獨立複審在 [evidence/release-contract-independent-review.md](evidence/release-contract-independent-review.md)。[原始證據 ZIP](evidence/release-contract-independent-20260922.zip) 保留舊版假綠、修正過程、最新正反注入、stdout/stderr 與退出碼；解壓後看 INDEX.md。注入腳本含此機證據路徑，移機須調整測試入口，不能當作已驗可攜工具。標準 gate 本身使用本次 repo 與新的 tempdir。

`CONTRACT-SHA256.json` 固定本批驗收輸入與證據；hash 只證完整性，不是簽章。下一位實作者依 [NEXT-WRITER-CONTRACT.md](NEXT-WRITER-CONTRACT.md) 在新候選實作，不修改本目錄；由另一位審查者驗收新報告。
