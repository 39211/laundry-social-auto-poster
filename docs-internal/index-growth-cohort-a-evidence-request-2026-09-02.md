# Cohort A 第一方素材證據回填表（2026-09-02）

用途：在 `HOLD_UNTIL_PILOT_ADOPT` 期間先把五頁的證據欄位準備好。未填完前不得加入公開 sitemap、不得宣稱實際客案、不得送新的索引請求。

## 每頁必填欄位

| 候選頁 | 原始素材相對路徑 | 來源類型／取得方式 | 拍攝或交付日期 | 店方／客戶同意紀錄位置 | 原始檔 SHA-256 | 對應 claim／段落 | 審核狀態 |
|---|---|---|---|---|---|---|---|
| `suede-shoe-cleaning` |  |  |  |  |  |  | `PENDING` |
| `canvas-shoe-mud` |  |  |  |  |  |  | `PENDING` |
| `leather-shoe-water-marks` |  |  |  |  |  |  | `PENDING` |
| `washing-machine-shoe-risk` |  |  |  |  |  |  | `PENDING` |
| `athletic-shoe-mixed-materials` |  |  |  |  |  |  | `PENDING` |

## 回填規則

1. `來源類型／取得方式` 必須能回答「誰在何時如何取得這張圖」，不能只寫「reference photo」或「AI」。
2. 若是客戶物件，先確認可公開使用範圍；未取得同意時只能作內部檢視，不可上線。
3. 只把 claim 寫成素材能支持的範圍；照片不能證明價格、效果保證或普遍結論。
4. 原始檔雜湊要由實際待發布檔案計算；換檔、裁切或壓縮後需重新計算。
5. 回填完成後，重跑 provenance、safety、link-closure、exact-host 與 mutation gate；任何一項失敗仍維持 `HOLD`。

## 目前狀態

`data/asset-ledger.json` 尚無上述五頁的 entry；本表目前全部 `PENDING`。這不是發布申請，也不會自動改變 live site。
