# PR #30 repair packet（2026-08-31）

## 目前基線

- PR：<https://github.com/39211/laundry-social-auto-poster/pull/30>
- HEAD：`ba6ab5a85524c3a5e4fa4c0848c89be7b944881d`
- 狀態：OPEN；CI `typecheck-and-test` 綠燈，但沒有可用的人工／獨立 code review（GitHub comment 是 Codex review usage-limit 通知，不是核准）。
- 本 packet 只描述 PR 分支應修正的範圍；本輪沒有修改 `src/`、`scripts/` 或發布資料。
- 最新 mutation 重驗見 `reports/index-growth-pr30-mutation-gate-revalidation-2026-08-31.md`；六組案例的 fail-then-restore 驗收規格見 `docs-internal/pr30-mutation-repair-acceptance-2026-08-31.md`。目前五組關鍵 mutation 仍 fail-open，故 release 仍 `REWRITE_REQUIRED`。

## 逐檔缺口與驗收

| 檔案／目前位置 | 已觀察到的問題 | 必須新增的證據 |
|---|---|---|
| `src/publishPages.ts:267-337` | 發布 entrypoint 直接進入 commit／push；production host gate 只在 `generatePublicSite` 的 deployment option 可見，不能證明所有 publish path 都拒絕非 `https://sixiangjialaundry.com`。 | 呼叫每一個 production entrypoint 時，以 preview／fixture／其他 host 做 mutation，必須在任何寫入前 fail；合法 production host 才能繼續。 |
| `src/indexGrowthPages.ts:527-827` | validator 只檢查 registry key 存在；`resolveAcceptedIndexGrowthPages` 先以 `page.publish_state === "accepted"` 篩選，再驗證，count／projection 仍可能各自推導。 | resolver 一次回傳 accepted page、projection 與 count；故意移除／改變狀態後，所有投影與 sitemap count 同步變紅。 |
| `src/indexGrowthPages.ts:1037-1054` | `attachProvenance` 將同一頁級 `refs` 複製給 citation、step、section、FAQ；`content_revision` 固定為 `${lastmod}#1`。 | 每個主要 claim 綁定 locator、短摘要與 immutable hash；更換 claim、來源內容或 revision 時，production gate 必須 fail。 |
| `src/indexGrowthPages.ts:830-853` | 已有 `protectedSupportContentHash` helper，但目前 mutation audit 證明只改 section／description／keywords 仍可通過 validator。 | 以真實 catalog→HTML→sitemap 路徑做 body、metadata、revision、hash 四組 mutation；每組移除或不匹配都要 fail，還原同一變更回綠。 |
| `clothing-mold-airing` candidate | 生成器目前可接受，但安全審查發現「避免擾動、PPE、專業評估」未被 production safety gate 強制；安全草稿已另存，未進 live。 | 內容安全 gate：移除避免擾動、把 N95 改一般口罩、加入漂白比例／必然恢復、將 draft 改 accepted，各自必須 fail。 |
| 第一 cohort HTML 的圖片標示 | PR head `src/generatePublicSite.ts:3771` 的 `supportPageImageAlt` 直接拼接 `image.topic`；`src/generatePublicSite.ts:7000` 的 guide caption 只輸出 `image.topic`。11 頁共用 `shoe-bag-care-hero-product.png`，可見 caption／alt 在 11/11 寫「鞋包清潔前」，但 `data/asset-ledger.json` 沒有對應 `real-case` provenance。 | 沒有已核實 provenance 時，輸出必須改用中性示意 caption／alt；加入「清潔前／後」或案例成果的 mutation 必須 fail，還原後回綠。 |
| 第一 cohort 內鏈 closure | 隔離輸出 62 個唯一內鏈目標中，live 目前 50 個 200、12 個 404；11 個是同批候選，`rainy-bag-care` 是 cohort 外 404。 | overlay 以完整 11 頁同批部署時，所有 cohort 內目標須驗證 200；cohort 外目標必須改連 live 200 或納入同批，否則 release fail。 |
| `test/publicSite.test.ts:704` 等既有影像斷言 | 目前測試直接要求「鞋包清潔前的包角、鞋面與皮革檢查主圖」，只驗 AI note 字串，沒有驗 provenance-aware 中性標籤或第一 cohort guide caption。 | 更新測試以驗證未核實 provenance 時 4 個欄位皆為中性示意描述；加入「改回清潔前／後」的 mutation 必須 fail，還原後回綠。 |
| 第一 cohort snippet description | `src/indexGrowthPages.ts` 的候選 `description` 以「私享家洗衣店（地址）」開頭；隔離 HTML 的 meta／OG／Twitter description 為 11/11 brand-leading，問題答案被延後。 | 為 snippet 建立答案先行的 description（品牌／地點後置），三個 meta surface 同步輸出；測試驗 11/11 不再 brand-leading，並保留 NAP 在正文／schema。 |

## 固定測試命令／輸出

1. `npm.cmd run test -- --run test/indexGrowthPages.test.ts test/publishPages.test.ts test/publicSite.test.ts`
2. `npm.cmd run test`
3. `npx tsc --noEmit`
4. `git diff --check`
5. 在隔離輸出根目錄做 HTML／canonical／JSON-LD／正文厚度／內鏈檢查；再用 live sitemap 逐 URL HTTP 200 recheck。
6. 第一 cohort 額外驗證圖片可見文字與 asset ledger 逐頁對齊；若無 `real-case` provenance，不得出現「清潔前／清潔後」或案例成果字樣。

所有測試必須顯示 command、exit code、通過／失敗數與 mutation 具體錯誤類型；`ok=true`、HTTP 200、IndexNow 200 或 sitemap 數量本身都不能當作部署核准。

## 發布邊界

- 安全草稿未通過前，第一批保守上限是 23 頁（live sitemap 至多 55）；不能用生成器的 24／56 數字宣稱已可部署。
- PR 修正與獨立複審通過後，才可做 HTML／SEO-only overlay；不可把約 646 MB 資產樹加入淺克隆。
- overlay 後必須再次驗證 live sitemap、HTTP、canonical、JSON-LD 與 GSC inspection；IndexNow 只記為提交，不記為收錄。

## 20:28 pre-deploy blocker snapshot

- 六頁既有內容的加厚草案與答案先行摘要 dry-run 已備妥；實驗 treatment／control 與 null-safe GSC／GA4 規則見 `docs-internal/index-growth-100-six-page-measurement-contract-2026-08-31.md`。
- PR30 accepted 24 live closure 最新為 HTTP 200 `0/24`、HTTP 404 `24/24`、sitemap 成員 `0/24`；不能以隔離輸出 56 或候選 24 當 live。
- 品質 focused tests `50/50` 與 typecheck 通過，但完整 suite 有獨立 `scheduleAhead` 回歸（`88/89 files`、`753/754 tests`），見 `reports/non-indexing-schedule-regression-2026-08-31.md`；因此整體 release 仍不可宣稱全綠。
- 這個 snapshot 只收斂阻斷，不授權修改 source、合併、部署或重送 IndexNow。
