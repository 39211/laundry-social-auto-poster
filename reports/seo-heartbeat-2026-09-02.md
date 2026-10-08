# 私享家 SEO／AEO／GEO／GA4 heartbeat — 2026-09-02

## 實際完成

- root Pages corrective commit `18e9bc5` 已部署；live sitemap 目前 33 URL（原 32 + `shoe-odor-source.html` pilot）。
- pilot HTTP 200、自指 canonical；未驗證的 23 個 PR30 候選頁沒有留在 live sitemap。
- `indexing-push-2026-09-02.json` 稽核 33/33 URL HTTP 200，`thin_pages=0`、`unreachable=0`；live 傳播後 IndexNow 一次接受 2 個變更 URL（HTTP 200）。
- PR29／PR30 已合併；主工作樹未被清理或覆寫。
- 合併後乾淨 worktree 重新驗證 `test/indexGrowthPages.test.ts` 與 `test/publicSite.test.ts`：47/47 通過；`tsc --noEmit` 通過（正式 host env）。

## 今天與已知基線

| 指標 | 今日可確認值 | 證據／限制 |
|---|---:|---|
| live sitemap | 33 | live HTTP 200；提交不等於收錄 |
| GSC indexed | 25/32 | `data/insights/gsc-index/2026-09-01.json`，尚未涵蓋新 33 URL |
| GSC discovered／not indexed | 6 | 同上 |
| GA4 sessions | 3 | `data/insights/ga4-traffic/2026-09-01.json` |
| GA4 Google organic | 0 | 同上；樣本不足 |
| GA4 AI | 0 | 同上；不是缺檔推算 |
| LINE clicks | null | 尚無來源級量測，保留 unmeasured |

## 實驗與下一步

pilot 只帶四個可對應內容的意圖詞：鞋子臭、鞋內悶味、鞋子除臭、台中洗鞋除臭。第 7 天（2026-09-09）只看抓取／coverage／非品牌曝光；第 28 天（2026-09-30）才以 GSC 非品牌曝光、GA4 自然搜尋／AI、LINE click 決定 ADOPT、RETEST 或 REJECT。未達 ADOPT 前不增加 URL、不重送 IndexNow、不把 HTTP 200 宣稱為 Google 收錄。

12 個第二來源觀測詞已逐頁做 live 承接核對，完整字串命中 2/12；其餘只作語意觀測缺口，不在 pilot 期間硬塞或新增 URL。詳見 `reports/keyword-live-coverage-2026-09-02.md`。

## 風險

Google 新鮮 inspection 尚未取得；目前仍是 `google_indexing_claim=unmeasured`。前一次暫時 56 URL 的 IndexNow 通知不視為收錄證據，校正後沒有重複通知。
