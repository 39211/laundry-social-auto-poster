# Cohort A 圖片標籤部分修正重驗（2026-09-02）

## 動作範圍

在隔離 worktree `sxj-index-growth-pilot-minimal-20260902` 的五個 Cohort A 候選頁，只把可見的 `og:image:alt`、`twitter:image:alt` 與首個 `figcaption` 從「鞋包清潔前的包角、鞋面與皮革檢查主圖」改成中性「鞋包材質與痕跡檢查示意圖」。未修改 root `src/`／`scripts/`、live HTML、sitemap、schema 或發布紀錄。

## 重驗結果

| 項目 | 結果 |
|---|---:|
| 五頁可見 OG／Twitter／figcaption 舊標籤 | 0/5 保留 |
| 五頁可見標籤改為中性描述 | 5/5 |
| 五頁正文 >500 字元、canonical 存在、無 noindex | 5/5 |
| live 候選 URL | 5/5 HTTP 404（因此沒有誤宣稱已部署） |
| `git diff --check` | 通過（僅 CRLF 警告） |

JSON-LD 解析與 `FAQPage`／`HowTo` 類型檢查亦為 5/5 通過；問題是內容值仍含舊 caption，不是 JSON 語法損壞。

修正後的 bytes／SHA-256 已封裝於 [revalidated package](../docs-internal/index-growth-100-cohort-a-revalidated-package-2026-09-02.json)，五頁 binding 重新比對為 5/5 通過；原先較早的雜湊讀值已不再作為發布依據。

### 新雜湊（隔離檔）

- `suede-shoe-cleaning.html`: `d631487e96a90f4f45bf33ca14eb2a6f385729248bf926f2cf83e3cf0f11e54f`
- `canvas-shoe-mud.html`: `21234d2aead0c9f410028cdf44594048b7f5ef6e24724cfb50e5548bbabf14f9`
- `leather-shoe-water-marks.html`: `ac877842d1a3aeab4ee06589d957cff4b9f3de92eec7e2c155fbb3fcb138a3bd`
- `washing-machine-shoe-risk.html`: `0d35799e12d597ef0c7ebb8d07e6dc83b5f40ee9b8cf41b52154b163bc2d0460`
- `athletic-shoe-mixed-materials.html`: `34bd361a880ccea7c3cddd4d935ea26ef8d5b2dc7e2a240d4c8e50fb50da76eb`

## 未解除的問題

每頁的 JSON-LD `primaryImageOfPage.caption` 仍由產生器輸出舊標籤，五頁各仍命中一次；因此本次只能判定為 `PARTIAL_REMEDIATION`，不能解除 `HOLD_UNTIL_PILOT_ADOPT`。若要完整修正，必須在允許修改 source 的窗口對產生器／資料來源做同一變因修正，再重跑 JSON-LD、素材 provenance、mutation、link closure 與 exact-host gate。

## 發布邊界

pilot 尚未達 2026-09-09 第 7 天與 2026-09-30 第 28 天門檻。五頁候選仍不進 live sitemap、不送 IndexNow、不要求建立索引；本報告只證明隔離候選的標籤風險已被定位並部分降低。
