# 帽子候選 live 範圍盤點（2026-08-31）

## 判決

目前不能把 `guides/hat-cleaning-check.html` 升級為可發布新頁。雖然本機 `data/prices.json` 有帽子類價目，live 32 頁中沒有「帽子／皮帽子／精品帽子／安全帽／帽沿」的服務或內容詞；公開的價格頁也沒有帽子項目。這表示證據目前停在內部輸入，尚未形成可公開核對的服務範圍。

## 實測

- `https://sixiangjialaundry.com/sitemap.xml` 回傳 32 個 URL；逐頁 GET 後，帽子相關詞命中頁數為 `0/32`。
- `https://sixiangjialaundry.com/services/taichung-laundry-price-list.html` HTTP 200、自 canonical、`index, follow`，但以下詞全部未命中：`帽子`、`皮帽子`、`精品帽子`、`安全帽`、`帽沿`、`內襯`。
- 本機價目輸入仍存在：`data/prices.json` 的「帽子=80」、「皮帽子=300」、「精品帽子=130」；`src/contentPlan.ts:175-181` 只有安全帽內襯／外套帽沿的內容計畫。這些是生成輸入，不是 live 服務承接證明。

## 對 100 頁計畫的影響

1. `hat-cleaning-check` 維持 `EVIDENCE_REQUIRED`／`EVIDENCE_INTERNAL_ONLY`，不進 accepted catalog、不加入 sitemap、不送 IndexNow。
2. 只有店家確認現行收件範圍、材質／洗標限制，並提供可公開使用的第一方照片或檢查紀錄後，才可建立頁面 brief；屆時仍需通過 provenance、safety、非 doorway、resolver／mutation 與 live closure gate。
3. 在證據補齊前，優先強化已 live 且已有 GSC 意圖的鞋／娃娃頁；不以本機價目把帽子需求寫成已驗證流量。

## 限制

本次只讀取 live HTML 與本機輸入，未修改 source、未建立新頁、未部署、未合併，也未提交新的 IndexNow。HTTP 200 或 sitemap 出現仍不等於 Google 已收錄。
