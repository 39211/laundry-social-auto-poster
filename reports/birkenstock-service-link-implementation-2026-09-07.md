# 勃肯服務映射實作檢查

更新：後續已完成保留主圖修正、跨家族複審與單頁部署；最新結果見 `birkenstock-service-link-release-2026-09-07.md`。以下為部署前的歷史檢查紀錄。

狀態：LOCAL_TESTED / DEPLOYMENT_BLOCKED，未提交、推送或部署。

使用者同意只修改勃肯service映射、測試複審後部署。隔離分支codex/birkenstock-service-link-20260907，基底a0b4df23073e424b75682ccf1e34e2262ccf8bd1；工作目錄 C:/Users/cyc39/.codex/worktrees/sxj-birkenstock-link-20260907。主工作樹來源及既有dirty檔案未動。

## 改動

- src/generatePublicSite.ts：birkenstock-care service_slug white-shoe-cleaning → shoe-bag-care，一個屬性。
- test/publicSite.test.ts：更新該映射預期，新增data-parent-service精準href與鞋包清潔文案斷言。

## 證據

- 初跑因隔離目錄缺PUBLIC_SITE_BASE_URL無法載入測試；只提供公開網站/圖片base URL後可執行，沒有複製憑證。
- 舊測試35/36，唯一失敗為勃肯舊服務預期。
- 更新測試後focused通過；把映射突變回white-shoe-cleaning，於birkenstock-care service link斷言失敗。精確恢復新映射後36/36通過。
- tsc --noEmit退出0；git diff --check通過（有LF/CRLF提示）。
- GPT唯讀規格審指出派生影響，非跨家族簽核。

## 未通過發布門檻

service_slug不是純粹的單連結欄位。生成器亦依它選擇hero次要服務按鈕、兩個服務頁的反向指南清單、services JSON，並在supportPageImage無命中文章圖片時決定fallback圖。尚未完成同一輸入的完整生成前後diff，因此不能保證只有使用者同意的映射入口改變；更不能全量發布其他人的工作。

Grok派工器在bundled PowerShell自我檢查缺powershell.exe而拒絕；改用正常系統PowerShell仍被ExecutionPolicy拒絕。沒有改政策、繞過安全啟動器或冒稱Grok已實作。改由主代理處理低風險一行候選，GPT規格審不能取代跨家族複審，因此部署仍blocked。

下一步：恢復正式外部複審通道，完成渲染差異檢查；若需修改渲染器以固定圖片/其他內容，需擴充原先「僅映射」範圍。通過後以精確檔案集部署並讀回hash，再設定Day0。當前沒有新增Google收錄或曝光的證據。
