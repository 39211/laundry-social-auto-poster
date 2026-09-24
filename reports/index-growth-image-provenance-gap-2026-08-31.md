# Index-growth image provenance gap — 2026-08-31

## Isolated output audit

盤點隔離生成的 24 個候選 guide HTML 首張 `<img>`：

- 24 頁只使用 3 個 hero image URL；
- 17 頁共用 `shoe-bag-care-hero-product.png`；
- 4 頁共用 `fabric-storage-hero-product.png`；
- 3 頁共用 `fabric-storage-inspection.png`。

`clothing-mold-airing.html` 與 `post-wash-drying-before-storage.html` 使用 `fabric-storage-hero-product.png`，不是特定衣物的第一手案例照片；目前也沒有 candidate-specific inspection photo manifest 可把圖綁到 claim。

## Interpretation

共用示意圖本身不等於頁面不可索引，但不能充當「真實案例／第一手檢查證據」。尤其衣物發霉與收納頁若宣稱案例或成果，會缺少可核對素材；這與既有安全／provenance gate 不相容。沒有合法第一方照片時，正文只能寫可核對的檢查流程，不得寫成客戶成果或前後保證。

## Decision

`PENDING / EVIDENCE REQUIRED`：保留示意圖的頁面必須清楚標示其用途；`clothing-mold-airing` 維持 draft，直到安全內容、claim provenance 與（若宣稱案例）第一手影像證據完成。此盤點沒有修改 `src/`、`scripts/`、排程、發布紀錄或 live 網站。
