**A7 本地修補已完成，只變更 6 個白名單檔案。** 未 commit、未真發布、未註冊排程、未寫入現役，也未實際發 LINE。

完整差異、紅綠原始輸出、事故判讀與部署／回復步驟都在 [A7-RESULT.md](C:/Users/cyc39/AI-Lanes/a7/repo/docs-internal/cards/A7-RESULT.md)。

完成內容：

- **共用鎖與舊 git 鎖清理**：新增 `_pipeline-lock.ps1`。符合「超過 10 分鐘、沒有相關 git 命令列」才移除 `index.lock`，記錄 mtime；程序資料查不到或鎖很新時保留。共用 Mutex 最多等待 600 秒，逾時記錄並退出 **75**。
- **保護產站到發文的整段流程**：catchup、daily 共用同一把鎖並以 `finally` 釋放，包含 daily 間接產站的分支。catchup 產站／推站失敗會退出 **2**，停止後續發文。
- **告警與每日去重**：4 小時到期仍缺 FB／IG 成功紀錄，或 `publish-pages` 連敗兩輪時告警。計數涵蓋跨午夜及停機日，成功才歸零；同日同原因最多嘗試一次。介面不可用時保存狀態並降級 toast。

**驗證結果：新 smoke 36／36 通過，既有哨兵 smoke 66／66 通過。** 5 支 PowerShell 的 Parser、UTF-8 BOM 與 `git diff --check` 均通過。同家族唯讀複審依 [requesting-code-review 技能](C:/Users/cyc39/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/skills/requesting-code-review/SKILL.md) 完成，提出的跨日計數問題已修；目前無未解的卡內實作阻擋項。

哨兵原本會檢查缺格、啟動補發並嘗試桌面 toast，**沒有 LINE 告警或收訊回執**；無法只靠程式證明四天中的通知是否顯示或被看到。它與 `_watchdog.ps1` 沒有直接產站／推站，因此依卡片條件維持原檔。

部署前有兩個實際限制，RESULT 已寫清楚：daily 既有的自動 stash 可能收走直接複製的未提交腳本；卡外的 Reel／YouTube 產站入口仍未加入共用鎖。**本次交付的是已驗證候選版，尚未宣稱現役修復。** 指定事故 log 的 SHA-256 前後一致。

九格缺口：依本次「只改卡列檔」限制，未另外寫 Vault；完整留痕保存在 RESULT。

額外補齊舊 catch-up smoke 的 Temp 依賴時，工具自動政策拒絕執行，只回報 `blocked by policy`，未提供細因。因此那套舊 smoke 未列為通過；相關行為由新增隔離測試驗證，缺口已記錄。

