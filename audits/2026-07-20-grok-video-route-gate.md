# Grok 影片生成路由合規閘門（2026-07-20）

## 結論

目前沒有已放行的自動 Grok 影片生成路由，因此 C03–C08 不生成。

這是政策合規判斷，不是法律意見。重新放行必須有下列其中一項可驗證證據：

1. 使用官方 xAI API，且使用者明確同意其獨立計費與適用條款；或
2. xAI 對 Hermes 消費者 OAuth 自動化路由提供可保存的書面許可。

## 路由矩陣

| 路由 | 狀態 | 理由 | 放行條件 |
|---|---|---|---|
| Hermes + 消費者 xAI OAuth 自動操作 | NO-GO | xAI AUP 禁止以 bot、script 或其他非人工方式存取服務 | 取得 xAI 明確書面許可，並保存許可證據 |
| 自動操作 grok.com 網頁 | NO-GO | 同屬非人工存取風險；使用者也明確不要網頁生成 | 不採用 |
| 人工操作 grok.com | 本專案不採用 | 不是可重現的自動製作路由，且使用者已排除網頁版 | 不採用 |
| 官方 xAI API | CONDITIONAL GO | 受企業／API 條款與獨立 API 帳務約束 | 使用者明確授權 API 計費；確認模型與影片端點可用；保留 request ID、來源與輸出 provenance |
| 其他第三方轉接 API | NO-GO | 未驗證授權鏈、資料處理、計費與模型真實來源 | 提供官方授權鏈及條款後重新審查 |

## 官方依據

- [xAI Acceptable Use Policy](https://x.ai/legal/acceptable-use-policy)：2026-06-26 生效；禁止以 bot、script 或其他非人工方式存取服務，也禁止移除來源中繼資料或浮水印。
- [xAI Enterprise Terms of Service](https://x.ai/legal/terms-of-service-enterprise)：API／商業服務適用；輸入權利、輸出使用、識別為 AI 產出等義務仍須遵守。
- [xAI Consumer Terms of Service](https://x.ai/legal/terms-of-service)：消費者服務另受 AUP 約束，API 則由企業條款管理。
- [xAI API Accounts FAQ](https://docs.x.ai/console/faq/accounts)：API 帳務與 Grok／SuperGrok 訂閱分開。

## 技術放行驗證

即使路由合規，仍須逐項通過後才准生成：

- 不在提示詞、日誌、ZIP 或畫面中暴露 token、OAuth cache、cookie 或客戶資料。
- 每次提交保存模型名稱、端點、request ID、時間、輸入資產雜湊與輸出檔雜湊。
- 首幀先通過真人感、物件一致性、材質合理性與品牌證據閘門。
- 每支素材只做一個可驗證動作，Grok 最短 6 秒限制由剪輯 in/out 處理，不用 6 秒反寫劇情。
- 完整 24fps frame + PTS 檢查通過後，素材才能進剪輯。
- 不移除任何平台要求的 AI 標示、provenance metadata 或浮水印。

