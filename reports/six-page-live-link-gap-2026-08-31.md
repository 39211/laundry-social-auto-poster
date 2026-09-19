# Six-page live contextual-link gap — 2026-08-31

## Evidence

唯讀抓取六個 GSC `Discovered - currently not indexed` 頁面的 `<main>`，並以 live target HTTP HEAD 交叉檢查。沒有修改 HTML 或 production source。

| Source page | Recommended body target | In `<main>` now | Target HTTP |
|---|---|---:|---:|
| `services/taichung-citywide-laundry-pickup.html` | `guides/taichung-laundry-service-search.html` | **No** | 200 |
| `services/taichung-citywide-laundry-pickup.html` | `services/taichung-laundry-price-list.html` | Yes | 200 |
| `services/business-bulk-laundry.html` | `local/zhongke-office-laundry.html` | Yes | 200 |
| `services/business-bulk-laundry.html` | `services/taichung-citywide-laundry-pickup.html` | Yes | 200 |
| `services/taichung-laundry-price-list.html` | `guides/white-shoe-yellowing.html` | **No** | 200 |
| `services/taichung-laundry-price-list.html` | `guides/luxury-dry-cleaning.html` | **No** | 200 |
| `services/taichung-xitun-laundry.html` | `guides/taichung-laundry-service-search.html` | Yes | 200 |
| `services/taichung-xitun-laundry.html` | `local/fengjia-laundry-pickup.html` | Yes | 200 |
| `guides/taichung-laundry-service-search.html` | five service-intent targets | Yes | 200 each |
| `services/fabric-storage.html` | `guides/bedding-storage-check.html` | Yes | 200 |
| `services/fabric-storage.html` | `guides/post-wash-drying-before-storage.html` | **No** | **404** |

## Safe next change

只新增三個 live 200 目標的正文情境連結：全市收送 → 搜尋指南；價目 → 白鞋黃化指南；價目 → 精品乾洗指南。不要先連到 `post-wash-drying-before-storage.html`，直到該頁通過 production gate 並 live 200。這些連結要放在解釋下一步的段落，不能只加到 footer／導覽，也不能增加城市變體頁。

## Status

`PENDING`：heartbeat 目前禁止修改 `src/`／`scripts/`，且 PR #30 尚未取得 PR-only 修復授權；因此本檔是驗證證據，不是部署指令。
