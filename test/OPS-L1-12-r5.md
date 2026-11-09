# OPS-L1-12 r5 — archive HEAD + 原生 runner 逐模組執行

本卡 outcome：夜間離線 producer 只驗已提交 HEAD，直接使用 repo 原生隔離 runner、逐模組依序執行，以案例數與 exit code 產生可追溯收據。owner／checker：主幹 Claude；maker：背景 Codex。授權限本 worktree 的 producer、兩個 golden 期望值、必要測試與交接。一般身分全量驗收由主幹執行。

## 變更

- 基底 `42243ffdfe343303657280056ab58c4782154d8b`，分支 `fix/l1-offline-r4-1108`；未變更現役、排程或 bot 對客程式。
- producer 先固定 `HEAD^{commit}`，`git archive` 匯出 `line-bot`、`data`、`shop-pc/fxwash/config/Memory.md`、`tests/golden`。前三項與 `verify_linebot_full.py` 相同；後一項讓 golden 也驗同一 commit。收據記錄 `source_head`、快照檔案 SHA-256 與實際 log 路徑。未提交的 tracked 修改、untracked 檔不納入。
- LINE 模組呼叫 `python -B -X utf8 <snapshot>/line-bot/run_a2b_tests.py <module basename>`，cwd 為快照 `line-bot`；`PYTHONPATH` 包含快照 `line-bot`、`line-bot/tests` 與既有 Hermes site-packages；`LAUNDRY_AI_CHAT=off`。所有模組串行，copy_audit 的兩模組只執行一次，handoff 共用同一列結果。
- 移除 producer 的全域 audit hook、`--child`、worker callback 包裝。保留原生 runner 與 golden 自己的隔離；未修改 `line-bot/run_a2b_tests.py`、`tests/golden/run_golden.py`。
- exit 非 0 一律 `fail`；exit 0 且有實際執行案例才 `pass`；0 案例、只有 skip、逾時／無法啟動為 `no_data`。部分 skip 但確實有其他案例執行可 pass，仍列出 skipped 數。失敗名放 `failed_tests`；程序尚未進案例而崩潰時保留模組名、exit code 與 log，不虛構測試名稱。
- 每模組上限 90 秒、golden 300 秒，整體測試預算 780 秒，替 Day-Audit 的 900 秒上限保留 120 秒（另有最長約 10 秒的逾時清理餘裕）。預算耗盡的剩餘模組記 `no_data`。這是預算設定，尚未等於全量耗時驗收。
- 逾時只對本次 Popen PID 及其子樹執行 `taskkill /PID ... /T /F`。若清理無法確認，停止後續模組並記 `ProcessTreeCleanupFailed`，避免下一模組與殘留程序同跑；不按程序名稱批次終止。
- producer 的工作區必須在 source／output／正式資料夾之外；不接受重新導向的收據路徑。正式樹只允許寫 `output/operations/level1-checks-<date>.json`；既有 smoke 仍獨立寫 `level1-smoke-<date>.json`。archive、manifest 的來源、測試與 log 均在 D: 工作區。

## Golden 變更證明

只有 `tests/golden/linebot.golden.json` 兩個字串增加換行及「方便的話，接著傳衣物照片，店員比較好安排。」：

- `pickup-full-booking-location` 第 6 輪：`$.cases[17].turns[5].output.messages[0].text`。
- `pickup-typed-address` 第 7 輪：`$.cases[19].turns[6].output.messages[0].text`。

`output/operations/ops-l1-12-r5-golden.diff` 保存完整 diff。`ops-l1-12-r5-golden-proof.json` 已以 JSON 結構核對恰為兩處，將新句撤回後與 HEAD 舊檔逐 byte 完全相同。其餘 golden 與 cases 檔未修改。

## 驗證與可重跑指令

