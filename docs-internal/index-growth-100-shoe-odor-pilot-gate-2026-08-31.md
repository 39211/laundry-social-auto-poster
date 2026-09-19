# shoe-odor-source pilot gate（2026-08-31）

## Pilot 定義

`shoe-odor-source` 是目前唯一直接對應 first-party GSC 非品牌查詢的候選（`勃肯鞋會臭嗎`：2 impressions／0 click／平均位置 21）。Pilot 只代表需求優先順序，不代表可部署，也不改變 100 頁批次的共同閘門。

## Gate matrix

| Gate | 證據 | 結果 |
|---|---|---|
| 需求匹配 | GSC query 與 slug／答案同主題 | `PASS_FOR_PRIORITY` |
| 隔離 HTML | 1,198 main chars、answer box、self-canonical、JSON-LD | `PASS` |
| Snippet 三面 | meta／OG／Twitter description 仍品牌／地址先行 | `FAIL` |
| 圖片 provenance | 共用 hero；沒有 `real-case` ledger entry | `FAIL` |
| Link closure | `washing-machine-shoe-risk` 目前 live 404；其餘既有目標可抓 | `FAIL` |
| Production live | `/guides/shoe-odor-source.html` 尚未上線（404） | `FAIL` |
| PR30 mutation／host | 五組 fail-open mutation 尚未修復；production entrypoint exact host 未證明 | `FAIL` |

## 最小修復順序（待授權）

1. 先修三個 snippet surface 為答案先行，品牌／地點後置；保留答案、NAP 與限制事實。
2. 將共用示意圖改為中性 caption／alt，或補上可追溯且已授權的第一方素材；不得標成清潔前／後或案例成果。
3. 將 `washing-machine-shoe-risk` 改連 live HTTP 200 目標，或把完整互鏈 cohort 同批上線並驗 overlay closure。
4. 完成 PR30 的 publish-state、provenance、revision/hash、mold safety、exact production-host 五組 fail-then-restore mutation；再跑 focused/full/typecheck 與 live recheck。

## 判定

`PILOT_NOT_READY`。目前不加入 sitemap、不送 IndexNow、不合併 PR #30；只有所有 gate 通過後才可作 HTML／SEO-only overlay，並以部署日開始 7／28 日 GSC／GA4 規則。

## 19:51 asset-ledger recheck

- `data/asset-ledger.json` 的 entries 中沒有 `shoe-odor`、勃肯鞋或鞋臭專屬的 provenance record；可對題的本地鞋圖也沒有 ledger `real-case` 綁定。
- 因此圖片 gate 維持 `FAIL`，不能把檔案存在或 AI／示意圖當成鞋臭客件案例；若無合法第一方素材，必須輸出中性示意 caption／alt 並通過可見文字稽核。

## 19:54 isolated snippet dry-run

候選三面文案（同一字串同步 meta／OG／Twitter）為：

> 鞋臭先分潮氣、汗垢與悶放，不要用香味蓋住；再看鞋墊、內裡與材質，決定通風或送洗。私享家洗衣店台中西屯可到府收送。

只在記憶體字串驗證後：56 字元／168 UTF-8 bytes、答案先行、品牌不先行、包含候選頁既有答案／界線／檢查／收送事實，危險承諾 pattern `0`。這只解除 snippet 的表面文案設計阻斷，實際 snippet gate 仍為 `FAIL`，直到 source patch、三面 HTML audit 與 live recheck 完成。

## 19:57 neutral image-label dry-run

將候選頁既有影像表面（img alt、OG image alt、Twitter image alt、JSON-LD caption、figcaption）在記憶體中統一替換為「鞋內異味來源與材質檢查示意圖」：5/5 surface 全部改為中性文字，legacy「清潔前／清潔後／客件案例／恢復成果」命中 `0`。這只證明替換方案可通過表面文字 gate；未改 HTML，圖片 provenance gate 仍為 `FAIL`，直到 source patch、測試與 live recheck 完成。

## 20:13 quality-test binding

- 目前 worktree 的 `publicSite`／`publishPages` 測試為 `31/31 PASS`；sitemap、IndexNow、GSC 相關測試為 `19/19 PASS`；`npm.cmd run typecheck` 亦通過。
- 這些結果只證明現有程式與資料邊界可通過 focused checks，不會覆蓋本 pilot 的 snippet、image provenance、404 link closure、production live 或 PR30 whole-path mutation／exact-host gates。
- 六頁 live 內容加厚草案已另存於 `docs-internal/index-growth-100-six-page-content-enrichment-brief-2026-08-31.md`；它不會改變 `shoe-odor-source` 的候選頁狀態，也不會把候選 URL 先加入 sitemap。

因此本 pilot 仍維持 `PILOT_NOT_READY`。
