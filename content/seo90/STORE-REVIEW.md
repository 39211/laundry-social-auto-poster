# 兩店私有核稿重建入口

`scripts/seo90-store-review.ts WORKSPACE EXPECTED_STORE TRUSTED_POLICY_SHA NEW_RUN_ID`

此入口只建立本機 noindex 核稿頁，不核准、不部署、不發社群。來源為
`WORKSPACE/stores/<store>/bundle.json`、`policy.json`、`assets/`，輸出固定在
`WORKSPACE/builds/<store>/<run>/`；已有輸出會拒絕，必須另給新 run。

可信的收件／核稿者先檢查每店文字、品牌、詢問入口與圖片，再用 `reviewPolicy(bundle)`
建立來源固定清單，將 `digest(policy)` 以獨立工作單傳給執行者。不能用候選自己提供的雜湊
自動取代可信工作單。修改內容需要重新審查及重新發工作單；固定清單不是店主批准或數位簽章。

重建入口核對店別、全份 bundle、registry、素材 manifest 與實體檔案 SHA；拒絕輸入或輸出
子路徑上的 junction/symlink。工作區本身由本機操作者信任，仍須單一 writer，這不是對抗
惡意同機管理員或同時修改檔案系統的 sandbox，也不是雲端多租戶身分驗證。

重要差異：原始 `buildSeo90(..., preview)` 只檢查資料一致性，能接受正確重新綁定的外店圖片。
兩店隔離驗收應呼叫本入口，不能以直接呼叫原 preview API 的結果宣稱已有歸屬保護。
preview 的篇幅檢查也不等於完整母文驗收，文稿與真圖品質仍須獨立審查。

驗證：`test/seo90StoreReview.test.ts` 含兩店正向、中文空白路徑重建、換店／CTA／圖片／核准
負向、真 junction、既有目錄不覆蓋，以及先通過再換錯核准的合成 public 測試。
private report 的 `publicEligibilityChecked:false` 明確區分未檢查與不符合。
