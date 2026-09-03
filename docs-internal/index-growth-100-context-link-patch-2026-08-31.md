# Context-link patch brief — 2026-08-31

這份 brief 把 live link audit 轉成可在 PR #30 實作的最小變更；不是部署指令，也沒有修改 `src/`／`scripts/`。

## Three safe body links

| Source section | Body sentence to add | Existing `targetSlug` | Live target |
|---|---|---|---:|
| `taichung-citywide-laundry-pickup` → `怎麼預約？` | `如果還不確定手上的物件該走門市、收送或哪個服務，先看洗衣搜尋指南再傳照片。` | `taichung-laundry-service-search` | 200 |
| `taichung-laundry-price-list` → `價格怎麼決定` | `鞋面泛黃可先看白鞋黃化指南；精品材質與乾洗風險可先看精品乾洗指南，再傳照片確認。` | `white-shoe-yellowing`, `luxury-dry-cleaning` | 200 / 200 |

## Implementation constraint

`renderRichText` 會先 escape，再用 `linkifyPublicMentions` 將既有片語變成 anchor；因此實作者要：

1. 把上面兩句放進指定正文 section（不是 FAQ、schema、footer）；
2. 沿用現有 `洗衣搜尋指南` → `taichung-laundry-service-search` 規則，讓 citywide 新句子在正文命中；
3. 在 linkify rules 加入兩個不會與既有片語衝突的完整片語，分別指向 `white-shoe-yellowing` 與 `luxury-dry-cleaning`；
4. 測試每個 source page 的 `<main>` 至少出現對應 anchor 一次，並保留 target HTTP 200／self-canonical 檢查。

不要用 `post-wash-drying-before-storage.html` 作為替代目標：本次 live HEAD 為 404，須等該候選頁通過 production gate 並部署後才能建立內鏈。

## Acceptance

- 三個 anchor 都位於正文情境段落，anchor 文字描述下一步；
- 既有目標頁與來源頁內容不被改寫成城市複製頁；
- focused/full/typecheck、HTML／SEO-only overlay 與 live recheck 全通過後，才可在 sitemap 更新後執行一次 IndexNow；
- IndexNow、HTTP 200、link count 都不等於 Google 已收錄，仍須等待新鮮 GSC inspection／coverage 證據。
