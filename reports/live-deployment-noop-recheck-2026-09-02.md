# Live 部署／IndexNow no-op 複核 — 2026-09-02

## 複核時間與目的

- 時間：2026-09-02 09:08（Asia/Taipei）。
- 目的：在晚間 GA4／GSC 排程前，確認 live 版本沒有漂移，避免對未變更 sitemap 重送 IndexNow 或重複改內容。

## 直接 HTTP 證據

以下 URL 逐一 GET；全部 HTTP 200。SHA-256 為回應 HTML（UTF-8）雜湊：

| URL | HTTP | response chars | SHA-256 |
|---|---:|---:|---|
| `/` | 200 | 210129 | `9443b42bfdadad7b4f5ebe8b3cf1f6c96141a23dd399bdc6a44965642ab43486` |
| `/services/shoe-bag-care.html` | 200 | 40447 | `46bcab00c1108ce602eb785cc6fa99990d62d9825e1e67020ca505f912260cf7` |
| `/services/white-shoe-cleaning.html` | 200 | 37580 | `6ea363c42e1fd1002adbd887ef45296612742e39a0ab631e5a852b2c08c8992e` |
| `/services/business-bulk-laundry.html` | 200 | 38062 | `924a9363b1d150027ebaa364abe0079680a0c4a240c64c75a11c16a68fd1558b` |
| `/services/taichung-laundry-price-list.html` | 200 | 37957 | `d307a503ba1a36e0a47f5ae5eaab6ec4fca090abf2f3772eb06aa638d2d503b4` |
| `/services/taichung-citywide-laundry-pickup.html` | 200 | 39371 | `68ba2dae92fa42c8e86025f974dc18c9613c1c90d57c746623c45e8c63c4b95c` |
| `/guides/shoe-odor-source.html` | 200 | 36269 | `31ee6c48b4dac2dd752afe0e5ad0153b177291c254eeea995c10df0a4413e2d5` |
| `/sitemap.xml` | 200 | 3933 | `dad3557bb7d962c69566d08985e2ec5eba855b8aaa0f37f1e7261717703affe4` |

## 判定

- 本次抽查沒有發現 404、空回應或 live 版本漂移；pilot、兩個內鏈 treatment 與全市收送 control 均仍在線。
- `output/operations/indexing-push-2026-09-02.json` 仍記錄 sitemap 33 URL、4 個通知、HTTP 200、semantic hash `f0f5658d1a1111ecb925dda0f65c83f972824fdf5b52da2ce962ca0d5bd62472`。
- 因 sitemap 未變且尚未到 GSC／GA4 收集窗口，本次採 no-op：不重送 IndexNow、不新增 URL、不改第二個實驗變因。
- HTTP 200／IndexNow 接受只證明可取得與已送達，不證明 Google 已收錄或已有曝光；仍等待 23:10／23:15 的新鮮資料與 pilot 7／28 日 gate。
