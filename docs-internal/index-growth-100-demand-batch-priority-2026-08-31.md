# Index-growth-100 需求導向批次優先序（2026-08-31）

## 判定邊界

目前可用的 GSC 需求樣本只有 63 impressions／1 click（11 個日檔）；非品牌查詢主要是 `勃肯鞋會臭嗎`、`娃娃送洗台中`、`絨毛娃娃清洗店`。這些是「先驗證哪一類」的訊號，不是市場搜尋量估計。兩個娃娃查詢已對應既有 `guides/plush-doll-cleaning.html`，因此不另建同義薄頁。

## 建議批次順序

每批最多 6 頁，先完成同一意圖族群的品質閘門，再進下一批。下列排序只依第一方查詢鄰近度、既有服務關聯與可驗證的問題差異，不宣稱流量大小。

| 批次 | 頁面（6 頁） | 需求／服務連結理由 | 特別控制 |
|---|---|---|---|
| A 鞋材質與異味 | `suede-shoe-cleaning`、`canvas-shoe-mud`、`leather-shoe-water-marks`、`shoe-odor-source`、`washing-machine-shoe-risk`、`athletic-shoe-mixed-materials` | 最接近「勃肯鞋會臭嗎」與既有鞋包服務；每頁都是材質／處理決策，不是換地名 | 與 `birkenstock-care`、白鞋頁互鏈；保留清潔與修復界線 |
| B 鞋／包損傷邊界 | `shoe-mold-surface-check`、`shoe-sole-separation-limit`、`bag-color-transfer`、`bag-ink-marks`、`bag-lining-care`、`nylon-bag-care` | 延伸「發霉、色移、筆痕、內裡」等問題，能導向既有鞋包服務 | 每個 claim 要有來源與限制；不得把示意圖寫成客件前後 |
| C 包袋與衣物判斷 | `canvas-bag-care`、`backpack-cleaning-check`、`bag-clean-vs-repair`、`wool-coat-dry-clean`、`wool-knit-shrink-risk`、`oil-vs-water-stain-choice` | 對應材質、油水污漬與清潔／修復選擇；可連到乾洗與收送服務 | 中性素材標籤；避免與既有乾洗／襯衫頁重複涵蓋 |
| D 收納與雨後處理 | `clothing-mold-airing`、`vacuum-bag-storage-risk`、`blanket-damp-check`、`post-wash-drying-before-storage`、`synthetic-vs-leather-handle`、`rainy-bag-care` | 對應收納前乾燥、雨後包袋與材質差異 | `clothing-mold-airing` 目前 safety draft；未通過前只可先上其餘 5 頁 |

## 首批 release gate

1. PR #30 先補 exact production host gate、單一 resolver／count authority、claim-level provenance、真實 content revision／cohort hash 與 mutation tests。
2. 每頁 answer、meta、OG、Twitter 都須答案先行；目前隔離產物三個 snippet surface 品牌先行 `24/24`，因此尚未可部署。
3. 圖片沒有 verified `real-case` 時，必須使用中性示意描述；目前 verified real-case assets `0/24`，可見未驗證案例暗示 `17/24`。
4. 先在隔離 overlay 讓所有內鏈目標 HTTP 200，再逐 URL驗 live HTTP、canonical、noindex、JSON-LD、正文與 sitemap；候選目前 live `0/24`、內鏈 `24/48` 為 404。
5. 部署後只計入 live sitemap URL；GSC indexed count 另以 URL Inspection／Page Indexing 讀值，IndexNow 200 不算收錄。

## 100 頁算術

- 現有 live sitemap：32 URL。
- 24 頁全部通過並部署，理論 live 會到 56；若 clothing-mold 保持 draft，保守上限是 55。
- 因此仍需另外 44–45 個「各自有證據且通過閘門」的頁面，不能把 AI feed 的 231 loc 或候選檔案數當成 100 頁。
- 150／200 規劃延後到 100 個 live 且經 7／28 日驗證後。

