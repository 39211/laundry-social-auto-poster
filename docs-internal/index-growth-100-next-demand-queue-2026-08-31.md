# Index-growth-100 下一批需求 queue（2026-08-31）

## 目的與證據邊界

這是一份研究／排序 queue，不是發布清單。第一方 GSC 目前只有 63 impressions／1 click，非品牌查詢樣本很小；公開 SERP 只用來辨識問題型態與競爭結構，不能當月搜量、排名或收錄證明。

目前 live sitemap 32 URL，PR #30 accepted inventory 24 頁仍未通過 release gate。下一批只能在首批修復、部署並完成 live／GSC 驗證後啟動；不把候選數量當成 100 頁進度。

## 去重後 queue

| 順位 | 搜尋／服務意圖 | 建議路徑 | 動作 | 不重複理由 | 新 URL 前置證據 | 狀態 |
|---:|---|---|---|---|---|---|
| 1 | 台中洗帽子／帽材質檢查 | `guides/hat-cleaning-check.html` | 新候選 | 現有 sitemap 沒有帽子主題 | 店家確實提供帽子服務、處理流程與可用素材 | `EVIDENCE_REQUIRED` |
| 2 | 行李箱內裡／異味清潔 | `guides/luggage-interior-cleaning.html` | 新候選 | 與既有 `luggage-wheel-cleaning` 分開處理輪子問題 | 實際可處理部位、材質限制、照片或交件流程 | `EVIDENCE_REQUIRED` |
| 3 | 包包染色或清潔怎麼選 | `guides/bag-clean-vs-repair.html` | 強化既有候選 | 已有 accepted `bag-clean-vs-repair`，不再建同義頁 | 保留清潔／修復界線與真實服務範圍 | `ENHANCE_EXISTING` |
| 4 | 棉被送洗前怎麼交件／收送 | `guides/bedding-duvet-cleaning.html` | 強化既有頁 | 已有棉被頁與全市收送頁，新增地名頁會 doorway | 真實收送條件、尺寸／材質判斷與 CTA | `ENHANCE_EXISTING` |
| 5 | 餐飲制服油污批量送洗 | `services/business-bulk-laundry.html` | 強化既有頁或 B2B 子段落 | 已有企業大量洗衣服務，先拆需求不拆 URL | 合法商業案例、分類／交期／最低量事實 | `EVIDENCE_REQUIRED` |
| 6 | 飯店床單／毛巾批量送洗 | `services/business-bulk-laundry.html` | 強化既有頁或 B2B 子段落 | 與企業大量服務同一交易意圖 | 合法客戶或公開服務證據；不得虛構數字 | `EVIDENCE_REQUIRED` |
| 7 | 窗簾拆洗／收送流程 | `guides/curtain-cleaning.html` | 強化既有頁 | 已有窗簾清洗頁，拆成「拆掛」頁需額外服務事實 | 是否提供拆掛、尺寸限制與報價方式 | `ENHANCE_EXISTING` |
| 8 | 地毯異味／寵物污漬判斷 | `guides/carpet-cleaning.html` | 強化既有頁 | 已有地毯清洗頁，不能只換問題詞建頁 | 實際可處理污漬、限制與案例 provenance | `ENHANCE_EXISTING` |

## 排序判定

- 先處理 3、4、5、6、7、8 的既有頁答案與情境內鏈；它們不增加 URL，能先測 snippet／landing intent。
- 1、2 只有在第一方服務證據與素材 ledger 補齊後才可進入 catalog；沒有證據就保持 `EVIDENCE_REQUIRED`。
- 所有新頁仍須通過答案先行（answer／meta／OG／Twitter）、claim-level provenance、非 doorway、單一 resolver、真 mutation fail-then-restore、圖片標示、live 200／canonical／noindex／JSON-LD 與部署後 GSC inspection。
- 7 日只判 crawl／impressions／clicks 的 `PENDING` 或 `RETEST`；資料完整且滿 28 日才可 `ADOPT`／`REJECT`。100 頁驗證前不規劃 150／200。

## 19:28 第一方證據分流

- `hat-cleaning-check` 找到價目表（帽子／皮帽子／精品帽子）與安全帽內襯檢查流程，但仍是 `EVIDENCE_PARTIAL`；在公開服務範圍與素材 provenance 確認前，原列 `EVIDENCE_REQUIRED` 不變。
- `luggage-interior-cleaning` 沒找到獨立內裡服務事實，現有行李箱輪子指南已涵蓋布面、底板、輪邊與發霉到內襯的限制；改列 `DO_NOT_SPLIT`，先強化既有頁。
- 完整證據鏈見 `reports/first-party-demand-evidence-triage-2026-08-31.md`；本次未修改 source、未建立新 URL、未部署。

## 公開需求訊號來源

- 到府收送服務型結果：[沐潔台中到府收送](https://www.mujie-laundry.com/)
- 西屯洗鞋與材質風險：[Rebirth 洗鞋店](https://rebirth407.com/)
- 台中洗包、染色與修復並列：[ReFine 瑞凡亞](https://www.ultron.tw/home)