- `python -B -X utf8 test/ops_l1_python.py 'test_level1*.py' 'test_weekly_report*.py' test_publish_recovery_reports.py`：164 案，163 pass、1 skip、0 failure/error，40.762 秒。紀錄 `output/operations/ops-l1-12-r5-regressions.txt`。
- 被 skip 的唯一案例 `test_timeout_stops_descendant_before_its_delayed_write`：真實 Windows 子程序已啟動，但受限 token 的 `taskkill /T` 明確回 `ERROR: Access denied`。這不是逾時清理成功的證據，必須由主幹一般身分重跑。另有測試證明清理失敗後 producer 停止後續模組、整體 no_data。
- 合成 Git repo 與實際子程序已驗 archive 忽略 dirty／untracked、source 全部檔案與 Git metadata 雜湊不變（新增收據除外）、模組 START／END 嚴格交替、正確 native command/cwd；原生 A2b 子程序可用，自己的 production/network guard 仍生效。
- `python -B -X utf8 tests/golden/run_golden.py check`：85 案 PASS；兩次完整執行 byte-identical。紀錄 `output/operations/ops-l1-12-r5-golden-check.txt`。
- `python -B -X utf8 test/ops_l1_12_r5_mutations.py`：三個破壞版要求指定 assertion FAIL，不能以 ERROR 充數；baseline／restored 都必須 exit 0，候選 SHA 不變。三個名稱依序是 `test_zero_cases_never_pass`、`test_nonzero_exit_never_pass`、`test_snapshot_excludes_dirty_worktree_and_untracked_files`。各輪仍明列同一個 sandbox skip，不把 skip 當執行證據。證據在 `output/operations/ops-l1-12-r5-mutations-*/proof.json`。
- r4 的「外層全域 guard」契約已被本卡明確取代，因此其 blanket allow/deny mutation script 為歷史證據；本卡更新 `test_level1_r4.py` 的相關預期，仍保留其 golden portability／內容比較回歸。

## 主幹一般身分 RUN

**先把本卡變更（尤其 golden）commit 到待驗證分支 HEAD，再跑。** 若只改工作樹而未 commit，archive 會依設計驗舊 golden；不能把那個 fail 誤認本卡結果。使用本 worktree 作來源、D: 作快照與驗證收據，避免冒充正式每日收據：

```powershell
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -B -X utf8 'C:/Users/cyc39/AI-Lanes/wt/l1r4/scripts/level1_offline_checks.py' --root 'C:/Users/cyc39/AI-Lanes/wt/l1r4' --out-root 'D:/AI-Lanes-work/l1r5-out' --work-root 'D:/AI-Lanes-work/level1-offline-checks'
```

核對 `D:/AI-Lanes-work/l1r5-out/output/operations/level1-checks-<實際日期>.json` 的 `source_head`、各模組結果、`elapsed_seconds` 與 log。CLI full 模式沿用「完成寫收據即 exit 0」；必須讀收據，不能靠 CLI exit code 判全綠。

主幹另用一般身分重跑上述回歸，確認逾時樹清理案例不再 skip。完整 archive 原始檔大小共 372,077,980 bytes，本席 D: 不在可寫範圍，因此沒有改存 C: 全量，也沒有產出一般身分耗時或 58 模組全綠聲明。

依主幹已有 r4 收據，`test_customer_questions`、`test_isolation` 為 exit 0／0 案例；若相同 HEAD 的原生 runner 仍如此，r5 應保留兩列 `no_data`，`line_full` 彙總也會 `no_data`。這符合本卡 0 案例不算 pass；未改測試載入器以製造全綠。`test_catalog_sync` 與 `test_suit_pricing` 有實際案例與部分 skip，符合新規則可 pass。

## 交付與限制

共用 `.git`、Vault 與 D: 都在本席可寫範圍外，未 commit、未寫 Vault、未部署。commit 訊息（含指定尾兩行）與可套 patch 存於 `output/operations/OPS-L1-12-r5-COMMIT-MESSAGE.txt`、`output/operations/OPS-L1-12-r5.patch`。主幹獨立驗收後回存 Vault task_summary；本檔及該目錄證據即交接資料。

全量 producer／Day-Audit 的一般身分耗時尚待量測，不能聲稱已符合 15 分鐘。先保留 900 秒排程；若完整 Day-Audit 實測超時，再依實測值提出調整，不在本卡直接更動排程。
