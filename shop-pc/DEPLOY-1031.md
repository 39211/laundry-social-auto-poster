# DEPLOY 10/31 — shop PC bundles A3-2 → A4-4 → B1-2 (morning), B2 (afternoon)

Commander sheet, run from the ai PC. The shop PC can only be touched 10:00–19:30.

The scripts are the proven a42 phase scripts, generalized. The API model refused to write them (cyber policy), so the commander wrote them.

- `bundle-phase1.ps1 -Bundle X [-CheckOnly]`
  - Exit codes: 0 = ok, 1 = rolled back, 2 = refused before any change.
- `bundle-phase2.ps1 -Bundle X -Backup <dir>`
  - Prints PASS or FAIL for each check.
- `bundle-rollback.ps1 -Bundle X -Backup <dir>`
  - Exit codes: 0 = rolled back, 3 = MANUAL_RECONCILE_REQUIRED.

Smoke tests on ai, with no real tasks or processes:
- `test-bundle-phase1.ps1`: 9 cases, mutations 5/5 red.
- `test-bundle-rollback.ps1`: 2 cases, mutation 1/1 red.

0. **10:32 — endpoint check.**
   - Run `ops\Get-LineEndpoint.ps1`. It must show the shop `lhr.life` URL.
   - Then run `ssh shop-pc` and read the tail of `logs\tunnel_events.jsonl`. It must show `day_start` or `put_result` 200.
1. **Copy files to the shop.** Run once:
   - `scp -r stage-<X> shop-pc:"C:/LaundryStores/<X>-staging"` for X = A3-2, A4-4, B1-2.
   - `scp bundle-*.ps1 shop-pc:"C:/LaundryStores/ops/"`.
2. **For each bundle X, in order A3-2, A4-4, B1-2:**
   - a. Run `ssh shop-pc "powershell -NoProfile -ExecutionPolicy Bypass -File C:\LaundryStores\ops\bundle-phase1.ps1 -Bundle X -CheckOnly"`.
     - Expect `CHECK OK`.
     - A `REFUSED requires` line means the live file differs from what we built on. Stop and compare; do not force.
   - b. Run the same command without `-CheckOnly`.
     - Expect `PHASE1 OK backup=<dir>`.
     - Copy the backup path.
   - c. Run `bundle-phase2.ps1 -Bundle X -Backup <dir>`.
     - Expect `PHASE2 PASS X`.
   - d. If any line says FAIL, run `bundle-rollback.ps1 -Bundle X -Backup <dir>`.
     - For A3-2, exit 3 means the outbox changed. Then the monitor stays stopped and tasks stay disabled; reconcile by hand following DEPLOY-A3-2.md §6.
3. **After A4-4 and after B1-2:** on ai, run `ops\Get-LineEndpoint.ps1 -Test`. Expect webhook/test 200.
4. **B1-2 extra step (Memory.md).** The shop appends to this file, so it is edited in place.
   - Back it up first: `copy config\Memory.md backups\B1-2-...\Memory.md.before`.
   - Then run `python apply_edits.py b1-memory-edit.md C:\LaundryStores\fxwash` from `B1-2-staging`.
5. **ai bot B1-2, during the day while ai is standby.**
   - Merge `feat/b1-2-bot-facts` into release with an explicit merge.
   - Run `ops\deploy-ai-linebot.ps1` (A8-2).
   - Expect Probe ok, then `line-bot\test_b1_facts.py` 9/9.
6. **14:00+ — B2.** Only after A3-2 and A4-4 PASS.
   - Run `bundle-phase1.ps1 -Bundle B2`. It requires live webhook = A4-2 `161A4DD3…`.
   - Run phase2. Attribution is still OFF.
   - Then follow `shop-pc/DEPLOY-B2.md` steps 5–10: key, gitignore, shop.json key, restart, owner's phone test, one `message_observed` row.
