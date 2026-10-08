# 內鏈實驗紀錄：企業大量頁與價目頁（2026-09-02）

## 判定

實驗已部署，範圍只包含兩個既有服務頁的正文脈絡連結；沒有新增 URL、沒有改全市收送頁，後者維持對照組。這是可觀測的 SEO 變因，不是收錄保證。

## 變更

- `services/business-bulk-laundry.html`：在「收送」正文段落補一個指向 `taichung-laundry-price-list.html` 的價格判斷連結。
- `services/taichung-laundry-price-list.html`：在「價格怎麼決定」正文段落補一個指向 `business-bulk-laundry.html` 的企業大量送洗連結。
- 兩頁的可見更新日與 JSON-LD `dateModified` 更新為 `2026-09-02`；sitemap 僅同步兩頁 `<lastmod>`。

## 部署與 live 證據

| 檢查 | 結果 |
|---|---|
| 專案 GitHub 分支 | `still-material-optics`，commit `aa1316537a7e257fbb71ece02a0300a97b449088`，遠端一致 |
| Pages Actions | run `33566074510`，`completed / success` |
| 企業大量頁 live | HTTP 200；正文連結存在；canonical 自指；無 `noindex` |
| 價目頁 live | HTTP 200；正文連結存在；canonical 自指；無 `noindex` |
| sitemap | 33 個 URL；本次沒有新增 URL |
| IndexNow | `output/operations/indexing-push-2026-09-02.json`：4 URL、HTTP 200；hash `f0f5658d1a1111ecb925dda0f65c83f972824fdf5b52da2ce962ca0d5bd62472` |

### Live response binding (2026-09-02 06:35 Asia/Taipei)

| URL | live status／bytes | live response SHA-256 | local Git blob |
|---|---:|---|---|
| `/services/business-bulk-laundry.html` | 200 / 45,550 | `924a9363b1d150027ebaa364abe0079680a0c4a240c64c75a11c16a68fd1558b` | `4c2f0ae61f038e1236e6984dd9e5f8588139afa5` |
| `/services/taichung-laundry-price-list.html` | 200 / 43,917 | `d307a503ba1a36e0a47f5ae5eaab6ec4fca090abf2f3772eb06aa638d2d503b4` | `18df758233a0831d32793c9bcbf14c81b99bcb32` |
| `/sitemap.xml` | 200 / 3,933 | `dad3557bb7d962c69566d08985e2ec5eba855b8aaa0f37f1e7261717703affe4` | `79a73fa13a55d9b11982564b4e0a898390aab6f0` |

IndexNow 的 4 個 URL 是 sitemap 變更後依 lastmod／差異規則選出的通知集合；通知成功不代表 Google 已抓取或建立索引。

## 控制與觀察

- `services/taichung-citywide-laundry-pickup.html` 及其既有正文入鏈不變，作為對照組。
- 目前最新 GSC 快照仍為 25/32 indexed、9 impressions、0 clicks（`data/insights/gsc-index/2026-09-01.json`、`data/insights/gsc/2026-08-29.json`）；本次部署後尚無新鮮 GSC inspection，不能宣稱索引增加。
- 直到下一個新鮮 inspection／成效資料到達前，不再追加相同變因或重送 IndexNow。

### 08:10 freshness recheck

- 本機時間：2026-09-02 08:10（Asia/Taipei）。
- 最新 GSC 檔仍為 `data/insights/gsc-index/2026-09-01.json`；最新 GA4 檔仍為 `data/insights/ga4-traffic/2026-09-01.json`。
- 今日尚無新的 inspection／成效快照，因此本實驗維持 `UNMEASURED`，不把既有 25/32 indexed 或 9 impressions 歸因於本次內鏈。
- sitemap semantic hash 與當日 IndexNow 報告未出現新變更；不重送、不追加正文變因，等待 23:10／23:15 排程資料。

### 08:12 live HTTP recheck

- `sitemap.xml`、pilot、企業大量頁與價目頁均 HTTP 200；目前 `Content-Length` 分別為 3,933、41,933、45,550、43,917 bytes。
- 五個 Cohort A 候選 URL 仍 HTTP 404，未列入 live sitemap。
- 兩個實驗頁的 response SHA-256 與上表一致；bytes 欄位已依本次 `curl -sSI` 的 `Content-Length` 校正。

### 08:46 anchor-text recheck

- 直接讀取 live HTML，企業大量頁仍以「台中洗衣價目表」連到價目頁；價目頁仍以「店家與公司大量衣物送洗」連回企業大量頁。
- 兩個錨文字都在可見正文／頁尾連結集合中；全市收送頁仍未被改成實驗 treatment，維持對照組。
- 這只確認變因在 live HTML 存在，不代表已造成抓取、收錄或曝光提升。

## 判定規則

- 第 7 天：確認兩頁是否被重新抓取；沒有 inspection 證據時標示 `unmeasured`。
- 第 28 天：比較非品牌曝光、GA4 自然搜尋 sessions、LINE click；三者缺一則 `INCONCLUSIVE`。
- 只有達到預先規則才可 `ADOPT`；否則 `RETEST` 或 `REJECT`，不因 HTTP 200、IndexNow 或 sitemap 提交而提前放量。
