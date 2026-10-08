# Cohort A release package 驗證 — 2026-09-02

## 結果

針對 [release package](../docs-internal/index-growth-100-cohort-a-release-package-2026-09-02.json) 做離線檔案與 live sitemap 交叉驗證：

| 檢查 | 結果 |
|---|---:|
| package 狀態 | `HOLD_UNTIL_PILOT_ADOPT` |
| 候選頁數 | 5 |
| hash／bytes 通過 | 5/5 |
| 缺檔或 mismatch | 0 |
| live sitemap URL | 33 |
| 候選 URL 已誤列入 live sitemap | 0 |
| 既有 live URL 保留 | 33/33 |
| package 形狀安全 | `true` |

## 解讀

五個候選檔案與封裝 hash 相符，且目前尚未被誤部署；live 33 URLs（含 pilot）仍完整保留。這只證明 release package 可重現、未誤放量，不代表候選已通過內容 provenance、素材或 28 日成效 gate。

## 放行前仍需

1. pilot 在 2026-09-30 前完成 GSC 收錄與非品牌曝光觀測。
2. 同一期間 GA4 自然搜尋或 LINE click 至少有可用訊號；缺資料判 `INCONCLUSIVE`。
3. 重新確認五頁 claim／素材 provenance，並同批部署後逐頁驗證 HTTP 200、canonical、noindex、正文與 guide link closure。
