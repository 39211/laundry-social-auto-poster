# 勃肯服務連結修正：已部署並驗證

完成時間：2026-09-07 03:26 Asia/Taipei。取代先前 implementation 報告的 DEPLOYMENT_BLOCKED 狀態。

## 已上線

https://sixiangjialaundry.com/guides/birkenstock-care.html

- 頁首次要服務按鈕、正文「對應服務」由白鞋清潔改到鞋包清潔；JSON-LD Service 與 WebPage.about 一致。
- 主圖、圖片caption/alt、頁面圖片metadata、title、H1、答案框、正文、LINE入口不變。未重生圖片、未新增URL、未重送IndexNow。
- 型別增加可選 image_service_slug，讓服務路由不再強制更換fallback主圖。既有matchedPost圖片優先規則保留。

## 驗證證據

- focused publicSite：37/37通過；TypeScript noEmit通過；diffcheck通過。
- 刪除image_service_slug保留設定，parity測試會在實際主圖/metadata差異上變紅；恢復後回綠。先前舊服務映射突變亦會變紅。
- 固定公開資料生成的before與live原始頁面SHA256完全相同：52e38b7b7782e0dc10568545c057c5b7f5ba25acab61f1ff7a5eb25931b9893a。
- after與已上線頁面SHA256完全相同：52ab3d3f75ee66239097d3da38b9a728499f6b8f647bd0b1cf442fb0dc828b48。
- 實際HTML差異僅3行：2個服務anchors及JSON-LD；沒有全量重發生成內容。
- 03:26:09官網直接讀回HTTP200、hash相符、data-parent-service確實指向shoe-bag-care。

## GitHub

- Source PR：https://github.com/39211/laundry-social-auto-poster/pull/71 ，已合併至現行來源分支hermes/seo-luxury-question-titles，非將其他變更混入main。
- Source commit：ee02cb21ae2cf20ab9b05e42270ffabcf01692cf；merge：52419b9249522745cf40b166f30672a0551bd160。
- Source CI：https://github.com/39211/laundry-social-auto-poster/actions/runs/34054550829 ，SUCCESS，110個測試檔通過。
- Pages commit：f5ca4618a9c6d7ba543371bae9a8eadfd7fc263e，只有guides/birkenstock-care.html一個檔案變動。使用Contents API目前blob SHA比對後更新，提交前再次核對live和remote baseline，沒有force或整站覆寫。
- Pages workflow：https://github.com/39211/39211.github.io/actions/runs/34054733559 ，SUCCESS。
- Workflow另警告整站artifact約1.33GB、超過其1GB建議限制，並有Node20 action棄用提示。本次部署成功且live驗證相符；未擅自清理資產或改workflow，後續部署容量需另行處理。
- 主工作目錄同步來源修正768b3751、生成頁7417d24a，避免下一次從本機舊檔發布時退回；其他未提交工作未納入。

## 複審與限制

- GPT獨立規格審：Can ship，實際artifact diff及部署腳本核對通過。
- Gemini 3.8 Flash跨家族唯讀複審：PASS；依完整patch及evidence審查，未獨立重跑測試。
- Grok第一輪max turns無判定；第二輪timeout無判定，不算通過。正式既有唯讀通道使用，不修改或繞過PowerShell安全政策。
- 複審證據：C:/Users/cyc39/AI-Lanes/solo-41300/SXJ-BIRKENSTOCK-FINAL-CHECK-20260907/gemini38/stdout.txt。
- 生成與發布證據：C:/Users/cyc39/.codex/worktrees/sxj-birkenstock-link-20260907/output/birkenstock-proof-20260907/evidence.json、release.json。測試/生成/發布輔助檔留在隔離工作目錄reports，未混入來源PR。

## 成效判定

Day0為本次實際部署9/7。第7天9/14先查Google最近抓取及非品牌曝光；第28天10/5起待完整資料窗口再比較此URL非品牌曝光、自然搜尋sessions、服務跳轉與LINE click。資料延遲/缺值/樣本不足則PENDING或INCONCLUSIVE。

使用者提供8/10–9/6勃肯臭味三詞8曝光0點擊是待驗證基線，不足以證明標題失敗。此次完成的是正確服務導流，不是新增Google索引、排名或實際轉換的證據。既有GSC OAuth失效與後台可登入是兩個存取管道，不能混淆。
