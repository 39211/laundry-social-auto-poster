# 宣稱 AI／GEO 入口 live audit（2026-08-31）

## 結果

於 2026-08-31 18:13（Asia/Taipei）從公開站點逐一 GET 盤點；15/15 端點 HTTP 200，沒有把 200 視為搜尋引擎已收錄。

| 入口 | HTTP | UTF-8 bytes | 格式／內容驗證 |
|---|---:|---:|---|
| `/.well-known/llms.txt` | 200 | 99,081 | 純文字，1,168 行 |
| `/llms.txt` | 200 | 99,081 | 純文字，1,168 行 |
| `/llms-full.txt` | 200 | 290,424 | 純文字，6,647 行 |
| `/llms-lite.txt` | 200 | 5,135 | 純文字，50 行 |
| `/llms.jsonl` | 200 | 374,261 | 274 行、274/274 行可解析 JSON |
| `/ai-sitemap.xml` | 200 | 33,372 | 231 個唯一 `<loc>`，231/231 為本站 host |
| `/feed.json` | 200 | 242,284 | JSON 可解析，127 items |
| `/geo-targets.json` | 200 | 65,754 | JSON 可解析 |
| `/knowledge-graph.json` | 200 | 417,671 | JSON 可解析，352 個 `@graph` 節點 |
| `/latest.json` | 200 | 11,822 | JSON 可解析，3 posts |
| `/search-visibility.json` | 200 | 26,057 | JSON 可解析 |
| `/services.json` | 200 | 64,717 | JSON 可解析 |
| `/social-posts.json` | 200 | 973,833 | JSON 可解析，127 posts |
| `/ai-discovery.json` | 200 | 652,815 | JSON 可解析 |
| `/answers.json` | 200 | 204,672 | JSON 可解析，155 answers |

## Freshness 與解讀

- 可產生時間欄位的 JSON 入口都回報 `2026-08-30T17:11:35.767Z`；這與現有 server `Last-Modified` 的約 12 小時 53 分差異仍在，應在下次授權發布時核對生成時間與部署時間。
- `ai-sitemap.xml` 的 231 個 URL 是 AI 入口清單，不等於 Google sitemap 的 32 個 URL，也不等於 231 頁已上線或已索引；需逐 URL 做 HTTP／canonical／noindex 與內容品質閘門。
- 所有端點可讀只證明 crawler 可取得資料；目前 GSC 快照仍是 26 indexed、6 discovered-not-indexed。Perplexity、ChatGPT、Google AI 是否實際引用，沒有本次外部 citation 證據。
- `llms.jsonl` 回應的 Content-Type 是 `application/octet-stream`，但內容可逐行解析；若要提高跨工具相容性，應在後續授權變更中評估是否改成 `application/x-ndjson`，本次不改站台設定。

## 今日判定與下一步

- 現象：宣稱的 AI 入口全部可取得，且結構可讀；索引缺口仍集中在 GSC 的 6 個 discovered-not-indexed 頁面與尚未 live 的候選頁。
- 可能原因：入口可讀性不是索引保證；候選頁尚未部署、內鏈閉環與 snippet／內容品質仍是主要可控變因。
- 今日方策：維持端點可讀性控制，優先修 PR #30 的安全閘門、24 頁候選的 404 內鏈閉環與六頁高權重情境內鏈；本 heartbeat 不直接改 `src/` 或部署。
- 固定控制：live sitemap 32 URL、HTTP 200、self-canonical、noindex=0、JSON-LD 可解析，以及 GSC 26/6 快照保持不變，作為 7 日比較基線。
- 7 日／28 日規則：未滿 7 日只標 `PENDING`；7 日若新增 indexed URL 且 impressions／clicks 未下降才可 `ADOPT`，否則 `RETEST`；滿 28 日才依預先門檻判 `ADOPT`／`RETEST`／`REJECT`。提交或 HTTP 200 不得單獨觸發採用。

證據來源：本次公開端點 GET 結果；既有 [AI 入口 live audit](./ai-entrypoints-live-audit-2026-08-31.md)、[100 頁 evidence manifest](../docs-internal/index-growth-100-evidence-manifest-2026-08-31.json)。
