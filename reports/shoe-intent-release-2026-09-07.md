# 四頁洗鞋修正：已提交並部署

- PR：[74](https://github.com/39211/laundry-social-auto-poster/pull/74)，已合併至 `hermes/seo-luxury-question-titles`；來源 `6b7f7b77`，merge `aa3fdd43`。
- [公開部署 commit](https://github.com/39211/39211.github.io/commit/6fe9120b8277aa8509327f18f092562a70c1d935)：`6fe9120b`。
- 既有四頁：鞋臭、鞋發霉、白鞋泛黃、麂皮。正文各補價目／免費收送連結、收件資訊與價格界線；沒有新增 URL、案例或洗包草稿。
- 實際更新四頁＋四個 SEO 日期依賴，8/8 live SHA256 驗證通過。Sitemap 保留89 URL，這不代表89頁已被Google收錄。GA4、LINE、圖片、標題／答案及勃肯控制保留。
- T0：`2026-09-07T04:22:47.975Z`（台北12:22:47.975）。第7日9/14核对爬取晚於T0；第28日10/5等待完整窗口再依非品牌GSC、GA4自然搜尋及LINE判讀；缺資料null、樣本不足INCONCLUSIVE。目前效果PENDING／unmeasured。
- GitHub CI：111檔、1065 tests通過，18略過。首次兩個非本批測試逾時、另一次本機全套暫存檔鎖EPERM，均已保留紀錄；單檔重測通過不等於根因修復。本批未修改那些程式或測試。
- 主工作樹五個已核准 source/test 檔以 `4aa8f294` 同步，與來源五檔差異為空；不混入其他人的圖片／社群工作。
- 未額外重送GSC／IndexNow、修改Google商家或社群排程。相同版本勿重複部署。

[完整部署報告](C:/Users/cyc39/.codex/worktrees/sxj-shoe-intent-20260907/reports/shoe-intent-release-2026-09-07.md)

[逐檔 live 驗證收據](C:/Users/cyc39/.codex/worktrees/sxj-shoe-intent-20260907/output/shoe-intent-release-20260907/receipt.json)

[追蹤路由驗證](C:/Users/cyc39/.codex/worktrees/sxj-shoe-intent-20260907/output/shoe-intent-release-20260907/routing-verification.json)：正式程式在離線VM驗8個內鏈事件＋4個LINE CTA，不向GA4灌測試流量；不宣稱GA4正式入庫已驗證。
