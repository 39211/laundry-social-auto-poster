結論：
- **Cannot ship R3 原版；兩個 R1 P1 已關閉，但 WebP 回歸仍阻擋。** 本輪限完整 write-set、回滾與路徑修復；不是正式發布、斷電或跨程序並行驗收。
- publicBundle SHA256：c982f9513e444081981fd4f0dd29cb0ee9576187d5d2fc16f12338e82ea4842d；完整五檔 SHA 在 review-repro-r3/review-source-manifest.json。探測前後未變：True。

必修問題：
1. **P1：延後提交使新 WebP 的 HTML 判斷看到舊磁碟狀態。** `src/generatePublicSite.ts:4421` 的 webpSrcFor 只接受 existsSync 的衍生圖；文章／hub HTML 先建好，9293才規劃 WebP bytes，9307才 commit。首次沒有已落地 WebP 時，不會輸出預期 picture。主代理全套出現 `publicSite.test.ts:1533` 真紅，並單例穩定 exit 1；本席未重跑，已核實程式因果。最小修法：先確定同 transaction 的衍生圖計畫，renderer 將這組路徑視為可用；最後提交相同 bytes，不先寫正式 docs。

已關閉的原 P1：
- 完整生成結果現改收集 PublicTreeChange，再由 commitPublicTree 統一預檢與 snapshot；service、sitemap、文章、daily、manifest、metadata、導覽同在集合。原本先 owned commit 再散寫周邊頁面的流程已移除。主代理原 late-write-failure、service-directory-junction 均重跑 exit 0。
- 本席以 R1 ARTIFACT-SHA256.json 逐檔比對 **33/33一致**，含兩支可跑腳本、original 副本及摘要；沒有藉修改反例取綠。

回滾／根目錄檢查：
- `publicBundle.ts:615–679` 先釘 docs 真實根、驗每個寫／刪目標與祖先，再保存全部 snapshots。catch 在667等 Promise.allSettled(started)，之後才還原／比對，沒有仍在途的本次 write 去覆蓋還原結果。
- snapshot 是 RAM bytes／存在狀態／寫入權限位，沒有磁碟 staging、backup 或 rename。新檔回滾時 unlink；未列入 write-set 的旁檔不清掃。還原僅作用原 snapshots；惡意並行更換祖先仍明確未涵蓋。
- **唯一新增 probe：真 fs 還原失敗＋新行程封鎖。** 在自有 TEMP 將第一個已寫入檔改為同名目錄，同時讓另一唯讀檔寫入失敗；未用 failRestore 注入開關。實得 SEO90_RESTORE_FAILED、站根 marker 存在；另啟全新 Node 行程 commit 得 SEO90_RELEASE_BLOCKED，later.txt 未產生、未知旁檔 bytes 不變。probe exit 0，stderr 空，TEMP fixture 已清理。

可選改善／有據風險：
- `markBlocked:495` 吞 marker 寫入錯誤；若站根無法寫 marker，只有記憶體 blockedSites 可保證。上項 probe 證明的是可寫站根，**沒有證明 marker 不可寫時仍跨程序阻擋**。不得描述成持久交易 journal 或斷電復原。

測試缺口：
- 本席沒有重跑主代理固定6案、原兩反例、115項suite或typecheck。主代理所報 gate6/6與兩typecheck0不覆蓋上述 WebP 真紅。
- 強殺／斷電、第二 writer、惡意 TOCTOU、marker 持久化失敗未驗；未擴大到全站或內容品質審查。

同類錯誤搜尋：
- Pattern：規劃 bytes 與已落地檔案混用；局部交易／祖先守衛。
- Searched：commitPublicTree、restoreAll、blocked guard、generator 的完整收集與渲染順序。
- Found：WebP 判斷仍依舊磁碟；兩原 P1 修復成立。
- Remaining risk：其餘 renderer 的存在性判斷須沿同一 planned output 原則，不能先落檔繞過交易。

是否重犯 .Codex/mimo-lessons.md 內的舊錯：
- No（本席）。git status/diff --stat/diff 已留存；原碼與舊證據未改，實際退出碼、SHA、未驗條件分開記錄。

最終建議：
- 先完成已確認 WebP 小修，再對精確 diff 與原紅例複審；不要改固定 gate。原R1/raw保留不覆蓋。
- 證據：review-repro-r3/restore-failure-fresh-process.json、stdout/stderr/exit、r1-artifact-integrity.json。原 probe 原樣留存；它的 OUT 指向自有 TEMP 舊檔且使用 wx，若另重跑須換新報告位置。
- **本席已停止 probes，候選可交主代理 writer。**
