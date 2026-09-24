# 第一 cohort HTML 品質稽核（2026-08-31）

## 範圍與來源

- PR #30 head：`ba6ab5a85524c3a5e4fa4c0848c89be7b944881d`。
- 隔離輸出：`C:\Users\cyc39\AppData\Local\Temp\sxj-index-growth-100-20260831\docs`。
- 目標：第一 cohort brief 的 11 個鞋包問題 guide；只讀稽核，不改主工作樹、PR 或 live。

## 結果

| 檢查 | 結果 | 判讀 |
|---|---:|---|
| 候選 HTML 存在 | 11/11 | 通過隔離產物存在性 |
| 去除 script/style/tag 後正文 | 1,183–1,330 字元 | 通過目前正文厚度門檻（不是收錄保證） |
| answer box 首句以店名／地址開頭 | 0/11 | 通過；首句是問題答案 |
| meta／OG／Twitter description 以店名／地址開頭 | 11/11 | **REVIEW**：snippet 可能先抽到品牌與地址，問題答案被延後 |
| self-canonical | 11/11 | 通過 |
| JSON-LD 可解析 | 11/11 | 通過 |
| 候選 hero 圖唯一數 | 1 | **REVIEW**：11 頁共用 `shoe-bag-care-hero-product.png`，尚無候選頁專屬第一方照片證據 |
| 唯一內鏈目標 | 62 | 需做 live closure |
| 內鏈目標目前 live HTTP 200 | 50/62 | 已存在目標可抓取 |
| 內鏈目標目前 live HTTP 404 | 12/62 | 11 個是第一 cohort 自身／互鏈，若同批部署並驗證 overlay 可閉合；`rainy-bag-care` 是 cohort 外 404，仍是明確 blocker |

## 必修後再審

1. 第一 cohort 若完整同批部署，必須在 overlay 驗證 11 個 cohort 內候選目標均為 200；若只部署子集，則把互鏈改成目前 live 200。`rainy-bag-care` 必須改連 live 200 或納入同批；不得留下 live 404。
2. 為每頁補可追溯的第一方素材／影像 provenance，或在頁面資料中明確標示共用示意圖的限制；不可把同一 hero 圖當成 11 頁各自的案例證據。
3. 保留 answer box、canonical、JSON-LD 與正文厚度的現有通過結果，並在修正後重新跑完整 HTML／SEO-only 與 live recheck。
4. 將候選頁的 snippet description 改為問題答案先行、品牌／地點後置；同步驗 meta、OG、Twitter 三處，不要只改 answer box。

## Release 判定

`NOT READY`。正文與結構化資料通過不等於可部署；link closure 與影像 provenance 尚未滿足。live sitemap 仍 32 URL，這 11 頁均為 404，不計入 100 頁里程碑，也不觸發 IndexNow。
