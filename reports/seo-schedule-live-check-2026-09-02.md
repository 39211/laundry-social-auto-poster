# SEO／GA4／GSC 排程 live check — 2026-09-02

## 讀取時間

- 本機時間：2026-09-02 08:05（Asia/Taipei）
- 讀取方式：`schtasks /Query /TN ... /FO LIST /V`，唯讀

## 排程證據

| 任務 | 狀態 | 上次執行 | 上次結果 | 下一次執行 | 執行檔 |
|---|---|---|---:|---|---|
| `\Laundry-GA4-Collect` | Enabled／Ready | 2026-09-01 23:10:01 | 0 | 2026-09-02 23:10 | `scripts/ga4-collect.ps1` |
| `\Laundry-GSC-Collect` | Enabled／Ready | 2026-09-01 23:15:01 | 0 | 2026-09-02 23:15 | `scripts/gsc-collect.ps1` |

## 與資料檔的交叉判定

- 最新 GA4 檔案仍為 `data/insights/ga4-traffic/2026-09-01.json`。
- 最新 GSC 檔案仍為 `data/insights/gsc-index/2026-09-01.json`。
- 因目前尚未到今日 23:10／23:15，不能把排程存在或上次 exit 0 解讀為今日已取得新資料。
- 本輪不手動執行 collector、不修改 Windows 排程、不重複提交 IndexNow。

## 下一個判定

23:10／23:15 後先讀取當日輸出與 freshness；只有缺檔、失敗或不新鮮，且沒有相同 writer 執行時，才依 runbook 各補跑一次。

## 08:39 重讀

- 排程仍是 Enabled／Ready；今日 GA4／GSC 檔案仍未產生。
- 本輪只做 live sitemap 全量可索引性重驗，結果為 33/33 HTTP 200、self-canonical 33/33、`index, follow` 33/33、JSON-LD 33/33；詳見 `reports/live-sitemap-full-indexability-audit-2026-09-02.md`。
- 因今日資料尚未到 freshness 窗口，本輪沒有手動 collector、沒有改排程、沒有重送 IndexNow。

## 9/1 collector output cross-check

- GA4 collector log：23:12 完成 `ga4-report` 與 `ga4-ai-traffic`；結果為 3 sessions、Google organic 0、AI 0、other 3。
- GSC collector log：23:15 的 search analytics 成功寫入，但資料日期為 2026-08-29；23:18 的 index inspection 才是 2026-09-01，結果 25 indexed／6 discovered／1 crawled。
- 因此 `Last Result=0` 只代表程序成功，不代表搜尋分析資料已涵蓋當日；報告保留資料日期與抓取時間兩個欄位，缺少 9/2 檔案時維持 `unmeasured`，不填 0。
