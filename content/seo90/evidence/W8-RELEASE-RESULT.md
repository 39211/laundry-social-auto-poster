# W8：隔離 release 生命週期實作與獨立驗收

狀態：GO_ISOLATED_CANDIDATE，HOLD_PUBLIC。不是正式可販售或已部署。

已落地：可信自有release的重跑no-op、核准更新、撤回／最後一篇移除；文章、素材、daily、服務內鏈、sitemap、周邊索引與manifest的同一行程內提交／例外復原；輸出祖先junction越界拒絕。修復沿用原唯一網站生成器。

主體由Grok4.7實作（R1/R3 actual modelUsage皆grok-4.7-build-fast）。Codex獨立驗收，並修了一個WebP小接線回歸：先生成同一transaction的WebP bytes，再據此組HTML，最後一併提交。根據實際bytes，不提早寫公開檔。該root修正另由GPT唯讀複審，不冒稱它是跨家族雙審。

## 最終同版驗證
- 五份相關測試115/115，0失敗、0略過；專案與acceptance型別檢查exit0。
- 固定gate6/6，14個固定payload SHA不變，該次gate無新增殘留fixture。
- 兩支原始獨立反例均exit0：晚期寫入失敗保留原版、services junction不再寫出界。原repro／原始證據33/33 hash未改。
- 另個獨立真故障probe：還原失敗後，新Node行程仍被block，未知旁檔不變；只證站根可寫情境。
- 四個程式／測試檔按SHA逐byte複製進SEO隔離分支；未碰原共享checkout、P1/P3、正式發布日誌或平台。

## 不能抹掉的失敗
R1固定6/6、109/109綠，仍被反例抓到半套版本與junction越界。R2服務500，14筆重試後agent1/FAILED_EXIT，外層0不能放行。R3先114/115：PNG仍在，但首次生成漏WebP picture，補接線後115/115。最終並行測試曾在TEMP清理EBUSY；保留原錯誤，停止其他測試後逐項重跑gate與兩反例均0；EBUSY原因未定，不能抹成一直全綠。

原始stdout/stderr、JSON與退出碼留本機；Git存摘要、精確SHA及來源，詳local-evidence-sha256.json。

## 明確未驗與下一節點
斷電、強殺、並行writer、marker本身不可寫的持久阻擋未驗；不能將本次行程內復原稱成任意故障恢復。marker寫入失敗會被捕捉而未能確保持久封鎖，仍是正式部署前需處理的風險。

本輪90日是計畫；6篇仍短稿／24圖已核來源hash，完整母稿0、網站核准0、正式部署0、本輪社群新增發布0、搜尋成效未觀測。安全帽服務仍held，不計完整稿額度。老闆刪除的FB/IG不補發。

Pro R3/R4已收斂架構（依摘要裁定，非本機執测）；後續為完整母稿／逐圖QA與跨店七日包，網站核稿與正式部署另行授權。此時不新增架構討論回合。
