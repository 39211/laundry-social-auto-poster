# Historical R1 review; not a verdict on future repairs

結論：
- **Cannot ship（Grok R1 產品候選）**。作者／主代理的綠測試不能抵銷下列兩個實際失敗。
- 基線 `8d9fde2c6565d1a3d6ed62f282b84e3a65b44124`；R1 publicBundle SHA `f921809bb9c6be70…`。完整 SHA 見 review-repro/original-review-source-manifest.json；四個候選檔與固定 gate 在本席探測前後均未改。

必修問題：
1. **P1：周邊頁面失敗後留下混合版本。** `src/generatePublicSite.ts:9190` 先完成 owned commit，`src/seo90/publicBundle.ts:473–510` 的 snapshot/catch 只涵蓋 SEO pages、manifest、removals，無法涵蓋後續正式站寫入。合成初次成功後將 docs/index.html 設唯讀，合法更新拋 EPERM；實際文章、daily、manifest、sitemap 已新版、服務頁仍舊；social-posts.json 也改了。期望出錯後整個前版保持。可重跑命令見下；此為真 fs 權限錯誤，不是 AST 或假 throw。
2. **P1：服務目錄 junction 未受輸出邊界保護。** `src/generatePublicSite.ts:9184–9189` 只預檢 SEO pages/manifest/removals；`publicBundle.ts:442` 也只檢查傳入集合。把合成 docs/services junction 指向 docs 外、仍屬本測試的 TEMP 目錄，正式生成成功並改寫外部服務檔。期望任何寫入前拒絕。這反例沒有碰使用者其他目錄。

最小修復範圍：
- 將本次 release 真正會寫／刪的完整集合先編譯並統一驗證、snapshot、commit、復原。至少包含文章／圖、daily、服務頁、sitemap、全站 daily 導覽、manifest，以及本次同步改動的 social-posts.json；不是只把 owned commit 移到尾端。
- 完整 write-set 都須做 lexical/realpath/ancestor alias 檢查，不能僅保護新文章与 manifest。新增這兩支反例對應的產品回歸，不改固定 acceptance 換綠。

可選改善／有據限制：
- `publicBundle.ts:480` snapshots 只在記憶體，459–469 的還原是 catch 中重寫檔案；目前沒有可從重啟讀回的交易 journal。只能描述行程內例外回滾，不能宣稱斷電／強殺恢復。本席未做強殺實測。
- `publicBundle.ts:301` 任一已公開內容變成未重新核准，就在寫入前整批拋 SEO90_UNAPPROVED_REVISION；這是整批拒絕，不能宣稱逐篇隔離更新。本輪未另跑混批反例，不列新增阻擋。

測試缺口：
- 本席兩個搬入 evidence 的獨立 replay 都真跑到 exit 1、stderr 0 bytes；R1 原始與 replay 結果全保存。gate SHA 仍 `aa244fed66158d17543b748b08513f3d101fdab85bac671b1e1b31e3424cae3c`。
- 主代理另報固定 gate 6/6、109/109與typecheck 0；本席未重跑同組。完整 manifest 偽造、同批 stale＋合法更新、共享圖與零 SEO 未新增獨立反例；不冒稱本席已全驗。

同類錯誤搜尋：
- Pattern：局部交易／局部路徑守衛被誤當全站一致性。
- Searched：publicBundle manifest/owned verification/plan/commit、正式 generator 接線、四檔 diff 及新增 tests。
- Found：上列兩個 P1。
- Remaining risk：其他後段寫入失敗點同屬完整 write-set 問題，不能只特判 index.html 或 services。

是否重犯 .Codex/mimo-lessons.md 內的舊錯：
- No（本席）。已跑 git status --short、git diff --stat、git diff；保留 raw、實際退出碼及檔案 SHA，未用作者 PASS 或 numstat 代替驗證。未碰 .tmp/、候選產品碼與固定 gate。

最終建議：
- HOLD 整合／發布；將確認缺陷一次交 Grok R2。僅本輪反例與修復契約可交付，不是產品 GO。
- Windows，在候選 site cwd：`node --import tsx ../evidence/review-repro/late-write-failure.mts`；`node --import tsx ../evidence/review-repro/service-directory-junction.mts`。
- 每支腳本自建合成 fixture、自動清理，預期修好後 exit 0；目前 R1 都 exit 1。細節與 raw 見 review-repro/README.md。
- maker為Grok/xAI、checker為GPT；本裁定不涉及控制面三席。
