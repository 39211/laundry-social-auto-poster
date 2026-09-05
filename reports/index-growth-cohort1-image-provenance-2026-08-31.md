# 第一 cohort 影像 provenance 盤點（2026-08-31）

## 盤點範圍

- 目標：第一 cohort 11 頁鞋包問題 guide。
- 盤點目錄：`data/reference-photos/`；只確認檔案存在，不把檔名當成第一方或客戶案例證明。
- `data/asset-ledger.json` 的總則是 AI 示範素材不可冒充實際客件；真實客件案例要經站主同意並另標 `real-case`。本盤點以該規則為準。
- 所有候選頁目前仍為 live 404；本盤點不會觸發部署或上傳影像。

## 結果

| slug | 可對題的本地參考檔 | provenance 狀態 |
|---|---|---|
| `shoe-odor-source` | 無鞋臭專屬檔 | `missing` |
| `suede-shoe-cleaning` | `suede-shoe-nap-before/after.png` | `unverified` |
| `canvas-shoe-mud` | `canvas-shoe-mud-before/after.png` | `unverified` |
| `leather-shoe-water-marks` | `leather-shoe-rain-before/after.png` | `unverified` |
| `washing-machine-shoe-risk` | 無專屬檔 | `missing` |
| `athletic-shoe-mixed-materials` | 無專屬檔 | `missing` |
| `shoe-sole-separation-limit` | 無專屬檔 | `missing` |
| `bag-clean-vs-repair` | 無清潔／維修分界專屬檔 | `missing` |
| `bag-color-transfer` | 無色移專屬檔 | `missing` |
| `bag-ink-marks` | 無筆痕專屬檔 | `missing` |
| `bag-lining-care` | 無內裡專屬檔 | `missing` |

## 判定與下一步

- 只有 3/11 有「題材名稱相符」的本地檔案，而且仍不能證明拍攝者、授權、日期、處理前後關聯或可公開使用權；因此目前 **0/11 可直接標為已驗證第一方案例**。
- 上述 3 組檔案在 `data/asset-ledger.json` 沒有對應 entry，也沒有 `real-case` 標記；依 ledger 規則，它們最多只能作為未驗證示意素材，不能在頁面中寫成客戶案例或實際成果。
- 隔離 HTML 的可見圖片 caption／alt 在 **11/11** 都寫成「鞋包清潔前的包角、鞋面與皮革檢查主圖」，而且 11 頁共用同一張圖；在沒有 provenance 時，這會讓讀者誤以為每頁都有對應的清潔前實拍。這是文字標示風險，不是單純圖片重複問題。
- 第一 cohort 不得把共用 `shoe-bag-care-hero-product.png` 當成每頁的案例照片。若沒有可核實的第一方素材，頁面應使用誠實的示意圖說明，並移除案例／成果暗示，不要補造故事。
- 在 provenance 補齊前，caption／alt 應改為中性的「鞋包材質與痕跡檢查示意圖」等描述，並移除「清潔前／後」與恢復暗示；修正後重新跑可見文字抽取稽核。
- 要進入 release review，需為每頁補一筆可追溯素材 provenance（來源、授權／拍攝紀錄、內容 hash、對應 claim），或把影像降級為非案例示意並通過文字安全審查。

## Release 判定

`NOT READY`。本盤點只證明本地檔案分布，不能把任何檔案推論為第一方證據；live sitemap 仍 32 URL，候選頁仍未部署。
