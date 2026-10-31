# Deploy B2-7: weekly attribution export (shop) + summary pull (ai)

## Shop PC (user AN, PC on, Windows PowerShell 5.1)
1. **Copy the files.**
   - Put `attribution_weekly.ps1` and `test_attribution_weekly.ps1` in `C:\LaundryStores\fxwash\runtime\`.
   - Put `register-attribution-weekly.ps1` in a working folder, for example `C:\LaundryStores\ops\`.
   - Copy by USB, RDP, or `scp` with the existing `shop-pc` alias.
   - Do not change `attribution_export.py` or `attribution_retention.py`.
2. **Run the test.** It uses temp folders only.
   `powershell -NoProfile -ExecutionPolicy Bypass -File C:\LaundryStores\fxwash\runtime\test_attribution_weekly.ps1 -Python C:\LaundryStores\python-portable\python.exe`
   - The last line must be `RESULT PASS=<n> FAIL=0`, and the exit code must be 0.
3. **Preview the task.**
   `powershell -NoProfile -ExecutionPolicy Bypass -File C:\LaundryStores\ops\register-attribution-weekly.ps1 -DryRun`
   - Check: Monday 10:40, user ends with `\AN`, Interactive/Limited, 30 minutes, StartWhenAvailable True.
4. **Register for real.** Run the same command without `-DryRun`.
   - It is safe to re-run; it updates the existing task.
5. **First manual run.**
   `Start-ScheduledTask -TaskName FXwash-Attribution-Weekly`
   - Wait about 1 minute.
   - `Get-ScheduledTaskInfo -TaskName FXwash-Attribution-Weekly` should show `LastTaskResult : 0`.
   - `Get-Content C:\LaundryStores\fxwash\logs\attribution_weekly.log -Tail 2` should show one `step=export` line and one `step=retention` line.
   - `data\conversions\source-to-order-<last week>.json` should exist.
   - Re-running creates a new revision. That is expected.
   - Result codes:
     - 3: lock busy. Run it again later.
     - 1: error. Check stderr by running the CLI by hand, per ATTRIBUTION-EXPORT.md.

## ai PC (`C:\Users\cyc39\laundry-repo`)
6. **Copy the files.** Put `pull_shop_conversions.ps1`, `register-conversions-pull-task.ps1` and `test_conversions_pull.ps1` into `line-bot\`.
7. **Run the test.**
   `powershell -NoProfile -ExecutionPolicy Bypass -File line-bot\test_conversions_pull.ps1`
   - It must end with `RESULT PASS=<n> FAIL=0` and exit code 0.
8. **Register the task.**
   - Preview: `powershell -NoProfile -ExecutionPolicy Bypass -File line-bot\register-conversions-pull-task.ps1 -DryRun`
   - Then run it without `-DryRun`.
   - If the task already exists, unregister it first; the script refuses to replace it.
9. **First pull.** The shop PC must be on, and step 5 must be done.
   `powershell -NoProfile -ExecutionPolicy Bypass -File line-bot\pull_shop_conversions.ps1; $LASTEXITCODE`
   - The exit code must be 0.
   - The last line of `%LOCALAPPDATA%\line-bot\conversions_pull.jsonl` must show `"result":"INSTALLED"` and `"exit":0`.
   - `data\conversions\source-to-order-<week>.json` must exist in the repo.
   - A second run must show `NOTHING_NEW`.
   - The files appear as untracked in `git status`. Whether to commit them is a separate decision.
10. **Note on timing.** The Monday 08:00 weekly report runs before the shop PC is on. It therefore sees the summaries pulled the previous Monday, so it is one week behind.

## Rollback
11. **Unregister both tasks.** Data files and scripts can stay; they are inert.
    - Shop PC: `Unregister-ScheduledTask -TaskName FXwash-Attribution-Weekly -Confirm:$false`
    - ai PC: `Unregister-ScheduledTask -TaskName LineBot-PullShopConversions -Confirm:$false`
    - To go back to manual weekly runs, follow ATTRIBUTION-EXPORT.md.