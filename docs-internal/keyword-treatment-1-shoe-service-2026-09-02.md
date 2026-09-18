# 關鍵詞 treatment 1 草稿：台中鞋子送洗 — 2026-09-02

## 狀態

`DRAFT_ONLY`／未部署。這份草稿不會在 pilot 觀測期內與現有內鏈變因同時上線。

## 單一變因

- treatment 頁：`services/shoe-bag-care.html`
- 目標意圖：台中鞋子送洗
- 只新增一段自然正文，不同步改 title、description、JSON-LD、FAQ 或其他頁。
- 建議正文（須經店方確認後才可採用）：

  > 在台中找鞋子送洗，可先拍鞋面、鞋底、鞋內與整體照片傳 LINE；我們會先看材質、髒污位置與可改善範圍，再說明適合清潔、局部整理或不建議硬處理。台中市收送本身免費，沒有最低消費門檻。

## 來源與限制

句子只重組 live 頁面已存在的服務事實：台中市免費收送、沒有最低消費門檻、四張照片、材質判斷與處理界線。未新增價格、效果保證、案例或服務區域外推。

## 對照與量測

- 對照頁：`services/white-shoe-cleaning.html` 維持不變。
- 第 7 天：確認 treatment URL crawl／coverage，以及是否出現非品牌 impressions；資料不足維持 `PENDING`。
- 第 28 天：比較 GSC 非品牌 impressions／clicks／CTR／position、GA4 organic sessions、LINE click；缺任一關鍵欄位判 `INCONCLUSIVE`。
- 若只有曝光沒有互動，`RETEST`；若完整 28 日無曝光且頁面已檢索，`REPLACE` 詞而非新增同義 URL。

## 發布前 gate

1. pilot 已完成既定 7／28 天 gate，或明確獲准進行第二個 treatment。
2. 店方確認文案中的收送、照片與預約流程仍正確。
3. 只改上述一段正文；重新跑 HTML／canonical／noindex／內容厚度與 mirror audit。
4. 產生新 sitemap lastmod 後只提交一次變更通知；不把提交回應當成 Google 收錄。
