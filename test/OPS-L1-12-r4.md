# OPS-L1-12 r4 — producer 修正候選

本席是背景實作席；總指揮與一般使用者驗收為主幹 Claude。只修改此 worktree 的 producer、測試 runner、golden harness 與驗證文件。沒有修改 bot 對客邏輯、golden 基準、排程、正式資料或帳號。

## 基線與交付範圍

- 現役參照：`release/sxj-live-2026-10 = c73dd87a00d2463101d6d8b3dd0c12ee94d33367`。
- 已嘗試 `git merge -X theirs release/sxj-live-2026-10`，沙盒拒絕共用 `.git/worktrees/l1check/ORIG_HEAD.lock`；**不是已 merge**。HEAD 仍是 `9819269c`。
- 為讓實測確實使用現役程式，將 HEAD 至現役差異的 15 個來源檔，用 `git show` 讀出現役內容後同步至本 worktree。這些是基線同步，不能當成本卡新實作。原有未追蹤 `reports/level1-gates.md` 保留。
- 本卡只交以下六檔：`scripts/level1_offline_checks.py`、`line-bot/run_a2b_tests.py`、`tests/golden/run_golden.py`、`test/test_level1_r4.py`、`test/ops_l1_12_r4_mutations.py`、本文件。
- 收件 patch 相對 c73dd87a 產生，避免把基線同步再交一次；主幹應先完成真正 merge，再套本卡六檔。不要把此工作樹所有 dirty 檔一併 stage。
- `git add` 六檔亦被共用 `.git/worktrees/l1check/index.lock` 權限拒絕，沒有 commit。訊息（含既有尾兩行）存 `output/operations/OPS-L1-12-r4-COMMIT-MESSAGE.txt`；patch 為 `output/operations/OPS-L1-12-r4.patch`。

## 原因與修改

1. 現役 A2b runner 的 `main` 會另開 `--worker`；舊 producer 的 audit hook 拒絕所有 `subprocess.Popen`，因此測試尚未開始便退出。runner 新增可注入的 `launch_worker`，預設呼叫方式保持相同。producer 只核准一次精確的 Python、runner、module、擁有者 temp marker、cwd 與 env 組合；實際 command 再經 snapshot 中的 producer `--child`。worker 重新安裝未授權任何子程序的 guard。正式路徑、隔離工作區以外的寫入與網路仍受阻擋。worker timeout 先收掉 worker，再由父程序清理自己的 temp。
2. Python 3.14 實查有 tzdata，`ZoneInfo('Asia/Taipei')` 成功；固定 golden 的 `harness.zoneinfo_asia_taipei=false` 只是錄製時環境能力。只排除該欄位，不排除整個 harness。原先時間戳以原字串編號，台北 naive 與 `+08:00` 會得到不同 TS ID；現在先按 frozen Taipei clock 轉成相同時間點，保留不同時間及重用關係。分鐘精度字串保留實際分鐘文字，不擴大遮罩範圍；次微秒差異亦保留。
3. 與主幹 `verify_linebot_full.py` 對照後發現標準 Python 沒有 Flask；原 producer 退回的 shim 不支援 handoff 的 `post(json=...)`。只在 A2b 且 Flask 未安裝於目前 interpreter 時，使用主幹既有 `C:/Users/cyc39/AppData/Local/hermes/jarvis-memory/venv/Lib/site-packages` 作唯讀 fallback，沒有安裝套件。
4. `--smoke` 只跑兩個 copy audit 模組、handoff 與 `test_bulky_days_1106`。總執行預算 25 秒，預留收尾時間。輸出獨立 `level1-smoke-<date>.json`／`level1-offline-smoke/v1`，不覆蓋每日全套證據，也不能通過原 daily loader。未跑 golden 明列 no_data；三組任一未過則 CLI exit 1。

## 驗證與限制

- 新測試先在舊 producer 重現紅燈；修後實際建立父子程序驗證允許固定 runner、拒絕任意 subprocess、拒絕外部寫入與網路、timeout 後清理。
- 完整既有離線回歸加 r4 測試：153 案；golden harness 原測試 8 案另跑。原始紀錄：`output/operations/ops-l1-12-r4-regressions.txt`、`ops-l1-12-r4-golden-tests.txt`。
- 三個破壞版本各自在獨立複本執行：全部阻擋子程序、全部允許子程序、移除內容比對。要求指定 assertion 紅、不得靠測試 ERROR 充數；候選與還原 SHA 核對。最後候選證據：`output/operations/ops-l1-12-r4-mutations-32e6781355b94c3c980dec706393122a/proof.json`，baseline／還原各 10 案 pass、3 mutants 全紅。
- 真 smoke：5.475 秒，copy audit 11 案、handoff 2 案、小模組 7 案全部 pass。證據：`output/operations/ops-l1-12-r4-smoke-final/output/operations/level1-smoke-2026-11-08.json`。此為沙盒耗時，不冒充一般使用者量測。
- 完整 producer：177.255 秒，57 模組／881 案；40 模組 pass、13 fail、4 no_data。copy audit 與 handoff pass。receipt：`output/operations/ops-l1-12-r4-final/output/operations/level1-checks-2026-11-08.json`。這輪 snapshot 的 golden harness 在最後補「分鐘精度」修正之前；final harness 另以全部 85 案、兩次環境能力對照及原 harness 測試核對。
- **golden 保持 fail**：全部 85 案在真有 tzdata 與模擬無 zoneinfo 兩種環境，除能力欄位外 transcript 完全一致；與固定基準只差 2 個收送案例的照片提醒。`pickup-full-booking-location` 第 6 輪、`pickup-typed-address` 第 7 輪多出「方便的話，接著傳衣物照片，店員比較好安排。」這是真文案差異，不改基準、不刪案例。證據：`output/operations/ops-l1-12-r4-timezone/proof.json`、`content-differences.json`、`with.json`、`without.json`。
- 全套剩餘紅燈分開看：7 模組遇到任意子程序／loopback／production guard 契約；`test_staff_html` 缺 snapshot `staff.html`，`test_photo_roster_guard` 缺 `shop-pc/fxwash/config/Memory.md` 並有其他斷言；`test_estimate`、`test_journey_ux`、`test_photo_plain_bag_guard`、`test_photo_view_guard` 有待釐清的斷言。另 2 模組有 4 個 skip、2 模組為零案例。沒有移除這些模組、放行任意 subprocess 或宣稱 bot 壞掉；也沒有把所有失敗歸因沙盒。
- **已證實的沙盒限制**是共用 `.git`、D:、Vault 寫入不在可寫範圍；本席使用 worktree 內小型合成測試區，未生產媒體或大型資料。沒有一般使用者重跑證據。Vault task_summary 待主幹回存，本文件即本席持久交接。

## 主幹一般身分驗證

在完成真正 merge／套用候選後，於現役 repo 執行：

```powershell
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -B -X utf8 scripts/level1_offline_checks.py --root 'C:/Users/cyc39/laundry-repo' --out-root 'C:/Users/cyc39/laundry-repo' --work-root 'D:/AI-Lanes-work/level1-offline-checks' --smoke
```

讀回 `output/operations/level1-smoke-<date>.json` 的三組結果與 elapsed_seconds；一般身分的全套結果仍須另外驗收。日常不帶 `--smoke` 的既有排程保持不變。真實 golden 文案差異交主幹核對原本對客變更決策，不能由本席自動重新 record。

本次未做外部派工或獨立複審，未寫 Vault、未 push、未部署。
