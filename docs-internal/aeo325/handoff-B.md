# B 單交接：325 項 AEO 未核准資料發布防線

## 目標

在程式層阻擋尚未取得店主核准的答案庫資料進入任何正式對外輸出。這是需求稿，沒有修改 repository 或寫程式。

## 核准紀錄格式

每個答案庫 ID 一筆紀錄；建議 JSON Lines、JSON array 或等價 CSV：

```json
{
  "ID": "sxj_151",
  "approved": false,
  "approved_by": null,
  "approved_at": null,
  "page_mapping": null,
  "index_eligible": false
}
```

- `ID`：唯一答案庫 ID，必須與來源清單一對一對應。
- `approved`：只有店主完成核准後才可為 `true`。
- `approved_by`、`approved_at`：核准者與 ISO 8601 時間；`approved=true` 時兩欄必填。
- `page_mapping`：核准內容對應的既有 canonical URL；未指派頁面時為 `null`。新 URL 必須另經核准流程，不由 slug 自動生成。
- `index_eligible`：明確索引資格。預設 `false`；不能由 `approved=true` 自動推成 `true`。
- 允許輸出至少須同時符合 `approved=true`、有有效 `page_mapping`，以及目標頁本身的索引條件；各輸出端仍各自檢查，不只在匯入時檢查一次。

## 必須攔截的輸出路徑

1. 正式 HTML：未核准資料不能出現在可公開頁面的標題、正文、FAQ、CTA 或可讀 HTML 文字中。
2. Service JSON-LD：未核准項目不能建立服務名稱、服務區域、承接能力、價格或效果結構化資料。
3. FAQ JSON-LD：未核准問答不能輸出；已核准問答也必須與同頁可見正文逐字／語意一致。
4. 對外 AI 資料檔：未核准資料不能進公開 JSON、feed、資料集或其他供外部模型／爬蟲讀取的檔案。
5. Sitemap：只有 `index_eligible=true` 且頁面 canonical 指向自身、可索引、非 redirect 的核准 URL 可加入；不得由原始 325 筆清單直接補回。
6. 任何共用快取或生成中間檔若會被公開讀取，也須先套用同一核准條件。

## 回歸測試需求

1. 輸入一筆 `approved=false` 且含完整正文／FAQ 的記錄 → 正式 HTML、Service／FAQ JSON-LD、對外 AI 資料與 sitemap 都不得出現該 ID、內容或 URL。
2. 輸入 `approved=true` 但 `approved_by` 或 `approved_at` 缺漏 → 驗證失敗並拒絕所有公開輸出。
3. 輸入 `approved=true`、`index_eligible=false` 且有有效頁面對應 → 可進核准後的正文流程，但不得進 sitemap。
4. 輸入 `approved=true`、`index_eligible=true`，但 canonical 指向其他 URL → 目標 URL 不得進 sitemap，且不得產生第二個獨立索引 URL。
5. 輸入已核准資料但目標頁為 noindex 或 redirect → 不得進 sitemap；不得覆蓋原排除設定。
6. 在來源清單中放入重複 `ID` 或不存在的 ID → 建置／資料驗證失敗，不得靜默覆蓋或忽略。
7. 在同一個已核准頁面旁加入一筆未核准 FAQ → 可見正文及 JSON-LD 均不得輸出該 FAQ，其他既有核准內容與索引設定保持不變。
8. 在資料檔新增未核准新 slug → 不得生成新 HTML、canonical、內鏈或 sitemap URL。

## 驗收證據

- 對每種輸出各保留一項阻擋測試結果：HTML、Service JSON-LD、FAQ JSON-LD、對外 AI 資料檔、sitemap。
- 加入核准狀態缺欄、重複 ID、canonical 外指、noindex／redirect 等回歸案例。
- 對照修改前後 sitemap 集合，證明非本批核准 URL 的索引資格沒有被改變。
- 測試只證明本機生成規則；正式站實際部署及公開讀回需另外驗收。

