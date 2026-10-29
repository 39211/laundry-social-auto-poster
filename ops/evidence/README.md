# A5 演練證據

最終判定以 `final-pester.txt`（28／28，exit 0）與 `final-independent-readback.json`（Python SHA／大小重讀 PASS）為準；兩份 `final-*-MANIFEST.json` 是該次合成演練的原樣資料副本，不含真憑證或正式客戶資料。

所有 `.txt` 是 Windows PowerShell 原始標準輸出／錯誤流合併後的 UTF-16LE 檔案。讀取方式：

```powershell
Get-Content -LiteralPath 'ops/evidence/final-pester.txt' -Encoding Unicode
```

帶 `red`、`before` 或 `iteration` 的檔案保留先前失敗／修正中的證據，不能用舊綠燈取代最終版本。`before-enum-fix-pester.txt` 的 27／27 曾未抓到錯誤的 SYSTEM enum，後由獨立 metadata 核對與 `register-enum-red.txt` 揭露；`retention-name-reuse-red.txt` 的 27／28 揭露被清理目錄名重用。兩者均已修正，且最終固定時鐘完整測試通過。

重新驗證（檔案演練只在本 worktree 的 `ops/_tmp/`，真排程 API 被 mock）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'ops/test-recovery.ps1'
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -X utf8 'ops/verify-drill-manifests.py' --transcript 'ops/evidence/final-pester.txt' --out 'ops/evidence/final-independent-readback.json'
```

第二行只驗 `final-pester.txt` 指向的該次演練；若要驗新的一輪，先把新一輪完整輸出保存成對應 transcript，再傳給 `--transcript`，避免把不同輪證據混用。合成流程成功不能證明正式 30 分鐘 RTO 或原生 Windows 排程器成功；詳見 A5-RESULT 的未驗證項。
