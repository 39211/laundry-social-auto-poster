# W6：下一版 release 的黑箱驗收基線

## 最終六項基線（r6）

- 產品來源仍是 `460cfec4aac65d2cc77fcff1abbbfd429bb059e4`，本輪沒有修改 `src/`。真產品 2/6、exit 1，`NO_GO_RELEASE_RECONCILIATION`；typecheck exit 0；零臨時根殘留。
- R0、R4 通過。R1 重跑、R2 更新、R3 撤回兩篇中的一篇遇 `SEO90_EXISTING_ARTICLE_COLLISION`；R5 撤回最後一篇遇 `SEO90_RELEASE_RECONCILIATION_REQUIRED`。保護舊輸出的守衛仍在，產品重跑／更新／撤回尚未實作完成。
- gate SHA256：`aa244fed66158d17543b748b08513f3d101fdab85bac671b1e1b31e3424cae3c`。固定六案，缺案、重複案、零案不可當成功。
- 獨立 GPT 審查實跑真產品 2/6；已知錯誤輸出注入 3/6、exit 1（R2/R3/R5 被攔），完整正確輸出注入 6/6、exit 0。注入只證驗收的鑑別力，不是產品完成。三跑零新增 fixture temp，typecheck 0。這是同家族複審，沒有宣稱跨家族。
- 原驗收曾假綠：只驗題目，漏掉文章／sitemap 日期及服務頁；撤回只驗連結消失，整份 aggregate 被刪也會過。兩項已修並用錯誤與正確結果雙向驗證；原錯誤證據保留，沒有改舊 FAIL 為 PASS。
- 原始實跑：`release-contract-baseline-r6.json`、同名 `.log`、`release-contract-typecheck-r5.log`；複審：`release-contract-independent-review.md` 與該報告列出的原始證據。
- 六篇仍是短版私稿，0 新核准／release／正式公開／部署。未新增 Pro 提問：SEO R1/R2 架構沒有新變更。

## 歷史 r3 五項基線（保留，不作最終裁定）

2026-09-22。這輪是獨立驗收入口，未實作 release writer，未修改 src/ 或正式資料。不是五項需求都完成。

基線產品 commit：460cfec4aac65d2cc77fcff1abbbfd429bb059e4。被驗四個來源SHA另存每份JSON。

實跑r3：exit 1，NO_GO_RELEASE_RECONCILIATION，2/5。TypeScript typecheck exit 0。每案使用新的合成tempdir，最後remainingTempRoots=0。

- R0初次已核准發布：PASS，文章/daily/sitemap/四圖存在。
- R1重跑：NO_GO，SEO90_EXISTING_ARTICLE_COLLISION；公開樹bytes沒變。
- R2更新：NO_GO，SEO90_EXISTING_ARTICLE_COLLISION；新稿原本通過eligibility，不能以無效fixture解釋失敗。
- R3撤回：NO_GO，SEO90_RELEASE_RECONCILIATION_REQUIRED；文章/引用/四圖仍在。
- R4稿件改過但未重新核准：PASS，拒絕且公開樹bytes沒變。

結論：舊公開版本有守住，但還沒有可交付的重跑、更新、撤回。禁止移除collision或reconciliation守衛冒充實作。需要自有產物/版本記錄與安全修改後，再由同入口驗下一候選。

原始證據：release-contract-baseline-r3.json/log、release-contract-typecheck-r2.log。r1獨立入口因import初始化缺PUBLIC_SITE_BASE_URL而失敗，保留log與first-run-note；未計入產品缺陷或PASS。

獨立複審另看release-contract-independent-review.md；尚未有該檔時不可宣稱複審完成。未因同一已知缺口再問Pro，SEO R1/R2既有契約維持。

未涵蓋斷電、並行writer、跨文章共享圖片、正式部署及真店核准；通過只代表這份契約，不代表商品已驗收。六篇真稿仍是短版私稿，沒有新增網站核准或正式發布。
