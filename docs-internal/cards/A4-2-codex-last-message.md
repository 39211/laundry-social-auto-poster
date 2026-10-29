已完成 A4-2 本機實作與驗證，**沒有 git commit、連線店機或呼叫真正 LINE API**。修改限於指定範圍。

- `webhook_server.py`：集中替 stdout／stderr 每行加上本地 `YYYY-MM-DD HH:MM:SS` 時間戳，涵蓋分段輸出、多行與錯誤輸出。
- `tunnel_supervisor.py`：新增 `tunnel_events.jsonl`，記錄網址變更、PUT 前後及回應碼、GET 比對結果、退出 rc 與存活秒數。首次 PUT 後最多再試 3 次，間隔 **2／5／10 秒**。
- 新增兩個測試檔，共 **18 條 unittest 全綠**；在記憶體中移除重試後，兩條指定測試確實變紅。
- `python -c` 載入成功且未啟動 server；webhook 的 13 個業務函式 AST 與原版相同，`shop.json` 雜湊未變。四個 Python 檔通過 3.11 語法檢查；部署文件的七段 PowerShell 通過 5.1 語法解析。

交付文件：

- [A4-2-RESULT.md](<C:/Users/cyc39/Documents/New project 5/docs-internal/cards/A4-2-RESULT.md>)：diff 摘要、完整紅綠原始輸出、變異測試、檔案雜湊及限制。
- [DEPLOY-A4-2.md](<C:/Users/cyc39/Documents/New project 5/shop-pc/DEPLOY-A4-2.md>)：供總指揮在 **10:00–20:00** 執行的備份、停啟、部署、驗證與回退步驟。

實際 Python 3.11 執行及店機正式回讀仍待總指揮驗收。九格留痕缺口為 Vault 回寫：本次可寫範圍不含 Vault，完整紀錄已放在 RESULT。

另有環境殘留：首輪測試留下九個空暫存目錄；自動核准審查以「政策封鎖」拒絕清理命令，單一路徑的非遞迴刪除也遭存取拒絕，因此保留並列入 RESULT。它們不影響測試，但 `git status` 掃描時會出現權限警告。