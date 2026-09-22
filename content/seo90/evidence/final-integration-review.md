結論：
- **Can ship（僅 root WebP 小接線的程式複審範圍）**，無新功能 blocker。正式整合須以主代理同版序列重跑固定 gate／兩原反例的新證據收斂；不授權公開。

版本與反向證據：
- ROOT-INTEGRATION-PATCH.diff 僅4個 hunk、generatePublicSite.ts 一檔。
- 四個 postimage hunk 逐行精確匹配；反向重建並恢復 R3 原 CRLF 後 SHA256 為 `711a3e4575885bd1cffc08ac04322e28cd7816b9eef37681c716dbb02c95af30`，與 OWNER-FREEZE-R3 完全一致。
- 本次 integration SHA：`ce2ea61c27f6afd8ed9b19e69071d731b93a4c7ac7d1ba9232cef833a3a089df`。其餘三個凍結來源與固定 gate 未變。

必修問題：
- 無新增確證問題。planWebpDerivatives 先實際產出 Buffer；context 只收非 null 的實際 planned absolute paths，不是預猜檔名。HTML 完成後，changes.push 使用同一份 webpChanges，再由既有 commitPublicTree 提交；沒有提早 write docs。
- 每次进入HTML建構前，setActiveDocsRoot 都清掉 pngSizeCache 與 plannedWebpPaths，再綁當次 docsRoot／計畫。規劃失敗會中止，不會提交依舊 context 建構的新頁面。並行呼叫不在已驗範圍。
- webpSrcFor 接受「現存衍生圖」或「同交易確有 bytes 的衍生圖」；未把已規劃描述成檔案已存在。PNG img fallback 保留。完整交易、rollback、祖先守衛均未改。

可選改善：
- 非阻擋：目前新增行有 LF、既有行為 CRLF。直接 git apply -R 因行尾差異失敗；本席保留該失敗，改用精確文字 hunk＋原CRLF重建，最後用凍結 SHA 驗證，未用模糊匹配冒充成功。

測試缺口：
- 本席未重跑任何 root suite、gate、原反例，沒有新增 probe。主代理報同版115/115及兩typecheck通過；並行清理的 EBUSY 是保留中的 HARNESS_ERROR，不能算通過，等待序列新證據。
- marker 自身不可寫、斷電、強殺、跨程序並行／惡意 TOCTOU仍未驗；不能宣稱所有故障均持久阻擋。

同類錯誤搜尋：
- Pattern：renderer 只讀舊磁碟、跨次 context 殘留、提前寫圖繞過交易。
- Searched：4個 hunk、planWebpDerivatives/context/HTML/commit 接線。
- Found：本次修正成立，無新增 blocker。
- Remaining risk：僅核此小diff，不外推全站／正式發布。

是否重犯 .Codex/mimo-lessons.md 內的舊錯：
- Yes（非功能阻擋）：CRLF/LF混用重現；已保存字節與精確SHA證據，未忽略行尾造成的首次反向失敗。

最終建議：
- 小接線可交付；由主代理完成已在進行的同版序列驗收，不再擴大架構或廣泛探測。
- 證據：independent-integration-evidence/preimage-proof-r3.json、重建R3原檔、先前反向失敗／退出碼均保留。
