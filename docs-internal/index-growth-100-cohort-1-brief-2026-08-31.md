# Index-growth-100 第一 cohort brief（鞋包問題決策）

這份 brief 從 PR #30 的 accepted/generated inventory 排出最多 11 頁的第一批候選。它不是部署清單：每頁仍須通過 production host、resolver、claim provenance、revision/hash、safety 與 live recheck 閘門。

## 為什麼先做這一批

- 第一方 GSC 已出現 `勃肯鞋會臭嗎`（2 impressions、0 click），且 `guides/birkenstock-care.html` 有 12 impressions；這是目前最清楚的非品牌需求訊號。
- 公開 SERP 的材質／問題型需求（麂皮、帆布泥、皮鞋水痕、鞋臭、機洗風險）可拆成不同決策，不必建立城市複製頁。
- 第一批固定在鞋包 hub，先驗證「問題意圖 → 可抽取答案 → 既有服務頁」的鏈路；衣物發霉頁維持 draft，不混入本 cohort。

## 候選與不可替代的使用者工作

| 順序 | slug | 使用者要決定什麼 | 必須保留的獨特答案 | 主要控制頁／下一步 |
|---:|---|---|---|---|
| 1 | `shoe-odor-source` | 鞋臭是潮氣、汗垢還是悶放？ | 先分來源再決定通風、送洗或檢查 | `guides/birkenstock-care.html` → `services/shoe-bag-care.html` |
| 2 | `suede-shoe-cleaning` | 麂皮倒伏或濕擦後變硬能否處理？ | 不要濕擦；先看絨毛方向與硬化範圍 | `guides/rainy-shoe-care.html` → 鞋包服務 |
| 3 | `canvas-shoe-mud` | 帆布沾泥現在能不能擦？ | 先等泥乾，再按布面與膠邊分開判斷 | `guides/rainy-shoe-care.html` → 白鞋服務 |
| 4 | `leather-shoe-water-marks` | 皮鞋雨痕是否該立刻上油？ | 先處理水痕與乾燥，避免用油把問題鎖住 | `guides/rainy-shoe-care.html` → 鞋包服務 |
| 5 | `washing-machine-shoe-risk` | 鞋子能不能直接丟洗衣機？ | 混合材質、膠邊與內裡的風險不同，不以「能洗」一概而論 | `guides/birkenstock-care.html` → 鞋包服務 |
| 6 | `athletic-shoe-mixed-materials` | 運動鞋網布、膠邊、內裡怎麼分開看？ | 分部位檢查，不承諾一次恢復新品 | `services/white-shoe-cleaning.html` → 拍照指南 |
| 7 | `shoe-sole-separation-limit` | 開膠是清潔問題還是維修問題？ | 清潔不能取代結構維修；先判斷是否應轉介 | `guides/bag-clean-vs-repair.html` → 鞋包服務 |
| 8 | `bag-clean-vs-repair` | 包包髒污、掉色、開裂要清潔還是維修？ | 先分外觀髒污與結構／補色需求 | `guides/luxury-dry-cleaning.html` → 鞋包服務 |
| 9 | `bag-color-transfer` | 色移是外來染料還是自身掉色？ | 先做材質與轉色來源判斷，不保證完全回復 | `guides/bag-clean-vs-repair.html` → 提把指南 |
| 10 | `bag-ink-marks` | 包內筆痕能否自行擦掉？ | 不先用酒精；先看內裡材質與擴散風險 | `guides/bag-lining-care.html` → 鞋包服務 |
| 11 | `bag-lining-care` | 外表乾淨但內袋有粉塵／味道怎麼辦？ | 外觀與內裡要分開檢查，避免只處理表面 | `guides/bag-ink-marks.html` → 鞋包服務 |

## 每頁共同驗收

1. 首段先回答該頁唯一問題，再說檢查條件、不可逆風險與何時交件；不得把店名／地址放在答案前面。
2. 至少一個 claim 有自己的 locator、摘要與內容 hash；不能把同一 registry key 複製到所有 claims。
3. 至少一個正文情境連到現有 HTTP 200 頁；不得連到尚未 live 的 `post-wash-drying-before-storage.html`。
4. **link closure**：若第一 cohort 單獨部署，所有正文內鏈的目標都必須是目前 live HTTP 200，或同一 cohort 內會同批上線並在 overlay 中驗證為 200；不得指向其他尚未部署的候選頁。
5. 材質、掉色、開膠等結果寫成可驗證的處理界線，不承諾恢復新品、不虛構案例或價格。
6. 隔離輸出先完成 focused/full/typecheck 與 HTML／SEO-only audit；live 逐頁驗 HTTP 200、canonical、JSON-LD、正文厚度與非 doorway 內鏈。

7. 未核實 provenance 的共用圖只能使用中性 caption／alt（例如「鞋包材質與痕跡檢查示意圖」）；不得寫「清潔前／清潔後」、案例或恢復成果。

影像 provenance 另見 `reports/index-growth-cohort1-image-provenance-2026-08-31.md`；檔案存在不等於已證明為第一方案例或已取得公開授權。

## 實驗與判定

- **唯一主變因**：問題型頁面首段的可抽取答案 + 一條情境內鏈。
- **固定控制**：既有 32 個 live URL、robots、canonical、schema 模板、GA4 事件命名與服務事實不變。
- **7 日**：部署後若 GSC crawl／inspection 前進且 impressions 或 clicks 增加，才可 `ADOPT`；只有 crawl 前進為 `RETEST`；資料不足為 `PENDING`。
- **28 日**：GSC／GA4 完整且仍無 crawl、indexed 或 impressions 改善，才可 `REJECT`；缺資料維持 `INCONCLUSIVE`。

目前狀態：11 頁均只列為候選，尚未部署、尚未進 sitemap，也未送 IndexNow。

## 19:44 第一方需求 pilot 選擇

- 11 頁中只有 `shoe-odor-source` 能直接對應目前 GSC 非品牌查詢 `勃肯鞋會臭嗎`（2 impressions、0 click，平均位置 21）；其餘候選目前只有公開 SERP 形狀訊號，不能宣稱已有第一方流量。
- 該頁隔離 HTML 已有 1,198 字元正文、答案框「鞋臭先分潮氣、汗垢與悶放；不要用香味蓋住。」、self-canonical 與 JSON-LD；但 meta／OG／Twitter 仍品牌／地址先行，且 `washing-machine-shoe-risk` 尚未 live（404）。
- 因此把 `shoe-odor-source` 標為「需求優先的 pilot candidate」，不是放寬 release gate：仍須修 snippet、影像 provenance、安全／mutation／host gate，並在部署前閉合所有內鏈；其他 10 頁維持探索批次。
