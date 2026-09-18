# 第一 cohort 內鏈 closure matrix（2026-08-31）

## 判讀方式

隔離 HTML 目前指向 62 個唯一站內 URL，其中 12 個在 live 尚未部署而回 404。這 12 個不能全部直接視為部署後仍會失效：其中 11 個是第一 cohort 自身或 cohort 內互鏈，若 11 頁同批上線並在 overlay 驗證為 200，會閉合；只有不在本 cohort 的候選才是外部 closure blocker。

## 逐頁矩陣

| source | cohort 內候選目標（同批上線才可） | cohort 外未部署目標 | 修正決定 |
|---|---|---|---|
| `shoe-odor-source` | `washing-machine-shoe-risk` | 無 | 同批部署或改連 live 鞋包服務 |
| `suede-shoe-cleaning` | `canvas-shoe-mud` | 無 | 同批部署或改連 live 雨季／鞋包頁 |
| `canvas-shoe-mud` | `suede-shoe-cleaning` | 無 | 同批部署或改連 live 雨季／鞋包頁 |
| `leather-shoe-water-marks` | `suede-shoe-cleaning` | 無 | 同批部署或改連 live 雨季／鞋包頁 |
| `washing-machine-shoe-risk` | `athletic-shoe-mixed-materials` | 無 | 同批部署或改連 live 鞋包服務 |
| `athletic-shoe-mixed-materials` | `washing-machine-shoe-risk` | 無 | 同批部署或改連 live 白鞋／鞋包頁 |
| `shoe-sole-separation-limit` | `athletic-shoe-mixed-materials`, `washing-machine-shoe-risk` | 無 | 同批部署或改連 live 鞋包服務 |
| `bag-clean-vs-repair` | `bag-color-transfer` | 無 | 同批部署或改連 live 精品／鞋包頁 |
| `bag-color-transfer` | `bag-clean-vs-repair` | 無 | 同批部署或改連 live 精品／鞋包頁 |
| `bag-ink-marks` | `bag-lining-care` | 無 | 同批部署或改連 live 鞋包服務 |
| `bag-lining-care` | `bag-ink-marks` | `rainy-bag-care` | **必修**：改連目前 live 200 目標，或把 `rainy-bag-care` 納入同批並重新驗證 |

## Release gate

- 若完整 11 頁同批部署，overlay 必須證明所有 cohort 內目標 HTTP 200；若只部署子集，互鏈也必須改成既有 live 200。
- `rainy-bag-care` 目前是唯一明確的 cohort 外 404 目標；在修正或納入同批前，第一 cohort 不得 release。
- 這份 closure matrix 不授權修改 `src/`／`scripts/`，也不代表候選頁已加入 sitemap；live sitemap 仍只有 32 URL。
