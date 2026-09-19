# 私享家產線任務與 PR 索引

更新：2026-09-20。這是公開摘要；私人證據保留在受控工作區，不能因建立索引就宣稱已上傳或驗收。

GitHub 主任務：https://github.com/39211/laundry-social-auto-poster/issues/90

## 最終交付

先完成可靠的鏡頭／提示詞架構，交付兩支 25–45 秒 Reel 經店主看片，再把實際跑通的流程封裝為可重用日更系統。GPT 生圖、Grok 訂閱生片；發布須另有授權。

## 主線

| 項目 | 狀態 | GitHub 任務 |
|---|---|---|
| TPLFIT | 已驗收，來源限制未結 | [#91](https://github.com/39211/laundry-social-auto-poster/issues/91) |
| G0V5 | 待現場證據包 | [#92](https://github.com/39211/laundry-social-auto-poster/issues/92) |
| DATA1B3 | 正式收尾未完成 | [#93](https://github.com/39211/laundry-social-auto-poster/issues/93) |
| T2 | 製作未開始 | [#94](https://github.com/39211/laundry-social-auto-poster/issues/94) |
| T3 | 待實片驗證 | [#95](https://github.com/39211/laundry-social-auto-poster/issues/95) |

TPLFIT 最新裁決：PASS_WITH_FOLLOWUPS。既有證據為 168 測試、405 回歸、80 突變；兩個獨立家族各抽查 60+18。這不是本次重新執行，也不代表 405 項全量人工審查或實片品質通過。comforter-wool/2、infant-quilt/7 來源限制仍保留。

## 既有任務完整 ID 索引

下列是本專案總帳既有項目的摘要映射，不新增工作範圍、不覆蓋歷史決策。部分原項目已有局部成果或已結子項；此表不替它們重新判定完成。涉及衝突規格，以最新核准契約為準。T2/T3 見上表，其餘如下。

| ID | 工作摘要 |
|---|---|
| T1 | 店主人像錨點 |
| T4 | 清潔中間狀態與連續動作 |
| T5 | 無法清除污漬的內容型態 |
| T6 | 片長規格一致性 |
| T7 | 清潔轉變呈現規則 |
| T8 | 價格資訊與對客口徑 |
| T9 | 近拍與人物入鏡規格 |
| T10 | 跨店通用化 |
| T11 | 研究來源補缺 |
| T20 | 既有知識筆記事實校正 |
| T21 | 架構子任務實作與驗收 |
| T22 | Cursor 寫入管道驗證 |
| T23 | 清潔方式分流知識庫 |
| T24 | 既有四線驗收後續 |
| T25 | 派工契約條款對照 |
| T26 | 預排素材與生成額度協調 |
| T27 | 派工管道與 TPLFIT/G0 主線 |
| T28 | 影片核准紀錄一致性驗證 |
| T30 | 排程啟動方式驗證 |
| T31 | 店內設備錨點與後續素材 |

## 店主決策與核對項索引

並非下列全部仍待批准；本次只保留 ID 對照，執行前須回查最新決策。W12 尚未有新的提前製片批准。

| ID | 主題 |
|---|---|
| W1 | 參考影片 |
| W2 | 拒收標準與客戶常見問題 |
| W3 | 既有 PR 合併決策 |
| W4 | LINE 與價格口徑確認 |
| W5 | 內容規劃中的客戶疑問 |
| W6 | 分析功能設定核對 |
| W7 | 比較鏡與可排片題材 |
| W8 | 價格與公開說明口徑 |
| W9 | 精品內容規格與素材 |
| W10 | 既有夜間派工停用狀態核對 |
| W11 | 影片核准流程驗證 |
| W12 | 是否有條件提前製作兩支片 |
| W13 | 預排圖片與網站更新決策 |

## 現有未合併 PR 快照

這是 GitHub 查詢時的 open 清單，不代表全部與本批主線直接相關，也不是合併建議。#89 的 base 是 #87 的分支，不能當成已合併 main。狀態變更請查 PR 本頁。

| PR | 標題 | base | head |
|---|---|---|---|
| [#89](https://github.com/39211/laundry-social-auto-poster/pull/89) | Register the owner's real washer, shoe washer and shoe dryer as anchors | `fix/reel-v3-two-reference-images` | `anchors/equipment-20260919` |
| [#88](https://github.com/39211/laundry-social-auto-poster/pull/88) | Ride out a momentary file lock instead of losing the day | `main` | `fix/ride-out-transient-file-locks` |
| [#87](https://github.com/39211/laundry-social-auto-poster/pull/87) | Pin the object with its own reference image, not with prose | `main` | `fix/reel-v3-two-reference-images` |
| [#86](https://github.com/39211/laundry-social-auto-poster/pull/86) | feat(publish): per-slot hold list that fails closed | `hermes/seo-luxury-question-titles` | `claude/slot-holds` |
| [#85](https://github.com/39211/laundry-social-auto-poster/pull/85) | fix(schedule): disable 21:40 hermes-Grok image fill | `hermes/seo-luxury-question-titles` | `claude/disable-grok-image-fill` |
| [#83](https://github.com/39211/laundry-social-auto-poster/pull/83) | reel-v3: tooling for the two-person shoe film | `main` | `reel/two-person-shoe-film` |
| [#82](https://github.com/39211/laundry-social-auto-poster/pull/82) | SEO: turn two existing guide contact sections into actionable LINE enquiries | `hermes/seo-luxury-question-titles` | `codex/seo-guide-intake-20260912` |
| [#81](https://github.com/39211/laundry-social-auto-poster/pull/81) | feat(reel): reel-v2 pipeline in the Codex comparison style | `still-material-optics` | `claude/reel-v2-codex-style` |
| [#80](https://github.com/39211/laundry-social-auto-poster/pull/80) | fix(reel): hermes clip bridge resolves xai credentials on the new plugin | `still-material-optics` | `claude/hermes-clip-creds` |
| [#67](https://github.com/39211/laundry-social-auto-poster/pull/67) | feat(seo): price-list answer capsule names bedding tiers | `still-material-optics` | `claude/price-answer-bedding` |
| [#57](https://github.com/39211/laundry-social-auto-poster/pull/57) | docs(fb-line): backup 2026-09-05 page/messenger watch skill + baselines | `main` | `cursor/fb-line-watch-docs-422d` |
| [#55](https://github.com/39211/laundry-social-auto-poster/pull/55) | test: stop the digest-absent case grinding the retry backoff | `claude/vitest-heavy-test-timeouts` | `claude/imagetopic-retry-backoff` |
| [#52](https://github.com/39211/laundry-social-auto-poster/pull/52) | test: give three CI-slow cases their own 30s timeout | `still-material-optics` | `claude/vitest-heavy-test-timeouts` |
| [#51](https://github.com/39211/laundry-social-auto-poster/pull/51) | feat(reel): re-burn tool regenerates narration TTS and subtitles into a staging run | `still-material-optics` | `grok/reburn-reel-narration-2026-09-05` |
| [#41](https://github.com/39211/laundry-social-auto-poster/pull/41) | fix(schedule-ahead): only catch Refusing image fallback on deferred reel | `claude/schedule-ahead-deferred-reel-skip` | `cursor/schedule-ahead-narrow-reel-catch-ccc1` |
| [#40](https://github.com/39211/laundry-social-auto-poster/pull/40) | docs: verify PR38/39 2026-09-04 | `claude/schedule-ahead-deferred-reel-skip` | `verify/2026-09-04-pr38-pr39` |
| [#35](https://github.com/39211/laundry-social-auto-poster/pull/35) | test: 2026-09-03 壓力／對抗測試（dry-run，不改產品語意） | `main` | `cursor/stress-test-20260903-caef` |
| [#31](https://github.com/39211/laundry-social-auto-poster/pull/31) | Integrate fail-closed SEO/GSC/GA4 automation on index-growth baseline | `main` | `codex/index-growth-main-automation-integrated-20260902` |
| [#28](https://github.com/39211/laundry-social-auto-poster/pull/28) | GAP-05 (9/1–9/3) 發布缺口獨立稽核報告 | `main` | `cursor/gap05-holes-audit-dc29` |
| [#27](https://github.com/39211/laundry-social-auto-poster/pull/27) | Fix YouTube catch-up skip-by-sha and public-site posted-log alignment | `still-material-optics` | `cursor/publish-pipeline-holes-9fd9` |
| [#26](https://github.com/39211/laundry-social-auto-poster/pull/26) | F39: clip 生成改走 repo 內 hermes 訂閱路線(根治 8/26 依賴被清事故) | `main` | `worktree-f39-hermes-clip-rewire` |
| [#25](https://github.com/39211/laundry-social-auto-poster/pull/25) | Measure AI-engine referrals without needing GA4 admin access | `main` | `claude/ga4-ai-traffic` |
| [#24](https://github.com/39211/laundry-social-auto-poster/pull/24) | Cut reel acts hard instead of dissolving them | `main` | `claude/competent-pike-ebc889` |
| [#23](https://github.com/39211/laundry-social-auto-poster/pull/23) | Give every support page its own AEO answer capsule | `main` | `claude/aeo-answer-capsules` |
| [#21](https://github.com/39211/laundry-social-auto-poster/pull/21) | Add GSC OAuth re-authorization helper | `main` | `claude/gsc-reauth-script` |
| [#20](https://github.com/39211/laundry-social-auto-poster/pull/20) | Record two traps from the video redo: I2V lift-up, and a dead clip path | `main` | `error-book-f38-f39` |
| [#19](https://github.com/39211/laundry-social-auto-poster/pull/19) | Tell the image model how light behaves on each material | `main` | `still-material-optics` |
| [#4](https://github.com/39211/laundry-social-auto-poster/pull/4) | Fix reel subtitles: hard-wrap can leave a comma leading the next line | `main` | `claude/heuristic-mayer-11648e` |
| [#1](https://github.com/39211/laundry-social-auto-poster/pull/1) | Manual image QA gate found live-but-uncommitted; needs a decision before it can run | `main` | `review/manual-image-qa-gate` |

## 自動同步規約

- 快速對話提出架構與拆工，Codex 核對後執行並更新對應 Issue／PR，回傳連結與結果摘要。
- 同一工作樹單 writer；同家族多管道不算獨立審查票。
- 每次交付列出改動範圍、基線／檔案 SHA、測試命令及結果、剩餘限制。
- Issue／PR 建立不代表實作完成；不得把本文件 PR 說成 TPLFIT/G0V5 程式 PR。
- GitHub 是協作索引；快速對話無法開啟連結時，由 Codex 讀回內容後傳送摘要，不假稱對方讀過。
- 本次任務同步允許相關文件提交與 PR；不授權合併、部署、廣告花費或變更發布排程。
