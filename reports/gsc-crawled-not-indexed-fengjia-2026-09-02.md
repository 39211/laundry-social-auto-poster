# GSC「已檢索但未索引」逢甲頁診斷 — 2026-09-02

## 目前狀態

`data/insights/gsc-index/2026-09-01.json` 將 `local/fengjia-laundry-pickup.html` 列為 `Crawled - currently not indexed`；最後抓取時間為 2026-09-01T09:54:07Z，Google 與使用者 canonical 都指向自身。

## live 核對

| 項目 | 逢甲頁 | 中科頁 | 東海頁 | 青海路洗鞋頁 |
|---|---:|---:|---:|---:|
| HTTP | 200 | 200 | 200 | 200 |
| 正文字元（去標籤） | 1,724 | 1,461 | 1,567 | 2,669 |
| href 數 | 32 | 24 | 31 | 27 |
| canonical | self | self | self | self |
| `noindex` | 否 | 否 | 否 | 否 |

逢甲頁標題／H1 為「逢甲洗衣收送：宿舍與租屋怎麼約」，不是空頁或 soft-block。頁面正文已有逢甲夜市／福星路／文華路、宿舍櫃台／套房交接、學生與租屋族常見物件、營業時間與洗衣／洗鞋分流等情境。先前計算的 36–56% token 交集只是簡易啟發式，非 Google 指標，不能單獨證明內容重複。

## 判定

- 這個狀態不是「再按一次要求索引」能解決；Google 已經抓過，但目前沒有足夠證據判定是內容重複或品質不足。
- 不把啟發式相似度當成 Google 判決，也不因它直接改寫或下架頁面。
- pilot 觀測期內維持頁面不變，避免與鞋臭 pilot 或關鍵詞 treatment 混淆。

## 後續 treatment 草案

若 pilot gate 允許下一個內容變因，才考慮先只改逢甲頁一段；必須先取得店方新的一手流程或案例，否則維持現版。不得只為了填詞重寫，也不改 URL、title、schema 或其他在地頁。第 28 天以非品牌 GSC、GA4 organic、LINE click 判定，缺資料則 `INCONCLUSIVE`。
